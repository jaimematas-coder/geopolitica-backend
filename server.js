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
var idsEnviadasHoy = {};

const SEGUIMIENTOS_DEFAULT = [
  "Guerra Ucrania-Rusia", "Guerra Israel-Gaza", "Guerra en Sudan",
  "Tension EEUU-Iran", "Crisis Mar Rojo", "Tension China-Taiwan",
];

const RSS_FEEDS = [
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss" },
  { name: "The Independent World", url: "https://www.independent.co.uk/news/world/rss" },
  { name: "Newsweek World", url: "https://www.newsweek.com/rss" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { name: "Washington Post World", url: "https://feeds.washingtonpost.com/rss/world" },
  { name: "The Economist", url: "https://www.economist.com/international/rss.xml" },
  { name: "Financial Times World", url: "https://www.ft.com/world?format=rss" },
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "France 24 ES", url: "https://www.france24.com/es/rss" },
  { name: "Der Spiegel", url: "https://www.spiegel.de/international/index.rss" },
  { name: "Euronews", url: "https://feeds.feedburner.com/euronews/en/news/" },
  { name: "Politico EU", url: "https://www.politico.eu/feed/" },
  { name: "El Pais Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "El Mundo Internacional", url: "https://e00-elmundo.uecdn.es/elmundo/rss/internacional.xml" },
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "Global Times", url: "https://www.globaltimes.cn/rss/outbrain.xml" },
  { name: "The Hindu World", url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "Asia Times", url: "https://asiatimes.com/feed/" },
  { name: "The Straits Times", url: "https://www.straitstimes.com/news/world/rss.xml" },
  { name: "Hurriyet Daily News", url: "https://www.hurriyetdailynews.com/rss" },
  { name: "African Arguments", url: "https://africanarguments.org/feed/" },
  { name: "Folha Internacional", url: "https://feeds.folha.uol.com.br/mundo/rss091.xml" },
  { name: "TASS English", url: "https://tass.com/rss/v2.xml" },
  { name: "Crisis Group", url: "https://www.crisisgroup.org/rss.xml" },
  { name: "Foreign Affairs", url: "https://www.foreignaffairs.com/rss.xml" },
  { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/" },
  { name: "The Diplomat", url: "https://thediplomat.com/feed/" },
  { name: "War on the Rocks", url: "https://warontherocks.com/feed/" },
  { name: "Bellingcat", url: "https://www.bellingcat.com/feed/" },
  { name: "ECFR", url: "https://ecfr.eu/feed/" },
  { name: "CSIS", url: "https://www.csis.org/rss.xml" },
  { name: "Arab Center DC", url: "https://arabcenterdc.org/feed/" },
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

// ── Redis (solo config) ───────────────────────────────────────────────────────
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

// ── Render API ────────────────────────────────────────────────────────────────
async function suspenderServidor() {
  try {
    await axios.post(
      "https://api.render.com/v1/services/" + RENDER_SERVICE_ID + "/suspend",
      {},
      { headers: { "Authorization": "Bearer " + RENDER_API_KEY, "Content-Type": "application/json" } }
    );
    console.log("Servidor suspendido via Render API");
    return true;
  } catch (e) {
    console.error("Error suspendiendo: " + e.message);
    return false;
  }
}

async function reactivarServidor() {
  try {
    await axios.post(
      "https://api.render.com/v1/services/" + RENDER_SERVICE_ID + "/resume",
      {},
      { headers: { "Authorization": "Bearer " + RENDER_API_KEY, "Content-Type": "application/json" } }
    );
    console.log("Servidor reactivado via Render API");
    return true;
  } catch (e) {
    console.error("Error reactivando: " + e.message);
    return false;
  }
}

// ── Deduplicacion en memoria ──────────────────────────────────────────────────
function limpiarViejos() {
  var ahora = Date.now();
  Object.keys(idsEnviadasHoy).forEach(function(k) {
    if (ahora - idsEnviadasHoy[k] > 24 * 3600000) delete idsEnviadasHoy[k];
  });
}
function generarIdNoticia(titular) {
  return titular.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
}
function yaEnviada(titular) { limpiarViejos(); return !!idsEnviadasHoy[generarIdNoticia(titular)]; }
function marcarEnviada(titular) { idsEnviadasHoy[generarIdNoticia(titular)] = Date.now(); }

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

// ── Claude ────────────────────────────────────────────────────────────────────
async function callClaude(system, user) {
  var msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 4000, system: system,
    messages: [{ role: "user", content: user }]
  });
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
  var imgInfo = noticia.imagen ? "\n🖼️ _Imagen: " + (noticia.imagen_fuente || "fuente") + "_" : "\n📷 _Sin imagen para esta noticia_";
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

  var externo = "─────────────────────\n" +
    "🌍 " + noticia.categoria_tematica + " · " + noticia.region + "\n" +
    ((noticia.seguimiento && noticia.seguimiento !== "") ? "🔔 Seguimiento: " + noticia.seguimiento + "\n" : "") +
    "\n" + noticia.titular + "\n\n" + noticia.texto + extra + "\n\n📰 " + fuentesStr +
    "\n─────────────────────";

  return { interno: interno, externo: externo };
}

async function enviarMiniatura(noticia) {
  var nid = "n" + Date.now() + Math.floor(Math.random() * 9999);
  noticiasCache[nid] = noticia;
  var texto = buildMiniaturaText(noticia);
  var teclado = { inline_keyboard: [[
    { text: "👁 Ver análisis", callback_data: "ver_" + nid },
    { text: "🗑 Borrar", callback_data: "del_" + nid }
  ]]};

  if (noticia.imagen) {
    // Enviar como foto con caption — imagen y botones juntos desde el inicio
    try {
      await tgReq("sendPhoto", {
        chat_id: TELEGRAM_CHAT_ID,
        photo: noticia.imagen,
        caption: texto,
        parse_mode: "Markdown",
        reply_markup: teclado,
      });
      return nid;
    } catch (e) {
      console.warn("Foto no enviable, enviando sin imagen");
    }
  }

  // Sin imagen o si la foto falla
  await tgReq("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID,
    text: texto,
    parse_mode: "Markdown",
    reply_markup: teclado,
  });
  return nid;
}

async function expandirNoticia(noticia, chatId, msgId, nid) {
  var textos = buildAnalisisText(noticia);
  var teclado = { inline_keyboard: [[
    { text: "🔽 Cerrar", callback_data: "cerrar_" + nid },
    { text: "🗑 Borrar", callback_data: "del_" + nid }
  ]]};

  if (noticia.imagen) {
    // Editar caption de la foto con el análisis interno
    await tgReq("editMessageCaption", {
      chat_id: chatId, message_id: msgId,
      caption: textos.interno,
      parse_mode: "Markdown",
      reply_markup: teclado,
    });
  } else {
    await tgReq("editMessageText", {
      chat_id: chatId, message_id: msgId,
      text: textos.interno,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: teclado,
    });
  }

  // Externo como respuesta encadenada (copiable por separado)
  await tgReq("sendMessage", {
    chat_id: chatId,
    text: textos.externo,
    parse_mode: "Markdown",
    reply_to_message_id: msgId,
  });
}

async function cerrarNoticia(noticia, chatId, msgId, nid) {
  var texto = buildMiniaturaText(noticia);
  var teclado = { inline_keyboard: [[
    { text: "👁 Ver análisis", callback_data: "ver_" + nid },
    { text: "🗑 Borrar", callback_data: "del_" + nid }
  ]]};
  if (noticia.imagen) {
    await tgReq("editMessageCaption", {
      chat_id: chatId, message_id: msgId,
      caption: texto, parse_mode: "Markdown",
      reply_markup: teclado,
    });
  } else {
    await tgReq("editMessageText", {
      chat_id: chatId, message_id: msgId,
      text: texto, parse_mode: "Markdown",
      reply_markup: teclado,
    });
  }
}

// ── Analisis ──────────────────────────────────────────────────────────────────
async function analizarYEnviar(titulares) {
  var fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  var seguimientos = await getSeguimientos();

  var resumen = titulares.slice(0, 35).map(function(t) {
    return "- [" + t.medio + "] " + t.titulo + (t.imagen ? " [IMG]" : "") + " | " + t.link;
  }).join("\n");

  console.log("Claude paso 1: seleccion...");
  var sel = await callClaude(
    "Eres analista geopolitico senior especializado en MENA. JSON valido unicamente.",
    "Fecha: " + fecha + ". Seguimientos: " + seguimientos.join(", ") + "\n" +
    "Titulares:\n" + resumen + "\n\n" +
    "Selecciona 2-4 noticias importantes. Si no hay nada relevante devuelve array vacio. MENA>=6, Global>=8. Mismo hecho = uno.\n" +
    "Categorias: Conflictos armados, Diplomacia, Seguridad y defensa, Economia global, Energia y recursos, Derechos humanos.\n" +
    "Regiones: MENA, Europa, Asia-Pacifico, America, Africa Subsahariana, Global.\n\n" +
    "{\"seleccion\":[{\"titulo_original\":\"titulo exacto\",\"url\":\"url articulo\",\"puntuacion\":8,\"region\":\"MENA\",\"categoria\":\"Conflictos armados\",\"seguimiento\":\"\",\"fuentes\":[{\"medio\":\"Al Jazeera\",\"url\":\"url\"}]}]}"
  );

  var seleccionadas = (sel.seleccion || []).filter(function(s) { return !yaEnviada(s.titulo_original || ""); });
  if (seleccionadas.length === 0) { console.log("Sin noticias nuevas relevantes"); return; }

  console.log("Claude paso 2: redaccion...");
  var titulosStr = seleccionadas.map(function(s) {
    return "- " + s.titulo_original + " [" + s.region + "] [" + s.categoria + "] URL: " + s.url;
  }).join("\n");

  var red = await callClaude(
    "Eres analista geopolitico senior especializado en MENA. JSON valido unicamente.",
    "Redacta para Instagram. NORMAS: solo hechos objetivos, cero valoraciones morales, datos con fuente entre parentesis.\n" +
    "Bloque extra: SOLO si aporta informacion concreta que NO esta ya en el texto. Maximo 3 puntos. Cada punto: una sola frase corta y directa. Sin relleno, sin contexto historico general, sin repetir lo del texto principal. Si no hay al menos 2 puntos que realmente aporten, deja el contenido vacio.\n" +
    "Tipos: claves (hechos clave del acontecimiento), analisis (consecuencia directa no obvia), actores (posicion concreta de un tercer actor), contexto (solo para noticias muy tecnicas).\n\n" +
    "Noticias:\n" + titulosStr + "\n\n" +
    "{\"noticias\":[{\"titulo_original\":\"exacto\",\"titular\":\"espanol\",\"texto\":\"2-3 frases objetivas\",\"analisis\":\"implicaciones con datos citados\",\"triangulacion\":{\"fuentes\":[\"medio1\"],\"contradicciones\":\"\"},\"extra\":{\"tipo\":\"claves\",\"contenido\":\"\"}}]}"
  );

  var redactadas = red.noticias || [];
  if (redactadas.length === 0) return;

  await tgReq("sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: "─────────────────────" });

  for (var i = 0; i < redactadas.length; i++) {
    var n = redactadas[i];
    var s = seleccionadas.find(function(x) {
      return x.titulo_original && n.titulo_original &&
        x.titulo_original.slice(0, 20) === n.titulo_original.slice(0, 20);
    }) || {};
    var orig = titulares.find(function(t) {
      return t.titulo && n.titulo_original && t.titulo.slice(0, 20) === n.titulo_original.slice(0, 20);
    });
    if (n.extra && (!n.extra.contenido || n.extra.contenido === "")) n.extra = null;

    var noticia = {
      titular: n.titular || "",
      texto: n.texto || "",
      analisis: n.analisis || "",
      region: s.region || "Global",
      categoria_tematica: s.categoria || "Diplomacia",
      seguimiento: s.seguimiento || "",
      fuentes: s.fuentes || [],
      triangulacion: { fuentes: (n.triangulacion && n.triangulacion.fuentes) || [], contradicciones: (n.triangulacion && n.triangulacion.contradicciones) || "" },
      imagen: orig ? orig.imagen : null,
      imagen_fuente: orig ? orig.medio : null,
      puntuacion: s.puntuacion || 7,
      extra: n.extra || null,
    };

    marcarEnviada(n.titulo_original || noticia.titular);
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
    var hace = ult ? Math.round((Date.now() - ult) / 60000) + " min" : "nunca";
    await tgTexto("*Estado del sistema*\n\n🟢 ACTIVO\nFrecuencia: " + freq + " min\nUltimo ciclo: " + hace + "\n\n*Seguimientos:*\n" + segs.map(function(s) { return "• " + s; }).join("\n"));

  } else if (cmd === "/apagar") {
    await tgTexto("🔴 Apagando sistema y suspendiendo servidor...");
    var ok = await suspenderServidor();
    if (!ok) await tgTexto("⚠️ No se pudo suspender via API. El servidor sigue corriendo.");

  } else if (cmd === "/encender") {
    // Este comando lo ejecuta el servidor al reactivarse — Render lo despierta
    // con UptimeRobot o manualmente. Al arrancar hace el ciclo automaticamente.
    await tgTexto("🟢 Sistema *encendido*. Buscando noticias...");
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
      if (segs.indexOf(nombre) === -1) { segs.push(nombre); await redisSet("seguimientos", segs); await tgTexto("✅ Añadido: *" + nombre + "*"); }
      else await tgTexto("Ya existe.");
    } else if (accion === "remove" && nombre) {
      var idx = segs.findIndex(function(s) { return s.toLowerCase() === nombre.toLowerCase(); });
      if (idx !== -1) { segs.splice(idx, 1); await redisSet("seguimientos", segs); await tgTexto("✅ Eliminado: *" + nombre + "*"); }
      else await tgTexto("No encontrado.");
    } else if (accion === "list") {
      await tgTexto("*Seguimientos:*\n" + segs.map(function(s) { return "• " + s; }).join("\n"));
    } else { await tgTexto("/seguimiento list\n/seguimiento add [nombre]\n/seguimiento remove [nombre]"); }

  } else if (cmd === "/ahora") {
    await tgTexto("Lanzando analisis...");
    setTimeout(cicloActualizacion, 500);

  } else if (cmd === "/ayuda") {
    await tgTexto(
      "*Comandos:*\n\n" +
      "/estado — Ver estado\n" +
      "/apagar — Suspender servidor (0 coste)\n" +
      "/encender — Reactivar tras suspension\n" +
      "/frecuencia [min] — Cambiar frecuencia\n" +
      "/seguimiento list/add/remove\n" +
      "/ahora — Analisis inmediato\n" +
      "/ayuda"
    );
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
      if (noticia) {
        await expandirNoticia(noticia, chatId, msgId, nid);
      } else {
        await tgReq("answerCallbackQuery", { callback_query_id: cb.id, text: "Noticia no disponible. Usa /ahora.", show_alert: true });
      }
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
