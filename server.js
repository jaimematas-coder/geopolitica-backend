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

const RSS_FEEDS = [
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Reuters World", url: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss" },
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "Der Spiegel", url: "https://www.spiegel.de/international/index.rss" },
  { name: "El Pais Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "France 24", url: "https://www.france24.com/es/rss" },
  { name: "DW World", url: "https://rss.dw.com/rss/en-all" },
  { name: "AP News", url: "https://feeds.apnews.com/rss/apf-intlnews" },
  { name: "Foreign Affairs", url: "https://www.foreignaffairs.com/rss.xml" },
  { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/" },
  { name: "The Diplomat", url: "https://thediplomat.com/feed/" },
  { name: "War on the Rocks", url: "https://warontherocks.com/feed/" },
  { name: "Bellingcat", url: "https://www.bellingcat.com/feed/" },
  { name: "Crisis Group", url: "https://www.crisisgroup.org/rss.xml" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "Daily Sabah", url: "https://www.dailysabah.com/rssFeed/push_notifications" },
  { name: "The Hindu", url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "African Arguments", url: "https://africanarguments.org/feed/" },
  { name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "Asia Times", url: "https://asiatimes.com/feed/" },
];

async function getNoticiasSaved() {
  try {
    const data = await redis.get("noticias");
    return data ? (typeof data === "string" ? JSON.parse(data) : data) : [];
  } catch (e) { return []; }
}

async function saveNoticias(noticias) {
  try { await redis.set("noticias", JSON.stringify(noticias)); }
  catch (e) { console.error("Error saving noticias:", e.message); }
}

async function getTrackerSaved() {
  try {
    const data = await redis.get("tracker");
    return data ? (typeof data === "string" ? JSON.parse(data) : data) : { conflictos: [] };
  } catch (e) { return { conflictos: [] }; }
}

async function saveTracker(tracker) {
  try { await redis.set("tracker", JSON.stringify(tracker)); }
  catch (e) { console.error("Error saving tracker:", e.message); }
}

function generarIdNoticia(titular) {
  return titular.toLowerCase()
    .replace(/[aáàä]/g, "a").replace(/[eéèë]/g, "e")
    .replace(/[iíìï]/g, "i").replace(/[oóòö]/g, "o").replace(/[uúùü]/g, "u")
    .replace(/\b(el|la|los|las|un|una|de|del|en|con|por|que|se|al|y|a|su|sus|es|son|ha|han|para|sobre|tras|ante|como|pero|sin|entre|desde|hasta|no|le|les|lo|este|esta|ese|esa)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .split("").sort().join("")
    .slice(0, 35);
}

function filtrarNoticias24h(noticias) {
  const ahora = Date.now();
  return noticias.filter(function(n) { return (ahora - n.timestamp) < 24 * 60 * 60 * 1000; });
}

async function callClaude(system, user) {
  const timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error("Timeout: 60s")); }, 60000);
  });
  const fetchPromise = fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: system,
      messages: [{ role: "user", content: user }]
    }),
  });
  const res = await Promise.race([fetchPromise, timeoutPromise]);
  if (!res.ok) throw new Error("API error " + res.status);
  const data = await res.json();
  const text = (data.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
  const start = text.indexOf("{");
  let end = text.lastIndexOf("}");
  while (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); }
    catch (e) { end = text.lastIndexOf("}", end - 1); }
  }
  throw new Error("No JSON found");
}

async function recogerNoticias() {
  const titulares = [];
  for (let i = 0; i < RSS_FEEDS.length; i++) {
    const feed = RSS_FEEDS[i];
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, 6);
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        titulares.push({ titulo: item.title || "", resumen: item.contentSnippet || "", link: item.link || "", medio: feed.name });
      }
    } catch (e) { console.warn("Error reading " + feed.name + ": " + e.message); }
  }
  return titulares;
}

const BASE44_APP_ID = "6a35db462179dc4b254ff6fb";
const BASE44_API = "https://app.base44.com/api/apps";

async function base44Request(method, endpoint, body) {
  const res = await fetch(BASE44_API + "/" + BASE44_APP_ID + "/" + endpoint, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BASE44_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Base44 error " + res.status + ": " + err.slice(0, 200));
  }
  return res.json();
}

async function sincronizarBase44(noticias, tracker) {
  console.log("Syncing Base44...");
  const hoy = new Date().toISOString().split("T")[0];

  try {
    const existentes = await base44Request("GET", "entities/Noticia?limit=50&filters=" + encodeURIComponent(JSON.stringify({ fecha: hoy })));
    const titularesExistentes = new Set((existentes || []).map(function(n) { return (n.titular || "").toLowerCase().slice(0, 40); }));
    let publicadas = 0;
    for (let i = 0; i < noticias.length; i++) {
      const n = noticias[i];
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
    console.log("Base44 noticias: " + publicadas + " published");
  } catch (e) { console.error("Base44 noticias error: " + e.message); }

  try {
    const conflictos = (tracker && tracker.conflictos) || [];
    const existentesConflictos = await base44Request("GET", "entities/Conflicto?limit=100");
    const nombresExistentes = new Map((existentesConflictos || []).map(function(c) { return [c.nombre ? c.nombre.toLowerCase() : "", c.id]; }));
    let sincronizados = 0;
    for (let i = 0; i < conflictos.length; i++) {
      const c = conflictos[i];
      const key = (c.nombre || "").toLowerCase();
      const nivelMap = { alto: "Alto", medio: "Medio", bajo: "Bajo" };
      const nivel = nivelMap[c.nivel_alerta] || "Medio";
      if (nombresExistentes.has(key)) {
        await base44Request("PUT", "entities/Conflicto/" + nombresExistentes.get(key), {
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
    console.log("Base44 tracker: " + sincronizados + " synced");
  } catch (e) { console.error("Base44 tracker error: " + e.message); }
}

async function analizarNoticias(titulares) {
  const fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const resumen = titulares.slice(0, 20).map(function(t) { return "- [" + t.medio + "] " + t.titulo; }).join("\n");

  console.log("Calling Claude for news analysis...");
  const noticiasData = await callClaude(
    "You are a senior geopolitical analyst. Respond ONLY with valid complete JSON. No markdown.",
    "Date: " + fecha + ".\nHeadlines:\n" + resumen + "\n\nSelect the 5 most geopolitically relevant news. If multiple headlines cover the same event from different sources, count them as ONE story.\n{\"noticias\":[{\"id\":\"n1\",\"puntuacion\":8,\"titular\":\"Brief headline\",\"resumen\":\"1-2 sentences\",\"bullets\":[\"Short point max 10 words\",\"Short point max 10 words\",\"Short point max 10 words\"],\"analisis\":\"One dense analytical sentence with real perspective.\",\"medio\":\"BBC\",\"link\":\"https://...\",\"region\":\"Europe\"}]}"
  );

  const noticiasArr = (noticiasData.noticias || []).filter(function(n) { return n.puntuacion >= 6; });
  console.log("Noticias selected: " + noticiasArr.length);

  const noticiasExistentes = filtrarNoticias24h(await getNoticiasSaved());
  const idsExistentes = new Set(noticiasExistentes.map(function(n) { return generarIdNoticia(n.titular); }));
  const ahora = Date.now();
  for (let i = 0; i < noticiasArr.length; i++) {
    const n = noticiasArr[i];
    const id = generarIdNoticia(n.titular);
    if (!idsExistentes.has(id)) {
      noticiasExistentes.push(Object.assign({}, n, { id: id, timestamp: ahora }));
      idsExistentes.add(id);
    }
  }
  const noticiasFinales = noticiasExistentes.sort(function(a, b) { return b.puntuacion - a.puntuacion; });
  await saveNoticias(noticiasFinales);

  const titularesIA = noticiasArr.map(function(n) { return "- " + n.titular; }).join("\n") || "- No news";
  const trackerExistente = await getTrackerSaved();
  const conflictosActuales = (trackerExistente.conflictos || []).map(function(c) { return c.nombre; }).join(", ") || "none";

  console.log("Running parallel analysis...");
  const results = await Promise.allSettled([
    callClaude(
      "You are an expert in online communities. Respond ONLY with valid JSON.",
      "News:\n" + titularesIA + "\n\nGenerate 3 polls:\n{\"encuestas\":[{\"id\":\"e1\",\"titulo\":\"Question\",\"opciones\":[\"A\",\"B\",\"C\"],\"motivo\":\"Reason\",\"basada_en\":\"News\"}]}"
    ),
    callClaude(
      "You are a senior international conflicts analyst. Respond ONLY with valid JSON.",
      "News:\n" + titularesIA + "\nTracked conflicts: " + conflictosActuales + "\n\nGenerate tracker:\n{\"nuevos_conflictos\":[{\"nombre\":\"Name\",\"ubicacion\":\"Country\",\"partes\":\"Actor A vs Actor B\",\"resumen\":\"2-3 sentences\",\"ultimos_acontecimientos\":\"1-2 sentences\",\"nivel_alerta\":\"alto\"}],\"actualizaciones\":[{\"conflicto\":\"Exact name\",\"ubicacion\":\"Country\",\"partes\":\"Actors\",\"ultimos_acontecimientos\":\"Update\"}]}"
    ),
    callClaude(
      "You are a geopolitical expert. Respond ONLY with valid JSON.",
      "News:\n" + titularesIA + "\n\nGenerate 3 analysis topics:\n{\"tematicas\":[{\"id\":\"a1\",\"titulo\":\"Title\",\"subtitulo\":\"Focus\",\"descripcion\":\"Relevance\",\"zonas\":[\"Europe\"],\"secciones_sugeridas\":[\"Sec1\",\"Sec2\",\"Sec3\"]}]}"
    ),
    callClaude(
      "You are a geopolitical expert. Respond ONLY with valid JSON.",
      "News:\n" + titularesIA + "\n\nGenerate 4 library suggestions:\n{\"sugerencias\":[{\"id\":\"b1\",\"zona\":\"Europe\",\"titulo\":\"Title\",\"descripcion\":\"Content\",\"motivo\":\"Why now\",\"subtemas\":[\"sub1\",\"sub2\"]}]}"
    ),
  ]);

  const enc = results[0];
  const trk = results[1];
  const ana = results[2];
  const bib = results[3];
  console.log("Enc:" + enc.status + " Trk:" + trk.status + " Ana:" + ana.status + " Bib:" + bib.status);

  if (trk.status === "fulfilled") {
    const nuevoTracker = trk.value;
    const conflictosExistentes = trackerExistente.conflictos || [];
    const nombresExistentes = new Set(conflictosExistentes.map(function(c) { return c.nombre.toLowerCase(); }));
    const nuevos = nuevoTracker.nuevos_conflictos || [];
    for (let i = 0; i < nuevos.length; i++) {
      const c = nuevos[i];
      if (!nombresExistentes.has(c.nombre.toLowerCase())) {
        conflictosExistentes.push(Object.assign({}, c, { id: "c" + Date.now(), timestamp: ahora }));
        nombresExistentes.add(c.nombre.toLowerCase());
      }
    }
    const actualizaciones = nuevoTracker.actualizaciones || [];
    for (let i = 0; i < actualizaciones.length; i++) {
      const u = actualizaciones[i];
      for (let j = 0; j < conflictosExistentes.length; j++) {
        if (conflictosExistentes[j].nombre.toLowerCase() === u.conflicto.toLowerCase()) {
          conflictosExistentes[j] = Object.assign({}, conflictosExistentes[j], u, { nombre: conflictosExistentes[j].nombre, ultimaActualizacion: ahora });
          break;
        }
      }
    }
    await saveTracker({ conflictos: conflictosExistentes });
  }

  const trackerFinal = await getTrackerSaved();

  return {
    noticias: noticiasFinales,
    encuestas: enc.status === "fulfilled" ? (enc.value.encuestas || []) : [],
    tracker: trackerFinal,
    analisis: ana.status === "fulfilled" ? (ana.value.tematicas || []) : [],
    biblioteca: bib.status === "fulfilled" ? (bib.value.sugerencias || []) : [],
    lastUpdate: new Date().toISOString(),
  };
}

let cache = { noticias: [], encuestas: [], tracker: { conflictos: [] }, analisis: [], biblioteca: [], lastUpdate: null };
let cicloCorriendo = false;

async function cicloActualizacion() {
  if (cicloCorriendo) {
    console.log("Cycle already running, skipping");
    return;
  }
  cicloCorriendo = true;
  console.log("Starting update cycle...");
  try {
    const titulares = await recogerNoticias();
    console.log("Headlines collected: " + titulares.length);
    cache = await analizarNoticias(titulares);
    console.log("Update completed");
    if (process.env.BASE44_API_KEY) {
      await sincronizarBase44(cache.noticias, cache.tracker);
    }
  } catch (e) {
    console.error("Cycle error: " + e.message);
  } finally {
    cicloCorriendo = false;
  }
}

async function init() {
  const saved = await Promise.all([getNoticiasSaved(), getTrackerSaved()]);
  cache.noticias = filtrarNoticias24h(saved[0]);
  cache.tracker = saved[1];
  cicloActualizacion();
}

init();
setInterval(cicloActualizacion, 30 * 60 * 1000);

app.get("/", function(req, res) { res.json({ status: "ok", lastUpdate: cache.lastUpdate }); });
app.get("/api/datos", function(req, res) { res.json(cache); });

app.post("/api/actualizar", function(req, res) {
  cicloActualizacion();
  res.json({ message: "Update started" });
});

app.delete("/api/noticias/:id", async function(req, res) {
  const id = req.params.id;
  const noticias = await getNoticiasSaved();
  const nuevas = noticias.filter(function(n) { return n.id !== id; });
  await saveNoticias(nuevas);
  cache.noticias = nuevas;
  res.json({ message: "Deleted", total: nuevas.length });
});

app.delete("/api/tracker/:nombre", async function(req, res) {
  const nombre = decodeURIComponent(req.params.nombre);
  const tracker = await getTrackerSaved();
  tracker.conflictos = (tracker.conflictos || []).filter(function(c) { return c.nombre !== nombre; });
  await saveTracker(tracker);
  cache.tracker = tracker;
  res.json({ message: "Conflict removed" });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, function() { console.log("Server running on port " + PORT); });
server.on("error", function(err) {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " in use, retrying in 5s...");
    setTimeout(function() { server.listen(PORT); }, 5000);
  }
});
});
