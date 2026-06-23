const express = require("express");
const cors = require("cors");
const RSSParser = require("rss-parser");
const fetch = require("node-fetch");
const { Redis } = require("@upstash/redis");

const app = express();
const parser = new RSSParser();
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

// ── RSS Feeds ─────────────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { name: "BBC World",              url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Reuters World",          url: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "The Guardian World",     url: "https://www.theguardian.com/world/rss" },
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "Der Spiegel",            url: "https://www.spiegel.de/international/index.rss" },
  { name: "El País Internacional",  url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "France 24",              url: "https://www.france24.com/es/rss" },
  { name: "DW World",               url: "https://rss.dw.com/rss/en-all" },
  { name: "AP News",                url: "https://feeds.apnews.com/rss/apf-intlnews" },
  { name: "Foreign Affairs",        url: "https://www.foreignaffairs.com/rss.xml" },
  { name: "Foreign Policy",         url: "https://foreignpolicy.com/feed/" },
  { name: "The Diplomat",           url: "https://thediplomat.com/feed/" },
  { name: "War on the Rocks",       url: "https://warontherocks.com/feed/" },
  { name: "Bellingcat",             url: "https://www.bellingcat.com/feed/" },
  { name: "Crisis Group",           url: "https://www.crisisgroup.org/rss.xml" },
  { name: "Al Jazeera",             url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "Daily Sabah",            url: "https://www.dailysabah.com/rssFeed/push_notifications" },
  { name: "The Hindu",              url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "African Arguments",      url: "https://africanarguments.org/feed/" },
  { name: "Nikkei Asia",            url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "Asia Times",             url: "https://asiatimes.com/feed/" },
];

// ── Helpers Redis ─────────────────────────────────────────────────────────────
async function getNoticiasSaved() {
  try {
    const data = await redis.get("noticias");
    return data ? (typeof data === "string" ? JSON.parse(data) : data) : [];
  } catch { return []; }
}

async function saveNoticias(noticias) {
  try {
    await redis.set("noticias", JSON.stringify(noticias));
  } catch (e) { console.error("Error guardando noticias:", e.message); }
}

async function getTrackerSaved() {
  try {
    const data = await redis.get("tracker");
    return data ? (typeof data === "string" ? JSON.parse(data) : data) : { conflictos: [] };
  } catch { return { conflictos: [] }; }
}

async function saveTracker(tracker) {
  try {
    await redis.set("tracker", JSON.stringify(tracker));
  } catch (e) { console.error("Error guardando tracker:", e.message); }
}

function generarIdNoticia(titular) {
  // Normaliza eliminando palabras comunes y quedándose con las palabras clave
  return titular.toLowerCase()
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u")
    .replace(/\b(el|la|los|las|un|una|de|del|en|con|por|que|se|al|y|a|su|sus|es|son|ha|han|para|sobre|tras|ante|como|pero|mas|sin|entre|desde|hasta|cuando|donde|si|no|le|les|lo|este|esta|estos|estas|ese|esa|esos|esas|aquel|aquella)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .split("").sort().join("") // orden alfabético para comparar independiente del orden de palabras
    .slice(0, 35);
}

function filtrarNoticias24h(noticias) {
  const ahora = Date.now();
  return noticias.filter(n => (ahora - n.timestamp) < 24 * 60 * 60 * 1000);
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const start = text.indexOf("{");
  let end = text.lastIndexOf("}");
  while (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { end = text.lastIndexOf("}", end - 1); }
  }
  throw new Error("No se pudo extraer JSON");
}

// ── Recoger RSS ───────────────────────────────────────────────────────────────
async function recogerNoticias() {
  const titulares = [];
  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of (parsed.items || []).slice(0, 6)) {
        titulares.push({ titulo: item.title || "", resumen: item.contentSnippet || "", link: item.link || "", medio: feed.name });
      }
    } catch (e) { console.warn(`Error leyendo ${feed.name}: ${e.message}`); }
  }
  return titulares;
}

// ── Base44 ────────────────────────────────────────────────────────────────────
const BASE44_APP_ID = "6a35db462179dc4b254ff6fb";
const BASE44_API = "https://app.base44.com/api/apps";

async function base44Request(method, endpoint, body) {
  const url = `${BASE44_API}/${BASE44_APP_ID}/${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BASE44_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Base44 error ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function sincronizarBase44(noticias, tracker) {
  console.log("📤 Sincronizando con Base44...");
  const hoy = new Date().toISOString().split("T")[0];

  // 1. Noticias con puntuación >= 8
  try {
    const existentes = await base44Request("GET", `entities/Noticia?limit=50&filters=${encodeURIComponent(JSON.stringify({fecha: hoy}))}`);
    const titularesExistentes = new Set((existentes || []).map(n => n.titular?.toLowerCase().slice(0, 40)));
    let publicadas = 0;
    for (const n of noticias) {
      if ((n.puntuacion || 0) < 8) continue;
      const key = (n.titular || "").toLowerCase().slice(0, 40);
      if (titularesExistentes.has(key)) continue;
      await base44Request("POST", "entities/Noticia", {
        fecha: hoy,
        titular: n.titular || "",
        resumen: n.resumen || "",
        bullets: n.bullets || [],
        criterio: n.analisis || "",
        estado: "publicado",
      });
      titularesExistentes.add(key);
      publicadas++;
    }
    console.log(`✅ Base44 noticias: ${publicadas} nuevas publicadas`);
  } catch (e) {
    console.error("❌ Error sincronizando noticias Base44:", e.message);
  }

  // 2. Conflictos del tracker
  try {
    const conflictos = (tracker && tracker.conflictos) || [];
    const existentesConflictos = await base44Request("GET", "entities/Conflicto?limit=100");
    const nombresExistentes = new Map((existentesConflictos || []).map(c => [c.nombre?.toLowerCase(), c.id]));
    let sincronizados = 0;
    for (const c of conflictos) {
      const key = (c.nombre || "").toLowerCase();
      const nivelMap = { alto: "Alto", medio: "Medio", bajo: "Bajo" };
      const nivel = nivelMap[c.nivel_alerta] || "Medio";
      if (nombresExistentes.has(key)) {
        await base44Request("PUT", `entities/Conflicto/${nombresExistentes.get(key)}`, {
          ubicacion: c.ubicacion || "",
          partes: c.partes || "",
          nivel_tension: nivel,
          resumen_semana: c.ultimos_acontecimientos || c.update || "",
          estado: "activo",
          actualizado_en: new Date().toISOString(),
        });
      } else {
        await base44Request("POST", "entities/Conflicto", {
          nombre: c.nombre || "",
          ubicacion: c.ubicacion || "",
          partes: c.partes || "",
          nivel_tension: nivel,
          resumen_semana: c.ultimos_acontecimientos || c.descripcion || "",
          estado: "activo",
          actualizado_en: new Date().toISOString(),
        });
        nombresExistentes.set(key, "new");
      }
      sincronizados++;
    }
    console.log(`✅ Base44 tracker: ${sincronizados} conflictos sincronizados`);
  } catch (e) {
    console.error("❌ Error sincronizando tracker Base44:", e.message);
  }
}

// ── Análisis principal ────────────────────────────────────────────────────────
async function analizarNoticias(titulares) {
  const fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const resumen = titulares.slice(0, 20).map(t => `- [${t.medio}] ${t.titulo}`).join("\n");

  console.log("🧠 Llamando a Claude para análisis de noticias...");
  const noticiasData = await callClaude(
    "Eres analista geopolítico senior con 15 años de experiencia. Responde ÚNICAMENTE con JSON válido y completo.",
    `Fecha: ${fecha}.\nTitulares:\n${resumen}\n\nAnaliza estos titulares y selecciona las 5 noticias más relevantes geopolíticamente. IMPORTANTE: si varios titulares tratan el mismo acontecimiento aunque vengan de distintos medios, cuéntalos como UNA SOLA noticia y usa el medio más relevante. No repitas temas.\n{"noticias":[{"id":"n1","puntuacion":8,"titular":"Titular breve y directo","resumen":"1-2 frases concisas","bullets":["Frase corta máx 10 palabras","Frase corta máx 10 palabras","Frase corta máx 10 palabras"],"analisis":"Una frase larga y densa o dos cortas con perspectiva real: implicaciones, contexto histórico o consecuencias no evidentes. No describir, analizar.","medio":"BBC","link":"https://...","region":"Europa"}]}`
  );

  const noticiasArr = (noticiasData.noticias || []).filter(n => n.puntuacion >= 6);
  console.log(`📋 ${noticiasArr.length} noticias relevantes seleccionadas`);

  // Merge con existentes sin duplicados
  const noticiasExistentes = filtrarNoticias24h(await getNoticiasSaved());
  const idsExistentes = new Set(noticiasExistentes.map(n => generarIdNoticia(n.titular)));
  const ahora = Date.now();
  for (const n of noticiasArr) {
    const id = generarIdNoticia(n.titular);
    if (!idsExistentes.has(id)) {
      noticiasExistentes.push({ ...n, id, timestamp: ahora });
      idsExistentes.add(id);
    }
  }
  const noticiasFinales = noticiasExistentes.sort((a, b) => b.puntuacion - a.puntuacion);
  await saveNoticias(noticiasFinales);

  const titularesIA = noticiasArr.map(n => `- ${n.titular}`).join("\n") || "- Sin noticias";
  const trackerExistente = await getTrackerSaved();
  const conflictosActuales = (trackerExistente.conflictos || []).map(c => c.nombre).join(", ") || "ninguno";

  console.log("🔀 Lanzando análisis paralelo...");
  const [enc, trk, ana, bib] = await Promise.allSettled([
    callClaude(
      "Eres experto en comunidades de divulgación. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\n\nGenera 3 encuestas:\n{"encuestas":[{"id":"e1","titulo":"Pregunta","opciones":["A","B","C"],"motivo":"Razón","basada_en":"Noticia"}]}`
    ),
    callClaude(
      "Eres analista de conflictos internacionales senior. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\nConflictos ya en seguimiento: ${conflictosActuales}\n\nGenera tracker:\n{"nuevos_conflictos":[{"nombre":"Nombre","ubicacion":"País","partes":"Actor A vs Actor B","resumen":"2-3 frases","ultimos_acontecimientos":"1-2 frases","nivel_alerta":"alto"}],"actualizaciones":[{"conflicto":"Nombre exacto","ubicacion":"País","partes":"Actores","ultimos_acontecimientos":"Novedad"}]}`
    ),
    callClaude(
      "Eres experto en divulgación geopolítica. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\n\nGenera 3 temáticas:\n{"tematicas":[{"id":"a1","titulo":"Título","subtitulo":"Enfoque","descripcion":"Relevancia","zonas":["Europa"],"secciones_sugeridas":["Sec1","Sec2","Sec3"]}]}`
    ),
    callClaude(
      "Eres experto en divulgación geopolítica. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\n\nGenera 4 sugerencias de biblioteca:\n{"sugerencias":[{"id":"b1","zona":"Europa","titulo":"Título","descripcion":"De qué trata","motivo":"Por qué ahora","subtemas":["sub1","sub2"]}]}`
    ),
  ]);

  console.log(`📊 Encuestas: ${enc.status} | Tracker: ${trk.status} | Análisis: ${ana.status} | Biblioteca: ${bib.status}`);

  // Merge tracker
  if (trk.status === "fulfilled") {
    const nuevoTracker = trk.value;
    const conflictosExistentes = trackerExistente.conflictos || [];
    const nombresExistentes = new Set(conflictosExistentes.map(c => c.nombre.toLowerCase()));
    for (const c of (nuevoTracker.nuevos_conflictos || [])) {
      if (!nombresExistentes.has(c.nombre.toLowerCase())) {
        conflictosExistentes.push({ ...c, id: `c${Date.now()}`, timestamp: ahora });
        nombresExistentes.add(c.nombre.toLowerCase());
      }
    }
    for (const u of (nuevoTracker.actualizaciones || [])) {
      const idx = conflictosExistentes.findIndex(c => c.nombre.toLowerCase() === u.conflicto.toLowerCase());
      if (idx !== -1) {
        conflictosExistentes[idx] = { ...conflictosExistentes[idx], ...u, nombre: conflictosExistentes[idx].nombre, ultimaActualizacion: ahora };
      }
    }
    await saveTracker({ conflictos: conflictosExistentes });
  }

  const trackerFinal = await getTrackerSaved();

  return {
    noticias: noticiasFinales,
    encuestas: enc.status === "fulfilled" ? enc.value.encuestas || [] : [],
    tracker: trackerFinal,
    analisis: ana.status === "fulfilled" ? ana.value.tematicas || [] : [],
    biblioteca: bib.status === "fulfilled" ? bib.value.sugerencias || [] : [],
    lastUpdate: new Date().toISOString(),
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────
let cache = { noticias: [], encuestas: [], tracker: { conflictos: [] }, analisis: [], biblioteca: [], lastUpdate: null };

let cicloCorriendo = false;

async function cicloActualizacion() {
  if (cicloCorriendo) {
    console.log("⏸ Ciclo ya en curso, ignorando solicitud");
    return;
  }
  cicloCorriendo = true;
  console.log("🔄 Iniciando ciclo de actualización...");
  try {
    const titulares = await recogerNoticias();
    console.log(`📰 ${titulares.length} titulares recogidos`);
    cache = await analizarNoticias(titulares);
    console.log("✅ Actualización completada");
    if (process.env.BASE44_API_KEY) {
      await sincronizarBase44(cache.noticias, cache.tracker);
    }
  } catch (e) {
    console.error("❌ Error en ciclo:", e.message);
  } finally {
    cicloCorriendo = false;
  }
}

async function init() {
  const [noticias, tracker] = await Promise.all([getNoticiasSaved(), getTrackerSaved()]);
  cache.noticias = filtrarNoticias24h(noticias);
  cache.tracker = tracker;
  cicloActualizacion();
}

init();
setInterval(cicloActualizacion, 30 * 60 * 1000);

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", lastUpdate: cache.lastUpdate }));
app.get("/api/datos", (req, res) => res.json(cache));
app.post("/api/actualizar", async (req, res) => {
  cicloActualizacion();
  res.json({ message: "Actualización iniciada" });
});
app.delete("/api/noticias/:id", async (req, res) => {
  const { id } = req.params;
  const noticias = await getNoticiasSaved();
  const nuevas = noticias.filter(n => n.id !== id);
  await saveNoticias(nuevas);
  cache.noticias = nuevas;
  res.json({ message: "Noticia eliminada", total: nuevas.length });
});
app.delete("/api/tracker/:nombre", async (req, res) => {
  const nombre = decodeURIComponent(req.params.nombre);
  const tracker = await getTrackerSaved();
  tracker.conflictos = (tracker.conflictos || []).filter(c => c.nombre !== nombre);
  await saveTracker(tracker);
  cache.tracker = tracker;
  res.json({ message: "Conflicto eliminado" });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🌍 Servidor corriendo en puerto ${PORT}`));
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Puerto ${PORT} ocupado, reintentando en 5s...`);
    setTimeout(() => server.listen(PORT), 5000);
  }
});
