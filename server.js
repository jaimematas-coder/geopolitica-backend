const express = require("express");
const cors = require("cors");
const RSSParser = require("rss-parser");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
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

app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = "https://api.telegram.org/bot" + TELEGRAM_TOKEN;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = "srv-d8tfplojs32c73bmg450";

var redis = null;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

var noticiasCache = {};

const SEGUIMIENTOS_DEFAULT = [
  "Guerra Ucrania-Rusia", "Guerra Israel-Gaza", "Guerra en Sudan",
  "Tension EEUU-Iran", "Crisis Mar Rojo", "Tension China-Taiwan",
];

const RSS_FEEDS = [
  // Agencias de noticias (prioridad maxima — publican antes)
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "AP News", url: "https://apnews.com/index.rss" },
  { name: "AFP via France 24", url: "https://www.france24.com/en/rss" },
  { name: "EFE", url: "https://www.efe.com/efe/espana/portada/rss/16" },
  { name: "Europa Press", url: "https://www.europapress.es/rss/rss.aspx?canal=00040" },
  // Bloomberg
  { name: "Bloomberg World", url: "https://feeds.bloomberg.com/politics/news.rss" },
  { name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss" },
  { name: "Bloomberg Middle East", url: "https://feeds.bloomberg.com/bview/news.rss" },
  // Generalistas anglosajones
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss" },
  { name: "The Independent World", url: "https://www.independent.co.uk/news/world/rss" },
  { name: "Newsweek World", url: "https://www.newsweek.com/rss" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { name: "Washington Post World", url: "https://feeds.washingtonpost.com/rss/world" },
  { name: "The Economist", url: "https://www.economist.com/international/rss.xml" },
  { name: "Financial Times World", url: "https://www.ft.com/world?format=rss" },
  // Europeos
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "Der Spiegel", url: "https://www.spiegel.de/international/index.rss" },
  { name: "Euronews", url: "https://feeds.feedburner.com/euronews/en/news/" },
  { name: "Politico EU", url: "https://www.politico.eu/feed/" },
  // Hispanohablantes
  { name: "El Pais Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "El Mundo Internacional", url: "https://e00-elmundo.uecdn.es/elmundo/rss/internacional.xml" },
  // Asiaticos y multilateralistas
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "Global Times", url: "https://www.globaltimes.cn/rss/outbrain.xml" },
  { name: "The Hindu World", url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "The Straits Times", url: "https://www.straitstimes.com/news/world/rss.xml" },
  { name: "TASS English", url: "https://tass.com/rss/v2.xml" },
  // Africa y America Latina
  { name: "African Arguments", url: "https://africanarguments.org/feed/" },
  { name: "Folha Internacional", url: "https://feeds.folha.uol.com.br/mundo/rss091.xml" },
  // Think tanks
  { name: "Crisis Group", url: "https://www.crisisgroup.org/rss.xml" },
  { name: "Foreign Affairs", url: "https://www.foreignaffairs.com/rss.xml" },
  { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/" },
  { name: "The Diplomat", url: "https://thediplomat.com/feed/" },
  { name: "War on the Rocks", url: "https://warontherocks.com/feed/" },
  { name: "Bellingcat", url: "https://www.bellingcat.com/feed/" },
  { name: "ECFR", url: "https://ecfr.eu/feed/" },
  { name: "CSIS", url: "https://www.csis.org/rss.xml" },
  { name: "Arab Center DC", url: "https://arabcenterdc.org/feed/" },
  // MENA especializados
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "Al Monitor", url: "https://www.al-monitor.com/rss" },
  { name: "Jerusalem Post", url: "https://www.jpost.com/rss/rssfeedsheadlines.aspx" },
  { name: "Middle East Monitor", url: "https://www.middleeastmonitor.com/feed/" },
  { name: "Daily Sabah", url: "https://www.dailysabah.com/rssFeed/push_notifications" },
  { name: "Egypt Independent", url: "https://egyptindependent.com/feed/" },
  { name: "Arab News EN", url: "https://www.arabnews.com/node/rss.xml" },
  { name: "The National", url: "https://www.thenationalnews.com/rss/world" },
  { name: "Rudaw EN", url: "https://www.rudaw.net/english/rss" },
];

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function redisGet(key, def) {
  try {
    var d = await getRedis().get(key);
    if (d === null || d === undefined) return def;
    return typeof d === "string" ? JSON.parse(d) : d;
  } catch (e) { return def; }
}
async function redisSet(key, val) {
  try { await getRedis().set(key, JSON.stringify(val)); }
  catch (e) { console.warn("Redis set: " + e.message); }
}

async function getSeguimientos() { return redisGet("seguimientos", SEGUIMIENTOS_DEFAULT); }
async function getFrecuencia() { return redisGet("frecuencia_min", 30); }

// ── Historial de noticias enviadas (para deduplicacion semantica) ─────────────
async function getHistorialEnviadas() {
  try {
    var data = await getRedis().get("historial_noticias");
    if (!data) return [];
    var parsed = typeof data === "string" ? JSON.parse(data) : data;
    // Filtrar solo las de las ultimas 48h
    var ahora = Date.now();
    return parsed.filter(function(h) { return (ahora - h.ts) < 48 * 3600000; });
  } catch (e) { return []; }
}

async function guardarEnHistorial(titular, resumenTematico) {
  try {
    var historial = await getHistorialEnviadas();
    historial.push({ titular: titular, tema: resumenTematico, ts: Date.now() });
    // Mantener solo ultimas 48h
    var ahora = Date.now();
    historial = historial.filter(function(h) { return (ahora - h.ts) < 48 * 3600000; });
    await getRedis().set("historial_noticias", JSON.stringify(historial));
    await getRedis().expire("historial_noticias", 172800); // 48h TTL
  } catch (e) { console.warn("Historial save error: " + e.message); }
}

// ── Render API ────────────────────────────────────────────────────────────────
async function suspenderServidor() {
  try {
    await axios.post(
      "https://api.render.com/v1/services/" + RENDER_SERVICE_ID + "/suspend",
      {},
      { headers: { "Authorization": "Bearer " + RENDER_API_KEY, "Content-Type": "application/json" } }
    );
    return true;
  } catch (e) { console.error("Error suspendiendo: " + e.message); return false; }
}

// ── Imagen ────────────────────────────────────────────────────────────────────
function extraerImagenRSS(item) {
  var candidatas = [];
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url)
    candidatas.push({ url: item.mediaContent.$.url, w: parseInt(item.mediaContent.$.width || "0") });
  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url)
    candidatas.push({ url: item.mediaThumbnail.$.url, w: parseInt(item.mediaThumbnail.$.width || "0") });
  if (item.enclosure && item.enclosure.type && item.enclosure.type.startsWith("image"))
    candidatas.push({ url: item.enclosure.url, w: 0 });
  if (item.content) {
    var m = item.content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) candidatas.push({ url: m[1], w: 0 });
  }
  for (var i = 0; i < candidatas.length; i++) {
    var c = candidatas[i];
    var u = (c.url || "").toLowerCase();
    if (!c.url) continue;
    if (u.includes("logo") || u.includes("avatar") || u.includes("profile") ||
        u.includes("icon") || u.includes("author") || u.includes("badge") ||
        u.includes("sprite") || u.includes("1x1") || u.includes("placeholder")) continue;
    if (c.w > 0 && c.w < 300) continue;
    return c.url;
  }
  return null;
}

// ── Descarga de contenido ─────────────────────────────────────────────────────
async function descargarContenido(url) {
  try {
    var res = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "es,en;q=0.9",
      },
      maxRedirects: 3,
    });
    var html = res.data || "";
    var texto = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (texto.length < 300) {
      console.warn("Contenido insuficiente: " + url);
      return null;
    }
    return texto.slice(0, 3000);
  } catch (e) {
    console.warn("No se pudo descargar " + url + ": " + e.message);
    return null;
  }
}

// ── Claude ────────────────────────────────────────────────────────────────────
async function callClaude(system, user) {
  var timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error("Claude timeout 90s")); }, 90000);
  });
  var claudePromise = anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 4000, system: system,
    messages: [{ role: "user", content: user }]
  });
  var msg = await Promise.race([claudePromise, timeoutPromise]);
  var text = (msg.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
  var start = text.indexOf("{");
  var end = text.lastIndexOf("}");
  while (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); }
    catch (e) { end = text.lastIndexOf("}", end - 1); }
  }
  throw new Error("No JSON found");
}

// ── RSS ───────────────────────────────────────────────────────────────────────
async function recogerNoticias() {
  var ahora = Date.now();
  var limite = ahora - 48 * 3600000;
  var titulares = [];
  for (var i = 0; i < RSS_FEEDS.length; i++) {
    var feed = RSS_FEEDS[i];
    try {
      var parsed = await parser.parseURL(feed.url);
      var items = (parsed.items || []).slice(0, 5);
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var pub = item.pubDate || item.isoDate;
        var ts = pub ? new Date(pub).getTime() : ahora;
        if (ts < limite) continue;
        titulares.push({ titulo: item.title || "", link: item.link || "", medio: feed.name, imagen: extraerImagenRSS(item), ts: ts });
      }
    } catch (e) { console.warn("Error " + feed.name + ": " + e.message); }
  }
  titulares.sort(function(a, b) { return b.ts - a.ts; });
  return titulares;
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function tgReq(method, body) {
  try {
    var r = await axios.post(TELEGRAM_API + "/" + method, body, { timeout: 15000 });
    return r.data;
  } catch (e) { console.error("TG " + method + ": " + e.message); return null; }
}
async function tgTexto(texto) {
  await tgReq("sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: texto, parse_mode: "Markdown" });
}

function buildMiniaturaText(noticia) {
  var urgencia = noticia.puntuacion >= 9 ? "🔴" : noticia.puntuacion >= 8 ? "🟠" : "🟡";
  var temaEmoji = { "Conflictos armados": "⚔️", "Diplomacia": "🤝", "Seguridad y defensa": "🛡️", "Economia global": "💰", "Energia y recursos": "⚡", "Derechos humanos": "🕊️" };
  var et = temaEmoji[noticia.categoria_tematica] || "🌍";
  var seg = (noticia.seguimiento && noticia.seguimiento !== "") ? "\n🔔 " + noticia.seguimiento : "";
  return urgencia + " " + et + " *" + noticia.categoria_tematica + "* | " + noticia.region + seg + "\n\n*" + noticia.titular + "*";
}

function buildAnalisisText(noticia) {
  var temaEmoji = { "Conflictos armados": "⚔️", "Diplomacia": "🤝", "Seguridad y defensa": "🛡️", "Economia global": "💰", "Energia y recursos": "⚡", "Derechos humanos": "🕊️" };
  var et = temaEmoji[noticia.categoria_tematica] || "🌍";
  var seg = (noticia.seguimiento && noticia.seguimiento !== "") ? "🔔 *SEGUIMIENTO:* " + noticia.seguimiento + "\n" : "";

  var triang = "";
  if (noticia.triangulacion && noticia.triangulacion.fuentes && noticia.triangulacion.fuentes.length > 0) {
    triang = "\n\n*📡 VERIFICACION:* " + noticia.triangulacion.fuentes.join(", ");
    if (noticia.triangulacion.contradicciones) triang += "\n⚠️ _" + noticia.triangulacion.contradicciones + "_";
    else triang += "\n✅ _Fuentes consistentes_";
  }

  var links = (noticia.fuentes || []).map(function(f) { return "• [" + f.medio + "](" + f.url + ")"; }).join("\n");
  var imgInfo = noticia.imagen ? "\n🖼️ _Imagen: " + (noticia.imagen_fuente || "fuente") + "_" : "\n📷 _Sin imagen_";

  var extra = "";
  if (noticia.extra && noticia.extra.contenido && noticia.extra.contenido !== "") {
    var extraTitulos = { "claves": "🔑 CLAVES", "analisis": "📊 ANALISIS", "actores": "🌐 ACTORES IMPLICADOS", "contexto": "❓ QUE SIGNIFICA" };
    extra = "\n\n*" + (extraTitulos[noticia.extra.tipo] || "📌 NOTA") + ":*\n" + noticia.extra.contenido;
  }

  var fuentesStr = (noticia.fuentes || []).map(function(f) { return f.medio; }).join(" · ");

  var interno = et + " *" + noticia.categoria_tematica + "* | " + noticia.region + "\n" + seg +
    "\n📰 *" + noticia.titular + "*\n\n" +
    "*📊 ANALISIS:*\n" + noticia.analisis + triang + "\n\n" +
    "*🔗 FUENTES:*\n" + links + imgInfo;

  var banderas = (noticia.banderas && noticia.banderas !== "") ? noticia.banderas + " | " : "🌍 | ";
  var externo = banderas + noticia.texto + "\n\n" + fuentesStr;

  return { interno: interno, externo: externo };
}

async function enviarMiniatura(noticia) {
  var nid = "n" + Date.now() + Math.floor(Math.random() * 9999);
  noticiasCache[nid] = noticia;
  var texto = buildMiniaturaText(noticia);
  await tgReq("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID, text: texto,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[
      { text: "👁 Ver análisis", callback_data: "ver_" + nid },
      { text: "🗑 Borrar", callback_data: "del_" + nid }
    ]]}
  });
}

async function expandirNoticia(noticia, chatId, msgId, nid) {
  var textos = buildAnalisisText(noticia);
  var textoCompleto = textos.interno + "\n\n" + textos.externo;
  await tgReq("editMessageText", {
    chat_id: chatId, message_id: msgId,
    text: textoCompleto.slice(0, 4000),
    parse_mode: "Markdown", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[
      { text: "🔽 Cerrar", callback_data: "cerrar_" + nid },
      { text: "🗑 Borrar", callback_data: "del_" + nid }
    ]]}
  });
  if (noticia.imagen) {
    try { await tgReq("sendPhoto", { chat_id: chatId, photo: noticia.imagen, caption: "🖼️ " + noticia.titular, reply_to_message_id: msgId }); }
    catch (e) { console.warn("Imagen no enviable"); }
  }
}

async function cerrarNoticia(noticia, chatId, msgId, nid) {
  await tgReq("editMessageText", {
    chat_id: chatId, message_id: msgId,
    text: buildMiniaturaText(noticia), parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[
      { text: "👁 Ver análisis", callback_data: "ver_" + nid },
      { text: "🗑 Borrar", callback_data: "del_" + nid }
    ]]}
  });
}

// ── Analisis principal ────────────────────────────────────────────────────────
async function analizarYEnviar(titulares) {
  var fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  var seguimientos = await getSeguimientos();
  var historial = await getHistorialEnviadas();

  var resumen = titulares.slice(0, 40).map(function(t) {
    return "- [" + t.medio + "] " + t.titulo + " | " + t.link;
  }).join("\n");

  var historialStr = historial.length > 0
    ? "ACONTECIMENTOS YA CUBIERTOS en las ultimas 48h:\n" +
      historial.map(function(h) {
        return "- [" + (h.actualizacion ? "ACTUALIZACION" : "NOTICIA") + "] " + h.tema;
      }).join("\n") + "\n\n"
    : "";

  console.log("Claude paso 1: seleccion... (historial: " + historial.length + " items)");
  var sel = await callClaude(
    "Eres analista geopolitico senior especializado en MENA. JSON valido unicamente.",
    "Fecha: " + fecha + ". Seguimientos activos: " + seguimientos.join(", ") + "\n\n" +
    historialStr +
    "Titulares disponibles:\n" + resumen + "\n\n" +
    "INSTRUCCIONES DE SELECCION:\n" +
    "1. Selecciona SOLO noticias con consecuencias reales y verificables: accion militar concreta, acuerdo firmado, decision politica de impacto, escalada diplomatica con hechos.\n" +
    "2. EXCLUIR: declaraciones, opiniones, rumores, analisis de opinion, noticias de 'X dijo que Y'.\n" +
    "3. DEDUPLICACION SEMANTICA: si un titular cubre el MISMO ACONTECIMIENTO CONCRETO que ya esta en el historial, NO lo selecciones. Un mismo acontecimiento = mismo actor, mismo lugar, mismo tipo de accion en el mismo dia. EXCEPCION: si hay datos concretos nuevos (nueva cifra, nueva ubicacion, nueva fase), SI es una noticia distinta.\n" +
    "4. TRIANGULACION OBLIGATORIA: cada noticia seleccionada debe tener MINIMO 2 fuentes distintas en la lista de titulares que cubran el mismo hecho. Si solo hay una fuente, NO seleccionar salvo que sea agencia de primer nivel (Reuters, AP, AFP, Bloomberg, EFE).\n" +
    "5. Umbrales: MENA >= 7, Global >= 9. Maximo 3 noticias. Si no hay nada que cumpla, devuelve array vacio.\n\n" +
    "Para cada noticia incluye:\n" +
    "- 'resumen_tematico': descripcion COMPLETA y ESPECIFICA del acontecimiento en 2-3 frases cortas. Debe incluir: actores concretos, accion especifica, lugar exacto, fecha/momento, y cifras o datos clave si los hay. Ejemplo: 'EEUU destruye cinco petroleros iranies (Kaviz, Charminar, Horizon1, Riesco, Derya) en el Golfo de Oman cerca de la isla de Kharg el 9 de septiembre. Iran responde atacando ocho petroleros y dos buques de guerra. El precio del Brent sube a 100.70 dolares'. Este campo es CRITICO para evitar duplicados futuros — debe ser suficientemente especifico para distinguir este acontecimiento de cualquier otro similar.\n" +
    "- 'es_actualizacion': true si este acontecimiento ya esta en el historial pero aporta datos concretos nuevos (nueva cifra, nueva ubicacion, nueva fase). false si es completamente nuevo.\n" +
    "- 'fuentes': UNICAMENTE titulares de esta lista que cubran EXACTAMENTE este hecho\n\n" +
    "Categorias: Conflictos armados, Diplomacia, Seguridad y defensa, Economia global, Energia y recursos, Derechos humanos.\n" +
    "Regiones: MENA, Europa, Asia-Pacifico, America, Africa Subsahariana, Global.\n\n" +
    "{\"seleccion\":[{\"titulo_original\":\"titulo exacto\",\"url\":\"url\",\"puntuacion\":8,\"region\":\"MENA\",\"categoria\":\"Conflictos armados\",\"seguimiento\":\"\",\"resumen_tematico\":\"QUIEN + QUE + DONDE + CUANDO muy especifico\",\"es_actualizacion\":false,\"fuentes\":[{\"medio\":\"nombre\",\"url\":\"url exacta\"}]}]}"
  );

  var seleccionadas = sel.seleccion || [];
  if (seleccionadas.length === 0) { console.log("Sin noticias relevantes"); return; }
  console.log("Seleccionadas: " + seleccionadas.length);

  console.log("Descargando contenido...");
  var articulosConContenido = [];
  for (var i = 0; i < seleccionadas.length; i++) {
    var s = seleccionadas[i];
    var contenido = await descargarContenido(s.url);
    if (!contenido) { console.warn("Sin acceso: " + s.titulo_original); continue; }
    articulosConContenido.push({
      titulo: s.titulo_original, url: s.url, region: s.region,
      categoria: s.categoria, seguimiento: s.seguimiento,
      fuentes: s.fuentes, puntuacion: s.puntuacion,
      resumen_tematico: s.resumen_tematico || "",
      es_actualizacion: s.es_actualizacion || false,
      contenido: contenido,
    });
  }
  if (articulosConContenido.length === 0) { console.log("Todos inaccesibles"); return; }

  var articulosStr = articulosConContenido.map(function(a, idx) {
    return "=== ARTICULO " + (idx + 1) + " ===\nTitulo: " + a.titulo + "\nURL: " + a.url +
      "\nRegion: " + a.region + " | Categoria: " + a.categoria +
      "\nEs actualizacion: " + (a.es_actualizacion ? "SI" : "NO") +
      "\nFuentes disponibles: " + (a.fuentes || []).map(function(f) { return f.medio; }).join(", ") +
      "\nContenido:\n" + a.contenido;
  }).join("\n\n");

  console.log("Claude paso 2: redaccion...");
  console.log("Claude paso 2: redaccion articulo por articulo...");
  var redactadas = [];
  for (var i = 0; i < articulosConContenido.length; i++) {
    var a = articulosConContenido[i];
    var articuloStr = "Titulo: " + a.titulo + "\nURL: " + a.url +
      "\nRegion: " + a.region + " | Categoria: " + a.categoria +
      "\nFuentes: " + (a.fuentes || []).map(function(f) { return f.medio; }).join(", ") +
      "\nContenido:\n" + a.contenido;
    try {
      var red = await callClaude(
        "Eres analista geopolitico senior especializado en MENA. JSON valido unicamente.",
        "Redacta esta noticia para un canal de divulgacion geopolitica.\n\n" +
        "NORMAS: Solo hechos del contenido. Cero conocimiento externo. Fuentes exactamente las proporcionadas. Sin valoraciones.\n" +
        "CAMPO 'texto': 2-3 frases directas sin titular. Neutro, informativo.\n" +
        "CAMPO 'banderas': emojis de paises protagonistas (max 3).\n" +
        "CAMPO 'titular': titular breve en espanol.\n" +
        "Bloque extra: solo si hay >= 2 datos concretos adicionales. Max 3 puntos.\n\n" +
        "Articulo:\n" + articuloStr + "\n\n" +
        "{\"titular\":\"espanol breve\",\"banderas\":\"🇮🇷 🇺🇸\",\"texto\":\"2-3 frases\",\"analisis\":\"implicaciones\",\"triangulacion\":{\"fuentes\":[\"medio1\"],\"contradicciones\":\"\"},\"extra\":{\"tipo\":\"claves\",\"contenido\":\"\"}}"
      );
      red.titulo_original = a.titulo;
      redactadas.push(red);
      console.log("Redactado " + (i+1) + "/" + articulosConContenido.length);
    } catch (e) {
      console.error("Error redactando articulo " + (i+1) + ": " + e.message);
    }
  }

  var redactadas = red.noticias || [];
  if (redactadas.length === 0) return;

  await tgReq("sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: "─────────────────────" });

  for (var i = 0; i < redactadas.length; i++) {
    var n = redactadas[i];
    var s = articulosConContenido.find(function(x) {
      return x.titulo && n.titulo_original && x.titulo.slice(0, 20) === n.titulo_original.slice(0, 20);
    }) || {};
    var orig = titulares.find(function(t) {
      return t.titulo && n.titulo_original && t.titulo.slice(0, 20) === n.titulo_original.slice(0, 20);
    });
    if (n.extra && (!n.extra.contenido || n.extra.contenido === "")) n.extra = null;

    var noticia = {
      titular: n.titular || "",
      texto: n.texto || "",
      banderas: n.banderas || "",
      analisis: n.analisis || "",
      region: s.region || "Global",
      categoria_tematica: s.categoria || "Diplomacia",
      seguimiento: s.seguimiento || "",
      fuentes: s.fuentes || [],
      triangulacion: {
        fuentes: (n.triangulacion && n.triangulacion.fuentes) || [],
        contradicciones: (n.triangulacion && n.triangulacion.contradicciones) || ""
      },
      imagen: orig ? orig.imagen : null,
      imagen_fuente: orig ? orig.medio : null,
      puntuacion: s.puntuacion || 7,
      extra: n.extra || null,
    };

    // Guardar en historial para evitar repeticiones futuras
    // Guardar en historial ANTES de enviar para evitar duplicados aunque falle el envio
    await guardarEnHistorial(noticia.titular, s.resumen_tematico || noticia.titular, s.es_actualizacion || false);
    console.log("Historial actualizado para: " + noticia.titular.slice(0, 50));
    await enviarMiniatura(noticia);
    if (i < redactadas.length - 1) await new Promise(function(r) { setTimeout(r, 1500); });
  }
}

// ── Ciclo ─────────────────────────────────────────────────────────────────────
var intervalHandle = null;
var cicloEnCurso = false;

async function cicloActualizacion() {
  if (cicloEnCurso) { console.log("Ciclo en curso"); return; }
  cicloEnCurso = true;
  console.log("Iniciando ciclo...");
  try {
    var titulares = await recogerNoticias();
    console.log("Titulares: " + titulares.length);
    await analizarYEnviar(titulares);
    await redisSet("ultimo_ciclo", Date.now());
    console.log("Ciclo completado");
  } catch (e) { console.error("Error ciclo: " + e.message); }
  finally { cicloEnCurso = false; }
}

async function arrancarIntervalo() {
  if (intervalHandle) clearInterval(intervalHandle);
  var mins = await getFrecuencia();
  console.log("Intervalo: " + mins + " min");
  intervalHandle = setInterval(cicloActualizacion, mins * 60000);
}

// ── Comandos ──────────────────────────────────────────────────────────────────
async function procesarComando(texto) {
  var p = texto.trim().split(" ");
  var cmd = p[0].toLowerCase();
  if (cmd === "/estado") {
    var freq = await getFrecuencia();
    var segs = await getSeguimientos();
    var ult = await redisGet("ultimo_ciclo", 0);
    var historial = await getHistorialEnviadas();
    var hace = ult ? Math.round((Date.now() - ult) / 60000) + " min" : "nunca";
    await tgTexto("*Estado*\n🟢 ACTIVO\nFrecuencia: " + freq + " min\nUltimo ciclo: " + hace + "\nNoticias en historial (48h): " + historial.length + "\n\n*Seguimientos:*\n" + segs.map(function(s) { return "• " + s; }).join("\n"));
  } else if (cmd === "/apagar") {
    await tgTexto("🔴 Suspendiendo servidor...");
    var ok = await suspenderServidor();
    if (!ok) await tgTexto("Error al suspender.");
  } else if (cmd === "/encender") {
    await tgTexto("🟢 Sistema *encendido*.");
    cicloEnCurso = false;
    await arrancarIntervalo();
    setTimeout(cicloActualizacion, 1000);
  } else if (cmd === "/frecuencia") {
    var mins = parseInt(p[1]);
    if (!mins || mins < 10 || mins > 360) { await tgTexto("Uso: /frecuencia [10-360]"); }
    else { await redisSet("frecuencia_min", mins); await arrancarIntervalo(); await tgTexto("Frecuencia: *" + mins + " min*"); }
  } else if (cmd === "/seguimiento") {
    var accion = p[1] ? p[1].toLowerCase() : "";
    var nombre = p.slice(2).join(" ");
    var segs = await getSeguimientos();
    if (accion === "add" && nombre) {
      if (segs.indexOf(nombre) === -1) { segs.push(nombre); await redisSet("seguimientos", segs); await tgTexto("Añadido: *" + nombre + "*"); }
      else await tgTexto("Ya existe.");
    } else if (accion === "remove" && nombre) {
      var idx = segs.findIndex(function(s) { return s.toLowerCase() === nombre.toLowerCase(); });
      if (idx !== -1) { segs.splice(idx, 1); await redisSet("seguimientos", segs); await tgTexto("Eliminado: *" + nombre + "*"); }
      else await tgTexto("No encontrado.");
    } else if (accion === "list") {
      await tgTexto("*Seguimientos:*\n" + segs.map(function(s) { return "• " + s; }).join("\n"));
    } else { await tgTexto("/seguimiento list\n/seguimiento add [nombre]\n/seguimiento remove [nombre]"); }
  } else if (cmd === "/historial") {
    var historial = await getHistorialEnviadas();
    if (historial.length === 0) { await tgTexto("Historial vacio."); }
    else { await tgTexto("*Noticias enviadas (48h):*\n" + historial.map(function(h, i) { return (i+1) + ". " + h.tema; }).join("\n")); }
  } else if (cmd === "/ahora") {
    await tgTexto("Lanzando analisis...");
    setTimeout(cicloActualizacion, 500);
  } else if (cmd === "/ayuda") {
    await tgTexto("*Comandos:*\n/estado\n/apagar\n/encender\n/frecuencia [min]\n/seguimiento list/add/remove\n/historial\n/ahora\n/ayuda");
  }
}

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post("/webhook", async function(req, res) {
  res.sendStatus(200);
  var body = req.body;
  if (!body) return;
  if (body.callback_query) {
    var cb = body.callback_query;
    await tgReq("answerCallbackQuery", { callback_query_id: cb.id });
    var chatId = cb.message && cb.message.chat && cb.message.chat.id;
    var msgId = cb.message && cb.message.message_id;
    if (String(chatId) !== String(TELEGRAM_CHAT_ID)) return;
    var data = cb.data || "";
    if (data.startsWith("ver_")) {
      var nid = data.replace("ver_", "");
      var noticia = noticiasCache[nid];
      if (noticia) { await expandirNoticia(noticia, chatId, msgId, nid); }
      else { await tgReq("answerCallbackQuery", { callback_query_id: cb.id, text: "Noticia no disponible. Usa /ahora.", show_alert: true }); }
    } else if (data.startsWith("cerrar_")) {
      var nid = data.replace("cerrar_", "");
      var noticia = noticiasCache[nid];
      if (noticia) await cerrarNoticia(noticia, chatId, msgId, nid);
    } else if (data.startsWith("del_")) {
      var nid = data.replace("del_", "");
      delete noticiasCache[nid];
      await tgReq("deleteMessage", { chat_id: chatId, message_id: msgId });
    }
    return;
  }
  var msg = body.message;
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) return;
  if (msg.text.startsWith("/")) procesarComando(msg.text).catch(function(e) { console.error("Cmd: " + e.message); });
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await new Promise(function(r) { setTimeout(r, 2000); });
  await arrancarIntervalo();
  setTimeout(cicloActualizacion, 1000);
}

init();

app.get("/", async function(req, res) {
  res.json({ status: "on", cicloEnCurso: cicloEnCurso });
});

var PORT = process.env.PORT || 3000;
var server = app.listen(PORT, function() {
  console.log("Server running on port " + PORT);
  axios.post(TELEGRAM_API + "/setWebhook", { url: process.env.RENDER_EXTERNAL_URL + "/webhook" })
    .then(function() { console.log("Webhook set"); })
    .catch(function(e) { console.warn("Webhook: " + e.message); });
});
server.on("error", function(err) {
  if (err.code === "EADDRINUSE") setTimeout(function() { server.listen(PORT); }, 5000);
});
