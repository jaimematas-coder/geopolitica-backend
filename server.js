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
    setTimeout(function() { reject(new Error("Timeout 60s")); }, 60000);
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
  const ahoraISO = new Date().toISOString();

  // Noticias con puntuacion >= 8, verificando tambien contra Base44
  try {
    const hoy = new Date().toISOString().split("T")[0];
    const existentesB44 = await base44Request("GET", "entities/Noticia?limit=100&filters=" + encodeURIComponent(JSON.stringify({ fecha: hoy })));
    const titularesB44 = new Set((existentesB44 || []).map(function(n) {
      return generarIdNoticia(n.titular || "");
    }));

    let publicadas = 0;
    for (let i = 0; i < noticias.length; i++) {
      const n = noticias[i];
      if ((n.puntuacion || 0) < 8) continue;
      const key = generarIdNoticia(n.titular || "");
      if (titularesB44.has(key)) continue;
      await base44Request("POST", "entities/Noticia", {
        fecha: hoy,
        titular: n.titular || "",
        resumen: n.resumen || "",
        bullets: n.bullets || [],
        criterio: n.analisis || "",
        estado: "publicado",
      });
      titularesB44.add(key);
      publicadas++;
    }
    console.log("Base44 noticias: " + publicadas + " published");
  } catch (e) { console.error("Base44 noticias error: " + e.message); }

  // Tracker con historial
  try {
    const conflictos = (tracker && tracker.conflictos) || [];
    const existentesConflictos = await base44Request("GET", "entities/Conflicto?limit=100");
    const nombresExistentes = new Map((existentesConflictos || []).map(function(c) {
      return [(c.nombre || "").toLowerCase(), c.id];
    }));
    let sincronizados = 0;

    for (let i = 0; i < conflictos.length; i++) {
      const c = conflictos[i];
      const key = (c.nombre || "").toLowerCase();
      const nivelMap = { alto: "Alto", medio: "Medio", bajo: "Bajo" };
      const nivel = nivelMap[c.nivel_alerta] || "Medio";
      const ultimoAcontecimiento = c.ultimos_acontecimientos || c.update || "";

      if (nombresExistentes.has(key)) {
        const existingId = nombresExistentes.get(key);
        let historialActual = [];
        try {
          const existing = await base44Request("GET", "entities/Conflicto/" + existingId);
          historialActual = existing.historial || [];
        } catch (e) { historialActual = []; }

        if (ultimoAcontecimiento) {
          historialActual.unshift({ texto: ultimoAcontecimiento, timestamp: ahoraISO });
          historialActual = historialActual.slice(0, 3);
        }

        const ubicacionesPrincipal = c.ubicaciones && c.ubicaciones.length > 0 ? c.ubicaciones : null;
        const updateData = {
          ubicacion: c.ubicacion || "",
          partes: c.partes || "",
          nivel_tension: nivel,
          resumen_semana: ultimoAcontecimiento,
          historial: historialActual,
          estado: "activo",
          actualizado_en: ahoraISO,
        };
        if (c.actualizar_resumen && c.nuevo_resumen) {
          updateData.resumen = c.nuevo_resumen;
        }
        if (ubicacionesPrincipal) {
          updateData.ubicaciones = ubicacionesPrincipal;
          const principal = ubicacionesPrincipal.find(function(u) { return u.es_principal; }) || ubicacionesPrincipal[0];
          if (principal) { updateData.pos_x = principal.pos_x; updateData.pos_y = principal.pos_y; }
        }
        await base44Request("PUT", "entities/Conflicto/" + existingId, updateData);
      } else {
        const historialInicial = ultimoAcontecimiento
          ? [{ texto: ultimoAcontecimiento, timestamp: ahoraISO }]
          : [];
        const ubicacionesNuevo = c.ubicaciones && c.ubicaciones.length > 0 ? c.ubicaciones : null;
        const createData = {
          nombre: c.nombre || "",
          ubicacion: c.ubicacion || "",
          partes: c.partes || "",
          nivel_tension: nivel,
          resumen_semana: ultimoAcontecimiento,
          historial: historialInicial,
          estado: "activo",
          actualizado_en: ahoraISO,
        };
        if (ubicacionesNuevo) {
          createData.ubicaciones = ubicacionesNuevo;
          const principal = ubicacionesNuevo.find(function(u) { return u.es_principal; }) || ubicacionesNuevo[0];
          if (principal) { createData.pos_x = principal.pos_x; createData.pos_y = principal.pos_y; }
        }
        await base44Request("POST", "entities/Conflicto", createData);
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
    "Eres analista geopolitico senior con 15 anos de experiencia. Responde UNICAMENTE con JSON valido y completo. Sin markdown.",
    "Fecha: " + fecha + ".\nTitulares:\n" + resumen + "\n\nAnaliza y selecciona las 5 noticias mas relevantes geopoliticamente. Si varios titulares tratan el mismo acontecimiento aunque vengan de distintos medios, cuentalos como UNA SOLA noticia. No repitas temas. Responde en ESPANOL.\n{\"noticias\":[{\"id\":\"n1\",\"puntuacion\":8,\"titular\":\"Titular breve\",\"resumen\":\"1-2 frases\",\"bullets\":[\"Frase corta max 10 palabras\",\"Frase corta max 10 palabras\",\"Frase corta max 10 palabras\"],\"analisis\":\"Una frase larga y densa con perspectiva real: implicaciones o consecuencias no evidentes.\",\"medio\":\"BBC\",\"link\":\"https://...\",\"region\":\"Europa\"}]}"
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

  const titularesIA = noticiasArr.map(function(n) { return "- " + n.titular; }).join("\n") || "- Sin noticias";
  const trackerExistente = await getTrackerSaved();
  const conflictosExistentesLista = trackerExistente.conflictos || [];
  const conflictosActuales = conflictosExistentesLista.map(function(c) { return c.nombre; }).join(", ") || "ninguno";

  console.log("Running parallel analysis...");
  const results = await Promise.allSettled([
    callClaude(
      "Eres experto en comunidades de divulgacion. Responde UNICAMENTE con JSON valido. Responde en ESPANOL.",
      "Noticias:\n" + titularesIA + "\n\nGenera 3 encuestas:\n{\"encuestas\":[{\"id\":\"e1\",\"titulo\":\"Pregunta\",\"opciones\":[\"A\",\"B\",\"C\"],\"motivo\":\"Razon\",\"basada_en\":\"Noticia\"}]}"
    ),
    callClaude(
      "Eres analista de conflictos internacionales senior. Responde UNICAMENTE con JSON valido. Responde en ESPANOL.",
      "Noticias de hoy:\n" + titularesIA + "\nConflictos actualmente en seguimiento (" + conflictosExistentesLista.length + "/8): " + conflictosActuales + "\n\nTu tarea es gestionar el tracker de conflictos. REGLAS ESTRICTAS:\n1. El tracker solo contiene CONFLICTOS ESTRUCTURALES de largo plazo: guerras, tensiones militares persistentes, crisis diplomaticas profundas, disputas territoriales cronicas.\n2. NO añadas conflictos por noticias puntuales aunque sean importantes. Una acusacion de la ONU, un fallo informatico, una disputa de peajes, una sentencia judicial NO son conflictos del tracker. Van al Diario.\n3. Si una noticia es una actualizacion de un conflicto ya trackeado, ponla como actualizacion de ese conflicto, no como conflicto nuevo.\n4. Solo propon un conflicto NUEVO si es el inicio de algo estructural y duradero (una guerra, una crisis que durara meses o anos).\n5. Si ya hay 8 conflictos y propones uno nuevo, indica cual sustituirias y por que (el menos relevante a largo plazo).\n6. MAXIMO 8 conflictos en total.\n7. Para cada conflicto incluye el campo ubicaciones: array con todas las zonas afectadas. Cada ubicacion tiene nombre (pais o ciudad especifica si es relevante), es_principal (true solo para la zona principal), pos_x y pos_y (posicion en mapa mundi como porcentaje 0-100, donde x=0 es extremo oeste y x=100 es extremo este, y=0 es norte y y=100 es sur). Ejemplos de referencia: Madrid pos_x=47,pos_y=38; Londres pos_x=48,pos_y=30; Moscu pos_x=59,pos_y=28; Gaza pos_x=57,pos_y=43; Ucrania pos_x=56,pos_y=30; Sudan pos_x=55,pos_y=52; Siria pos_x=58,pos_y=40.\n\n{\"nuevos_conflictos\":[{\"nombre\":\"Nombre del conflicto estructural\",\"ubicacion\":\"Ubicacion principal (texto)\",\"ubicaciones\":[{\"nombre\":\"Ciudad o pais\",\"es_principal\":true,\"pos_x\":55,\"pos_y\":43},{\"nombre\":\"Segunda zona afectada\",\"es_principal\":false,\"pos_x\":48,\"pos_y\":30}],\"partes\":\"Actor A vs Actor B\",\"resumen\":\"2-3 frases explicando el conflicto y su origen historico\",\"ultimos_acontecimientos\":\"1-2 frases con la novedad de hoy si la hay\",\"nivel_alerta\":\"alto\",\"sustituye_a\":\"\"}],\"actualizaciones\":[{\"conflicto\":\"Nombre exacto del conflicto en seguimiento\",\"ubicacion\":\"Ubicacion principal\",\"ubicaciones\":[{\"nombre\":\"Ciudad o pais\",\"es_principal\":true,\"pos_x\":55,\"pos_y\":43}],\"partes\":\"Actores\",\"ultimos_acontecimientos\":\"1-2 frases con la novedad basada en las noticias de hoy\",\"actualizar_resumen\":false,\"nuevo_resumen\":\"\"}]}"
    ),
    callClaude(
      "Eres experto en divulgacion geopolitica. Responde UNICAMENTE con JSON valido. Responde en ESPANOL.",
      "Noticias:\n" + titularesIA + "\n\nGenera 3 tematicas para analisis del mes:\n{\"tematicas\":[{\"id\":\"a1\",\"titulo\":\"Titulo\",\"subtitulo\":\"Enfoque\",\"descripcion\":\"Relevancia\",\"zonas\":[\"Europa\"],\"secciones_sugeridas\":[\"Sec1\",\"Sec2\",\"Sec3\"]}]}"
    ),
    callClaude(
      "Eres experto en divulgacion geopolitica. Responde UNICAMENTE con JSON valido. Responde en ESPANOL.",
      "Noticias:\n" + titularesIA + "\n\nGenera 4 sugerencias de biblioteca:\n{\"sugerencias\":[{\"id\":\"b1\",\"zona\":\"Europa\",\"titulo\":\"Titulo\",\"descripcion\":\"De que trata\",\"motivo\":\"Por que ahora\",\"subtemas\":[\"sub1\",\"sub2\"]}]}"
    ),
  ]);

  const enc = results[0];
  const trk = results[1];
  const ana = results[2];
  const bib = results[3];
  console.log("Enc:" + enc.status + " Trk:" + trk.status + " Ana:" + ana.status + " Bib:" + bib.status);

  if (trk.status === "fulfilled") {
    const nuevoTracker = trk.value;
    const conflictosExistentes = conflictosExistentesLista;
    const nombresExistentes = new Set(conflictosExistentes.map(function(c) { return c.nombre.toLowerCase(); }));
    const nuevos = nuevoTracker.nuevos_conflictos || [];

    for (let i = 0; i < nuevos.length; i++) {
      const c = nuevos[i];
      if (conflictosExistentes.length >= 8) {
        if (c.sustituye_a) {
          const idxSustituir = conflictosExistentes.findIndex(function(x) {
            return x.nombre.toLowerCase() === (c.sustituye_a || "").toLowerCase();
          });
          if (idxSustituir !== -1) {
            console.log("Replacing: " + c.sustituye_a + " -> " + c.nombre);
            conflictosExistentes.splice(idxSustituir, 1);
            nombresExistentes.delete(c.sustituye_a.toLowerCase());
          } else { continue; }
        } else { continue; }
      }
      if (!nombresExistentes.has(c.nombre.toLowerCase())) {
        conflictosExistentes.push(Object.assign({}, c, { id: "c" + Date.now(), timestamp: ahora }));
        nombresExistentes.add(c.nombre.toLowerCase());
      }
    }

    const actualizaciones = nuevoTracker.actualizaciones || [];
    for (let i = 0; i < actualizaciones.length; i++) {
      const u = actualizaciones[i];
      for (let j = 0; j < conflictosExistentes.length; j++) {
        if (conflictosExistentes[j].nombre.toLowerCase() === (u.conflicto || "").toLowerCase()) {
          conflictosExistentes[j] = Object.assign({}, conflictosExistentes[j], u, {
            nombre: conflictosExistentes[j].nombre,
            ultimaActualizacion: ahora
          });
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
