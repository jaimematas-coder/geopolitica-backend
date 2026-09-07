const express = require("express");
const cors = require("cors");
const RSSParser = require("rss-parser");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
const parser = new RSSParser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["enclosure", "enclosure", { keepArray: false }],
    ]
  }
});
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = "https://api.telegram.org/bot" + TELEGRAM_TOKEN;

// ── Seguimientos por defecto ──────────────────────────────────────────────────
const SEGUIMIENTOS_DEFAULT = [
  "Guerra Ucrania-Rusia",
  "Guerra Israel-Gaza",
  "Guerra en Sudan",
  "Tension EEUU-Iran",
  "Crisis Mar Rojo",
  "Guerra Civil Myanmar",
  "Tension China-Taiwan",
];

// ── Medios RSS ────────────────────────────────────────────────────────────────
const RSS_FEEDS = [
  // Generalistas internacionales
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "AP News", url: "https://feeds.apnews.com/rss/apf-intlnews" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss" },
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "France 24", url: "https://www.france24.com/es/rss" },
  { name: "Der Spiegel", url: "https://www.spiegel.de/international/index.rss" },
  { name: "El Pais Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "El Confidencial Mundo", url: "https://www.elconfidencial.com/mundo/rss/" },
  { name: "DW World", url: "https://rss.dw.com/rss/en-all" },
  { name: "Euronews", url: "https://feeds.feedburner.com/euronews/en/news/" },
  { name: "The Economist", url: "https://www.economist.com/international/rss.xml" },
  { name: "Financial Times World", url: "https://www.ft.com/world?format=rss" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { name: "Washington Post World", url: "https://feeds.washingtonpost.com/rss/world" },
  { name: "Politico EU", url: "https://www.politico.eu/feed/" },
  // Think tanks y analisis estrategico
  { name: "Crisis Group", url: "https://www.crisisgroup.org/rss.xml" },
  { name: "Foreign Affairs", url: "https://www.foreignaffairs.com/rss.xml" },
  { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/" },
  { name: "The Diplomat", url: "https://thediplomat.com/feed/" },
  { name: "War on the Rocks", url: "https://warontherocks.com/feed/" },
  { name: "Bellingcat", url: "https://www.bellingcat.com/feed/" },
  { name: "Brookings", url: "https://www.brookings.edu/feed/" },
  { name: "Chatham House", url: "https://www.chathamhouse.org/rss.xml" },
  { name: "ECFR", url: "https://ecfr.eu/feed/" },
  { name: "CFR", url: "https://www.cfr.org/rss/feeds/publication_types/expert_brief" },
  { name: "CSIS", url: "https://www.csis.org/rss.xml" },
  { name: "Carnegie Endowment", url: "https://carnegieendowment.org/rss/solr.xml" },
  { name: "IISS", url: "https://www.iiss.org/rss" },
  { name: "Washington Institute", url: "https://www.washingtoninstitute.org/rss.xml" },
  { name: "Arab Center DC", url: "https://arabcenterdc.org/feed/" },
  { name: "Middle East Institute", url: "https://www.mei.edu/rss.xml" },
  // MENA especializados
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "Middle East Eye", url: "https://www.middleeasteye.net/rss" },
  { name: "Arab News", url: "https://www.arabnews.com/rss.xml" },
  { name: "The National UAE", url: "https://www.thenationalnews.com/rss" },
  { name: "Al Monitor", url: "https://www.al-monitor.com/rss" },
  { name: "Haaretz English", url: "https://www.haaretz.com/cmlink/1.628752" },
  { name: "Jerusalem Post", url: "https://www.jpost.com/rss/rssfeedsheadlines.aspx" },
  { name: "Asharq Al Awsat", url: "https://english.aawsat.com/rss.xml" },
  { name: "Middle East Monitor", url: "https://www.middleeastmonitor.com/feed/" },
  { name: "Rudaw", url: "https://www.rudaw.net/rss" },
  { name: "Iran International", url: "https://www.iranintl.com/en/rss" },
  { name: "Daily Sabah", url: "https://www.dailysabah.com/rssFeed/push_notifications" },
  { name: "Morocco World News", url: "https://www.moroccoworldnews.com/feed" },
  { name: "Egypt Independent", url: "https://egyptindependent.com/feed/" },
  { name: "Orient XXI", url: "https://orientxxi.info/spip.php?page=backend" },
  { name: "MEE Opinion", url: "https://www.middleeasteye.net/opinion/rss" },
  // Asia, Africa y otros
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "The Hindu World", url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "Asia Times", url: "https://asiatimes.com/feed/" },
  { name: "African Arguments", url: "https://africanarguments.org/feed/" },
  { name: "Agencia EFE", url: "https://www.efe.com/efe/espana/mundo/rss/16" },
];

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function getConfig(key, defaultVal) {
  try {
    const data = await redis.get(key);
    if (data === null || data === undefined) return defaultVal;
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) { return defaultVal; }
}

async function setConfig(key, value) {
  try { await redis.set(key, JSON.stringify(value)); }
  catch (e) { console.error("Error setting config " + key + ": " + e.message); }
}

async function getSeguimientos() {
  return getConfig("seguimientos", SEGUIMIENTOS_DEFAULT);
}

async function getFrecuencia() {
  return getConfig("frecuencia_min", 30);
}

async function getApagado() {
  return getConfig("apagado", false);
}

async function getEnviadas() {
  return getConfig("enviadas", []);
}

async function saveEnviadas(enviadas) {
  await setConfig("enviadas", enviadas);
}

function generarId(titular) {
  return titular.toLowerCase()
    .replace(/[aáàä]/g, "a").replace(/[eéèë]/g, "e")
    .replace(/[iíìï]/g, "i").replace(/[oóòö]/g, "o").replace(/[uúùü]/g, "u")
    .replace(/\b(el|la|los|las|un|una|de|del|en|con|por|que|se|al|y|a|su|sus|es|son|ha|han|para|sobre|tras|ante|como|pero|sin|entre|desde|hasta|no|le|les|lo)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .split("").sort().join("")
    .slice(0, 35);
}

function filtrar24h(items) {
  const ahora = Date.now();
  return items.filter(function(n) { return (ahora - n.timestamp) < 24 * 60 * 60 * 1000; });
}

function extraerImagenRSS(item) {
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) return item.mediaContent.$.url;
  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) return item.mediaThumbnail.$.url;
  if (item.enclosure && item.enclosure.type && item.enclosure.type.startsWith("image")) return item.enclosure.url;
  if (item.content) {
    const match = item.content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) return match[1];
  }
  return null;
}

// ── Claude ────────────────────────────────────────────────────────────────────
async function callClaude(system, user) {
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model: "claude-sonnet-4-6", max_tokens: 4000, system: system, messages: [{ role: "user", content: user }] },
    {
      timeout: 60000,
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
    }
  );
  const text = (response.data.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
  const start = text.indexOf("{");
  let end = text.lastIndexOf("}");
  while (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); }
    catch (e) { end = text.lastIndexOf("}", end - 1); }
  }
  throw new Error("No JSON found");
}

// ── RSS ───────────────────────────────────────────────────────────────────────
async function recogerNoticias() {
  const titulares = [];
  for (let i = 0; i < RSS_FEEDS.length; i++) {
    const feed = RSS_FEEDS[i];
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, 5);
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const pubDate = item.pubDate || item.isoDate;
        titulares.push({
          titulo: item.title || "",
          resumen: item.contentSnippet || "",
          link: item.link || "",
          medio: feed.name,
          imagen: extraerImagenRSS(item),
          pubDate: pubDate ? new Date(pubDate).getTime() : Date.now(),
        });
      }
    } catch (e) { console.warn("Error reading " + feed.name + ": " + e.message); }
  }
  return titulares;
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function enviarMensajeTelegram(payload) {
  await axios.post(TELEGRAM_API + "/" + payload.method, payload.body, { timeout: 15000 });
}

async function enviarNoticiaTelegram(noticia, esRecuperacion) {
  const urgencia = noticia.puntuacion >= 9 ? "🔴 URGENTE" : noticia.puntuacion >= 8 ? "🟠 IMPORTANTE" : "🟡 DESTACADO";
  const temaEmoji = { "Conflictos armados": "⚔️", "Diplomacia": "🤝", "Seguridad y defensa": "🛡️", "Economia global": "💰", "Energia y recursos": "⚡", "Derechos humanos": "🕊️" };
  const emojiTema = temaEmoji[noticia.categoria_tematica] || "🌍";
  const etiquetaSeguimiento = (noticia.seguimiento && noticia.seguimiento !== "") ? "\n🔔 *SEGUIMIENTO:* " + noticia.seguimiento : "";
  const etiquetaRecuperacion = esRecuperacion ? "\n🕐 *Noticia reciente no enviada*" : "";

  let bloqueTriangulacion = "\n\n*📡 VERIFICACION:*";
  if (noticia.triangulacion && noticia.triangulacion.fuentes_contrastadas && noticia.triangulacion.fuentes_contrastadas.length > 0) {
    bloqueTriangulacion += " " + noticia.triangulacion.fuentes_contrastadas.join(", ");
    if (noticia.triangulacion.contradicciones && noticia.triangulacion.contradicciones !== "") {
      bloqueTriangulacion += "\n⚠️ _Contradiccion: " + noticia.triangulacion.contradicciones + "_";
    } else {
      bloqueTriangulacion += "\n✅ _Fuentes consistentes_";
    }
  } else {
    bloqueTriangulacion += " _Fuente unica_";
  }

  const imagenFuente = noticia.imagen_fuente ? "\n🖼️ _Imagen: " + noticia.imagen_fuente + "_" : "";
  const linksStr = (noticia.fuentes_links || []).map(function(f) { return "• [" + f.medio + "](" + f.url + ")"; }).join("\n");

  let bloqueExtra = "";
  if (noticia.extra && noticia.extra.contenido && noticia.extra.contenido !== "null" && noticia.extra.contenido !== "") {
    const extraEmoji = { "claves": "🔑 *3 CLAVES:*", "implicaciones": "❓ *QUE IMPLICA:*", "visita_estado": "🤝 *QUE SE BUSCA / CONSIGUE:*", "reaccion_potencias": "🌐 *REACCION INTERNACIONAL:*" };
    const extraLabel = extraEmoji[noticia.extra.tipo] || "📌 *NOTA:*";
    bloqueExtra = "\n\n" + extraLabel + "\n" + noticia.extra.contenido;
  }

  // Mensaje 1: interno
  const msg1 = urgencia + etiquetaSeguimiento + etiquetaRecuperacion + "\n" +
    emojiTema + " *" + noticia.categoria_tematica + "* | " + noticia.region + "\n\n" +
    "📰 *" + noticia.titular + "*\n\n" +
    "*📊 ANALISIS INTERNO:*\n" + noticia.analisis_interno + "\n" +
    bloqueTriangulacion + "\n\n" +
    "*🔗 FUENTES:*\n" + linksStr + imagenFuente;

  const etiquetaSeguimiento = (noticia.seguimiento && noticia.seguimiento !== "") ? "🔔 Seguimiento: " + noticia.seguimiento + "\n" : "";

  const categoriaLinea = "🌍 " + noticia.categoria_tematica + " · " + noticia.region + "\n" + etiquetaSeguimiento;

  let bloqueExtra = "";
  if (noticia.extra && noticia.extra.contenido && noticia.extra.contenido !== "null" && noticia.extra.contenido !== "") {
    const extraEmoji = { "claves": "🔑 3 CLAVES:", "implicaciones": "❓ QUE IMPLICA:", "visita_estado": "🤝 QUE SE BUSCA / CONSIGUE:", "reaccion_potencias": "🌐 REACCION INTERNACIONAL:" };
    const extraLabel = extraEmoji[noticia.extra.tipo] || "📌 NOTA:";
    bloqueExtra = "\n\n" + extraLabel + "\n" + noticia.extra.contenido;
  }

  const fuentesLinea = "📰 " + (noticia.fuentes_links || []).map(function(f) { return f.medio; }).join(" · ");

  // Mensaje 2: externo listo para copiar
  const msg2 = categoriaLinea + "\n" +
    noticia.titular + "\n\n" +
    noticia.texto_instagram +
    bloqueExtra + "\n\n" +
    fuentesLinea;

  try {
    if (noticia.imagen) {
      await enviarMensajeTelegram({ method: "sendPhoto", body: { chat_id: TELEGRAM_CHAT_ID, photo: noticia.imagen, caption: msg1, parse_mode: "Markdown" } });
    } else {
      await enviarMensajeTelegram({ method: "sendMessage", body: { chat_id: TELEGRAM_CHAT_ID, text: msg1, parse_mode: "Markdown", disable_web_page_preview: false } });
    }
    await new Promise(function(r) { setTimeout(r, 1000); });
    await enviarMensajeTelegram({ method: "sendMessage", body: { chat_id: TELEGRAM_CHAT_ID, text: msg2, parse_mode: "Markdown" } });
    console.log("Sent: " + noticia.titular);
    return true;
  } catch (e) {
    console.error("Telegram error: " + e.message);
    return false;
  }
}

async function enviarTextoTelegram(texto) {
  try {
    await axios.post(TELEGRAM_API + "/sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: texto, parse_mode: "Markdown" }, { timeout: 10000 });
  } catch (e) { console.error("Telegram msg error: " + e.message); }
}

// ── Análisis ──────────────────────────────────────────────────────────────────
async function analizarYEnviar(titulares, esRecuperacion) {
  const fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const seguimientos = await getSeguimientos();
  const seguimientosStr = seguimientos.join(", ");

  const resumen = titulares.slice(0, 35).map(function(t) {
    return "- [" + t.medio + "] " + t.titulo + (t.imagen ? " [IMG]" : "");
  }).join("\n");

  console.log("Calling Claude...");
  const data = await callClaude(
    "Eres analista geopolitico senior especializado en Oriente Medio y Norte de Africa (MENA), aunque cubres geopolitica global. Responde UNICAMENTE con JSON valido y completo. Sin markdown.",
    "Fecha: " + fecha + ".\n" +
    "Seguimientos activos: " + seguimientosStr + "\n" +
    "Titulares (los marcados con [IMG] tienen imagen):\n" + resumen + "\n\n" +
    "INSTRUCCIONES:\n" +
    "1. Selecciona entre 4 y 6 noticias: 2-3 MENA con analisis profundo + 2-3 globales importantes. No excluyas noticias relevantes de otras regiones.\n" +
    "2. UMBRALES: para noticias MENA acepta puntuacion >= 6 (mayor sensibilidad regional). Para noticias globales acepta >= 8 (solo lo verdaderamente importante).\n" +
    "3. Si varios titulares cubren el mismo hecho, cuentalos como UNO y contrasta hasta 3 fuentes.\n" +
    "4. Decide si cada noticia requiere bloque extra (no siempre): claves, implicaciones, visita_estado, reaccion_potencias.\n" +
    "5. Si la noticia actualiza un seguimiento activo, indicalo.\n" +
    "6. Categorias tematicas: Conflictos armados, Diplomacia, Seguridad y defensa, Economia global, Energia y recursos, Derechos humanos.\n" +
    "7. Categorias de region: MENA, Europa, Asia-Pacifico, America, Africa Subsahariana, Global.\n\n" +
    "{\"noticias\":[{" +
    "\"puntuacion\":8," +
    "\"titular\":\"Titular breve en espanol\"," +
    "\"texto_instagram\":\"2-3 frases. Informativo o analitico segun requiera. Sin hashtags.\"," +
    "\"analisis_interno\":\"Por que importa y que angulo se ha elegido.\"," +
    "\"region\":\"MENA\"," +
    "\"categoria_tematica\":\"Conflictos armados\"," +
    "\"seguimiento\":\"Nombre del seguimiento o cadena vacia\"," +
    "\"fuentes_links\":[{\"medio\":\"Al Jazeera\",\"url\":\"https://...\"}]," +
    "\"triangulacion\":{\"fuentes_contrastadas\":[\"Medio1\",\"Medio2\"],\"contradicciones\":\"\"}," +
    "\"titulo_original\":\"Titulo original exacto\"," +
    "\"imagen_fuente\":\"\"," +
    "\"extra\":{\"tipo\":\"claves\",\"contenido\":\"\"}" +
    "}]}"
  );

  const noticias = data.noticias || [];
  console.log("Noticias seleccionadas: " + noticias.length);

  // Asociar imagen
  for (let i = 0; i < noticias.length; i++) {
    const n = noticias[i];
    const original = titulares.find(function(t) {
      return t.titulo && n.titulo_original &&
        t.titulo.toLowerCase().slice(0, 30) === n.titulo_original.toLowerCase().slice(0, 30);
    });
    if (original && original.imagen) {
      n.imagen = original.imagen;
      n.imagen_fuente = original.medio;
    } else { n.imagen = null; }
    if (n.extra && (!n.extra.contenido || n.extra.contenido === "" || n.extra.contenido === "null")) n.extra = null;
  }

  // Deduplicacion
  const enviadas = filtrar24h(await getEnviadas());
  const idsEnviados = new Set(enviadas.map(function(n) { return n.id; }));
  const nuevas = noticias.filter(function(n) { return !idsEnviados.has(generarId(n.titular)); });

  console.log("Nuevas a enviar: " + nuevas.length);

  for (let i = 0; i < nuevas.length; i++) {
    const enviado = await enviarNoticiaTelegram(nuevas[i], esRecuperacion || false);
    if (enviado) enviadas.push({ id: generarId(nuevas[i].titular), timestamp: Date.now() });
    if (i < nuevas.length - 1) await new Promise(function(r) { setTimeout(r, 3000); });
  }

  await saveEnviadas(enviadas);
  return noticias;
}

// ── Ciclo ─────────────────────────────────────────────────────────────────────
let intervalHandle = null;

async function cicloActualizacion(esRecuperacion) {
  const apagado = await getApagado();
  if (apagado) { console.log("Sistema apagado, skipping"); return; }

  try {
    const bloqueado = await redis.get("ciclo_lock");
    if (bloqueado) { console.log("Cycle already running, skipping"); return; }
    await redis.set("ciclo_lock", "1");
    await redis.expire("ciclo_lock", 300);
  } catch (e) { console.warn("Lock error: " + e.message); }

  console.log("Starting cycle" + (esRecuperacion ? " (recovery)" : "") + "...");
  try {
    const titulares = await recogerNoticias();
    console.log("Headlines: " + titulares.length);
    await analizarYEnviar(titulares, esRecuperacion);
    await setConfig("ultimo_ciclo", Date.now());
    console.log("Cycle completed");
  } catch (e) {
    console.error("Cycle error: " + e.message);
  } finally {
    try { await redis.del("ciclo_lock"); } catch (e) {}
  }
}

async function arrancarIntervalo() {
  if (intervalHandle) clearInterval(intervalHandle);
  const mins = await getFrecuencia();
  console.log("Interval set: every " + mins + " minutes");
  intervalHandle = setInterval(function() { cicloActualizacion(false); }, mins * 60 * 1000);
}

// ── Recuperacion al arrancar ──────────────────────────────────────────────────
async function init() {
  const apagado = await getApagado();
  const ultimoCiclo = await getConfig("ultimo_ciclo", 0);
  const ahoraMs = Date.now();
  const horasApagado = (ahoraMs - ultimoCiclo) / 3600000;

  if (!apagado && horasApagado > 0.6) {
    // Si ha pasado mas de 36 minutos desde el ultimo ciclo, hacer recuperacion
    console.log("Recovery mode: " + horasApagado.toFixed(1) + "h since last cycle");
    await enviarTextoTelegram("🔄 *Sistema reactivado*\nBuscando noticias importantes de las ultimas " + Math.round(horasApagado) + "h...");
    await cicloActualizacion(true);
  } else if (!apagado) {
    await cicloActualizacion(false);
  }

  await arrancarIntervalo();
}

// ── Comandos de Telegram ──────────────────────────────────────────────────────
async function procesarComando(texto) {
  const partes = texto.trim().split(" ");
  const cmd = partes[0].toLowerCase();

  if (cmd === "/estado") {
    const apagado = await getApagado();
    const frecuencia = await getFrecuencia();
    const seguimientos = await getSeguimientos();
    const ultimoCiclo = await getConfig("ultimo_ciclo", 0);
    const hace = ultimoCiclo ? Math.round((Date.now() - ultimoCiclo) / 60000) + " min" : "nunca";
    await enviarTextoTelegram(
      "*Estado del sistema*\n\n" +
      (apagado ? "🔴 APAGADO" : "🟢 ACTIVO") + "\n" +
      "⏱ Frecuencia: cada " + frecuencia + " min\n" +
      "🕐 Ultimo ciclo: hace " + hace + "\n\n" +
      "*Seguimientos activos:*\n" + seguimientos.map(function(s) { return "• " + s; }).join("\n")
    );
  } else if (cmd === "/encender") {
    await setConfig("apagado", false);
    await enviarTextoTelegram("🟢 Sistema *encendido*. Iniciando recuperacion de noticias...");
    await cicloActualizacion(true);
    await arrancarIntervalo();
  } else if (cmd === "/apagar") {
    await setConfig("apagado", true);
    await enviarTextoTelegram("🔴 Sistema *apagado*. Las noticias se seguiran acumulando y las recibiras al encender.");
  } else if (cmd === "/frecuencia") {
    const mins = parseInt(partes[1]);
    if (!mins || mins < 10 || mins > 360) {
      await enviarTextoTelegram("Uso: /frecuencia [minutos]\nEjemplo: /frecuencia 60\nMinimo: 10, Maximo: 360");
    } else {
      await setConfig("frecuencia_min", mins);
      await arrancarIntervalo();
      await enviarTextoTelegram("✅ Frecuencia actualizada: cada *" + mins + " minutos*");
    }
  } else if (cmd === "/seguimiento") {
    const accion = partes[1] && partes[1].toLowerCase();
    const nombre = partes.slice(2).join(" ");
    const seguimientos = await getSeguimientos();
    if (accion === "add" && nombre) {
      if (seguimientos.indexOf(nombre) === -1) {
        seguimientos.push(nombre);
        await setConfig("seguimientos", seguimientos);
        await enviarTextoTelegram("✅ Seguimiento añadido: *" + nombre + "*");
      } else {
        await enviarTextoTelegram("Ya existe ese seguimiento.");
      }
    } else if (accion === "remove" && nombre) {
      const idx = seguimientos.findIndex(function(s) { return s.toLowerCase() === nombre.toLowerCase(); });
      if (idx !== -1) {
        seguimientos.splice(idx, 1);
        await setConfig("seguimientos", seguimientos);
        await enviarTextoTelegram("✅ Seguimiento eliminado: *" + nombre + "*");
      } else {
        await enviarTextoTelegram("No se encontro ese seguimiento.");
      }
    } else if (accion === "list") {
      const lista = seguimientos.length > 0 ? seguimientos.map(function(s) { return "• " + s; }).join("\n") : "Sin seguimientos activos.";
      await enviarTextoTelegram("*Seguimientos activos:*\n" + lista);
    } else {
      await enviarTextoTelegram(
        "*Comandos de seguimiento:*\n" +
        "/seguimiento list\n" +
        "/seguimiento add [nombre]\n" +
        "/seguimiento remove [nombre]"
      );
    }
  } else if (cmd === "/ayuda") {
    await enviarTextoTelegram(
      "*Comandos disponibles:*\n\n" +
      "/estado — Ver estado del sistema\n" +
      "/encender — Activar el sistema\n" +
      "/apagar — Pausar el sistema\n" +
      "/frecuencia [min] — Cambiar frecuencia\n" +
      "/seguimiento list — Ver seguimientos\n" +
      "/seguimiento add [nombre] — Añadir\n" +
      "/seguimiento remove [nombre] — Eliminar\n" +
      "/ahora — Forzar analisis ahora\n" +
      "/ayuda — Ver esta lista"
    );
  } else if (cmd === "/ahora") {
    await enviarTextoTelegram("🔄 Lanzando analisis ahora...");
    cicloActualizacion(false);
  }
}

// ── Webhook de Telegram ───────────────────────────────────────────────────────
app.post("/webhook", async function(req, res) {
  res.sendStatus(200);
  const msg = req.body && req.body.message;
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) return;
  if (msg.text.startsWith("/")) {
    procesarComando(msg.text).catch(function(e) { console.error("Command error:", e.message); });
  }
});

init();

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.get("/", async function(req, res) {
  const apagado = await getApagado();
  const frecuencia = await getFrecuencia();
  const ultimoCiclo = await getConfig("ultimo_ciclo", 0);
  res.json({ status: apagado ? "off" : "on", frecuencia_min: frecuencia, lastUpdate: ultimoCiclo ? new Date(ultimoCiclo).toISOString() : null });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, function() {
  console.log("Server running on port " + PORT);
  // Registrar webhook de Telegram
  const webhookUrl = process.env.RENDER_EXTERNAL_URL + "/webhook";
  axios.post(TELEGRAM_API + "/setWebhook", { url: webhookUrl })
    .then(function() { console.log("Webhook set: " + webhookUrl); })
    .catch(function(e) { console.warn("Webhook error: " + e.message); });
});
server.on("error", function(err) {
  if (err.code === "EADDRINUSE") setTimeout(function() { server.listen(PORT); }, 5000);
});