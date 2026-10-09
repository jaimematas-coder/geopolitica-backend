const express = require("express");
const cors = require("cors");
const RSSParser = require("rss-parser");
const axios = require("axios");
const https = require("https");
const crypto = require("crypto");
const { Redis } = require("@upstash/redis");

const app = express();

// Traza del ultimo ciclo: donde se queda cada noticia por el camino
var ultimoEmbudo = {};

const parser = new RSSParser({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*"
  },
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
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = "srv-d8tfplojs32c73bmg450";

var redis = null;
var redisEstado = "sin probar";
function getRedis() {
  if (!redis) {
    var url = process.env.UPSTASH_REDIS_REST_URL;
    var token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      redisEstado = "FALTAN VARIABLES: " +
        (!url ? "UPSTASH_REDIS_REST_URL " : "") + (!token ? "UPSTASH_REDIS_REST_TOKEN" : "");
      console.error("REDIS MAL CONFIGURADO -> " + redisEstado);
    } else {
      console.log("Redis config OK (url: " + url.slice(0, 38) + "...)");
    }
    redis = new Redis({ url: url, token: token });
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
  // Reuters: feeds.reuters.com ya no existe (ENOTFOUND). Pendiente de sustituto.
  // { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" },
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
  // Arab News: devuelve 404, la ruta del feed ha cambiado. Pendiente de revisar.
  // { name: "Arab News EN", url: "https://www.arabnews.com/node/rss.xml" },
  // The National: devuelve 404, la ruta del feed ha cambiado. Pendiente de revisar.
  // { name: "The National", url: "https://www.thenationalnews.com/rss/world" },
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
async function getFrecuencia() { return redisGet("frecuencia_min", 120); }

// ── Historial de noticias enviadas (para deduplicacion semantica) ─────────────
var VENTANA_HISTORIAL_MS = 72 * 3600000; // 72h
async function getHistorialEnviadas() {
  try {
    var data = await getRedis().get("historial_noticias");
    if (data === null || data === undefined) {
      console.log("Historial: clave inexistente en Redis (aun sin escribir o expirada)");
      return [];
    }
    var parsed = data;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); }
      catch (e) {
        console.error("Historial: valor no parseable. Muestra: " + String(data).slice(0, 120));
        return [];
      }
    }
    if (!Array.isArray(parsed)) {
      console.error("Historial: el valor no es un array, es " + typeof parsed +
        ". Muestra: " + JSON.stringify(parsed).slice(0, 120));
      return [];
    }
    var ahora = Date.now();
    var vivas = parsed.filter(function(h) { return h && h.ts && (ahora - h.ts) < VENTANA_HISTORIAL_MS; });
    if (vivas.length !== parsed.length) {
      console.log("Historial: " + parsed.length + " guardadas, " + vivas.length + " dentro de ventana");
    }
    return vivas;
  } catch (e) {
    console.error("Historial LECTURA FALLIDA: " + e.message);
    return [];
  }
}

async function guardarEnHistorial(titular, resumenTematico, esActualizacion, url) {
  var historial = await getHistorialEnviadas();
  // Si es actualizacion de un acontecimiento ya registrado, incrementar contador
  var previa = null;
  if (esActualizacion) {
    for (var k = historial.length - 1; k >= 0; k--) {
      if (historial[k].tema && resumenTematico &&
          historial[k].tema.slice(0, 40) === resumenTematico.slice(0, 40)) { previa = historial[k]; break; }
    }
  }
  historial.push({
    titular: titular,
    tema: resumenTematico,
    url: url || "",
    actualizacion: !!esActualizacion,
    envios: previa ? (previa.envios || 1) + 1 : 1,
    ts: Date.now()
  });
  try {
    // Se pasa el array tal cual: el SDK de Upstash ya serializa.
    await getRedis().set("historial_noticias", historial, { ex: Math.round(VENTANA_HISTORIAL_MS / 1000) });
    // Verificacion inmediata de que la escritura ha cuajado
    var comprobacion = await getHistorialEnviadas();
    console.log("Historial guardado: " + historial.length + " items enviados, " +
      comprobacion.length + " releidos de Redis");
    if (comprobacion.length === 0) {
      console.error("ALERTA: la escritura en Redis no persiste. Revisa credenciales de Upstash.");
    }
  } catch (e) {
    console.error("Historial ESCRITURA FALLIDA: " + e.message);
  }
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
    var html = String(res.data || "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

    // Si hay <article>, trabajar solo dentro de el
    var mArt = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    var zona = mArt ? mArt[1] : html;

    // Quedarse solo con parrafos reales
    var parrafos = [];
    var re = /<p[^>]*>([\s\S]*?)<\/p>/gi, m;
    while ((m = re.exec(zona)) !== null) {
      var p = m[1].replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/\s+/g, " ").trim();
      if (p.length >= 60) parrafos.push(p);
    }
    var texto = parrafos.join("\n");

    // Deteccion de muro de pago
    var bajo = texto.toLowerCase();
    var marcasPago = ["subscribe to continue", "subscribe to read", "subscribers only",
      "this article is for subscribers", "already a subscriber", "sign in to continue reading",
      "suscríbete para seguir", "contenido exclusivo para suscriptores", "hazte suscriptor",
      "abonnez-vous", "réservé aux abonnés", "article réservé"];
    var pago = marcasPago.some(function(k) { return bajo.indexOf(k) !== -1; });

    if (texto.length < 600 || (pago && texto.length < 2000)) {
      console.warn("Contenido insuficiente o de pago (" + texto.length + " chars): " + url);
      return null;
    }
    return texto.slice(0, 4000);
  } catch (e) {
    console.warn("No se pudo descargar " + url + ": " + e.message);
    return null;
  }
}

// ── Claude ────────────────────────────────────────────────────────────────────
// Precios USD por millon de tokens (docs.claude.com/pricing)
var MODELOS = {
  rapido:  { id: "claude-haiku-4-5-20251001", in: 1, out: 5 },
  bueno:   { id: "claude-sonnet-5-5",         in: 2, out: 10 }
};
var costeCiclo = 0;

async function callClaude(system, user, opts) {
  opts = opts || {};
  var mod = MODELOS[opts.modelo || "bueno"] || MODELOS.bueno;
  var response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: mod.id,
      max_tokens: opts.maxTokens || 2000,
      system: system,
      messages: [{ role: "user", content: user }]
    },
    {
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      }
    }
  );
  var u = response.data.usage || {};
  var coste = ((u.input_tokens || 0) / 1e6) * mod.in + ((u.output_tokens || 0) / 1e6) * mod.out;
  costeCiclo += coste;
  console.log("  [" + (opts.etiqueta || "claude") + "] " + (opts.modelo || "bueno") + " · in " +
    (u.input_tokens || 0) + " / out " + (u.output_tokens || 0) + " · $" + coste.toFixed(4));

  var truncada = response.data.stop_reason === "max_tokens";
  if (truncada) {
    console.warn("  AVISO: respuesta truncada por max_tokens en [" + (opts.etiqueta || "claude") +
      "]. Se intenta recuperar lo completo.");
  }

  var text = (response.data.content || [])
    .filter(function(b) { return b.type === "text"; })
    .map(function(b) { return b.text; })
    .join("");

  var start = text.indexOf("{");
  if (start === -1) throw new Error("Sin JSON en: " + text.slice(0, 120));

  // 1) Intento normal
  var end = text.lastIndexOf("}");
  while (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); }
    catch (e) { end = text.lastIndexOf("}", end - 1); }
  }

  // 2) Rescate de JSON truncado: se cierran llaves y corchetes pendientes
  //    descartando el ultimo objeto incompleto.
  var rescatado = repararJSON(text.slice(start));
  if (rescatado) {
    console.warn("  Recuperado JSON parcial en [" + (opts.etiqueta || "claude") + "]");
    return rescatado;
  }
  throw new Error("No JSON found in: " + text.slice(0, 100));
}

// Recorta un JSON cortado a media escritura hasta el ultimo elemento completo
// y lo cierra, para no perder el ciclo entero por culpa del ultimo objeto.
function repararJSON(txt) {
  for (var corte = txt.length; corte > 0; corte--) {
    if (txt[corte - 1] !== "}") continue;
    var frag = txt.slice(0, corte);
    // Contar delimitadores abiertos fuera de cadenas
    var llaves = 0, corchetes = 0, enCadena = false, escape = false;
    for (var i = 0; i < frag.length; i++) {
      var c = frag[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { enCadena = !enCadena; continue; }
      if (enCadena) continue;
      if (c === "{") llaves++;
      else if (c === "}") llaves--;
      else if (c === "[") corchetes++;
      else if (c === "]") corchetes--;
    }
    if (enCadena || llaves < 0 || corchetes < 0) continue;
    var cierre = "";
    for (var j = 0; j < corchetes; j++) cierre += "]";
    for (var k = 0; k < llaves; k++) cierre += "}";
    // El cierre debe respetar el anidamiento: se prueban ambos ordenes
    var intentos = [frag + cierre, frag + cierre.split("").reverse().join("")];
    for (var n = 0; n < intentos.length; n++) {
      try {
        var obj = JSON.parse(intentos[n]);
        if (obj && typeof obj === "object") return obj;
      } catch (e) {}
    }
  }
  return null;
}

// ── RSS ───────────────────────────────────────────────────────────────────────
// Dos intentos: el parser normal y, si falla, descarga manual con cabeceras de
// navegador y saneado del XML (muchos feeds traen & sueltos que rompen el parseo).
async function leerFeed(url) {
  try {
    return await parser.parseURL(url);
  } catch (e1) {
    var res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache"
      }
    });
    var xml = String(res.data || "").replace(/^\uFEFF/, "").trim();
    if (xml.indexOf("<") > 0) xml = xml.slice(xml.indexOf("<"));
    // & suelto -> &amp; (sin tocar las entidades ya validas)
    xml = xml.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, "&amp;");
    return await parser.parseString(xml);
  }
}


async function recogerNoticias() {
  var ahora = Date.now();
  var limite = ahora - 48 * 3600000;
  var porMedio = {};
  var feedsOk = 0, feedsKo = 0;
  for (var i = 0; i < RSS_FEEDS.length; i++) {
    var feed = RSS_FEEDS[i];
    try {
      var parsed = await leerFeed(feed.url);
      var items = (parsed.items || []).slice(0, 8);
      var delMedio = [];
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var pub = item.pubDate || item.isoDate;
        var ts = pub ? new Date(pub).getTime() : ahora;
        if (ts < limite) continue;
        delMedio.push({ titulo: item.title || "", link: item.link || "", medio: feed.name, imagen: extraerImagenRSS(item), ts: ts });
      }
      if (delMedio.length) { porMedio[feed.name] = delMedio; feedsOk++; }
    } catch (e) { feedsKo++; console.warn("Error " + feed.name + ": " + e.message); }
  }
  console.log("Feeds: " + feedsOk + " ok, " + feedsKo + " con error");

  // Reparto equilibrado: una vuelta por medio antes de repetir ninguno.
  // Evita que un feed muy prolifico cope la lista y deje fuera al resto.
  var medios = Object.keys(porMedio);
  var titulares = [], vuelta = 0, quedan = true;
  while (quedan) {
    quedan = false;
    for (var k = 0; k < medios.length; k++) {
      var lista = porMedio[medios[k]];
      if (lista.length > vuelta) { titulares.push(lista[vuelta]); quedan = true; }
    }
    vuelta++;
  }
  ultimoEmbudo.recogidos = titulares.length;
  ultimoEmbudo.feedsOk = feedsOk;
  ultimoEmbudo.feedsKo = feedsKo;
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

// ── Deduplicacion (paso dedicado) ─────────────────────────────────────────────
function normalizarUrl(u) {
  if (!u) return "";
  return String(u).split("?")[0].split("#")[0].replace(/\/+$/, "").toLowerCase();
}

async function filtrarDuplicados(seleccionadas, historial, maxFinal) {
  if (seleccionadas.length === 0) return [];

  // Capa 1: filtro determinista por URL exacta
  var urlsVistas = {};
  historial.forEach(function(h) {
    var nu = normalizarUrl(h.url);
    if (nu) urlsVistas[nu] = true;
  });
  var candidatos = seleccionadas.filter(function(s) {
    var nu = normalizarUrl(s.url);
    if (nu && urlsVistas[nu]) {
      console.log("Descartada por URL repetida: " + (s.titulo_original || "").slice(0, 60));
      return false;
    }
    return true;
  });
  if (candidatos.length === 0) return [];

  // Si no hay historial, nada que comparar
  if (historial.length === 0) return candidatos.slice(0, maxFinal);

  // Capa 2: comparacion semantica dedicada
  var historialStr = historial.map(function(h, i) {
    return "[H" + (i + 1) + "] (enviada " + (h.envios || 1) + " vez/veces, hace " +
      Math.round((Date.now() - h.ts) / 3600000) + "h)\n" + (h.tema || h.titular);
  }).join("\n\n");

  var candidatosStr = candidatos.map(function(c, i) {
    return "[C" + (i + 1) + "]\nTitular: " + c.titulo_original + "\nResumen: " + (c.resumen_tematico || "");
  }).join("\n\n");

  var veredictos;
  try {
    var res = await callClaude(
      "Eres un verificador de duplicados. Tu UNICA tarea es decidir si cada noticia candidata ya fue cubierta. No selecciones, no puntues, no redactes. JSON valido unicamente.",
      "Compara cada CANDIDATO con los acontecimientos del HISTORIAL.\n\n" +
      "HISTORIAL (ya enviado al canal):\n" + historialStr + "\n\n" +
      "CANDIDATOS:\n" + candidatosStr + "\n\n" +
      "CRITERIO:\n" +
      "- 'duplicada': el candidato describe EL MISMO ACONTECIMIENTO que una entrada del historial. Es el mismo acontecimiento aunque el titular este redactado de otra forma, aunque lo publique otro medio, aunque cambien cifras o detalles menores del mismo hecho, y aunque hayan pasado varios dias. Un ataque, una reunion o un acuerdo concreto ocurren UNA vez: si ya esta en el historial, cualquier nueva cobertura de ese mismo hecho es duplicada.\n" +
      "- 'actualizacion': el acontecimiento esta en el historial PERO ha ocurrido un HECHO NUEVO Y POSTERIOR (una respuesta del otro bando, una fase distinta, una decision tomada despues). No basta con una cifra corregida, un detalle adicional, un testimonio nuevo ni una reaccion declarativa: eso es 'duplicada'.\n" +
      "- 'nueva': no guarda relacion con ninguna entrada del historial.\n\n" +
      "REGLA DURA: si una entrada del historial ya se ha enviado 2 o mas veces, ningun candidato relacionado con ella puede ser 'actualizacion'. Marcalo 'duplicada'.\n" +
      "Aplica el criterio con precision: no marques 'duplicada' solo porque el candidato trate del mismo pais, del mismo conflicto o de los mismos actores que una entrada del historial. Dos ataques distintos, dos reuniones distintas o dos decisiones distintas dentro de la misma guerra son acontecimientos DISTINTOS y cada uno es 'nueva'. Solo es duplicada si es literalmente el mismo suceso.\n\n" +
      "Devuelve un veredicto por cada candidato, en orden:\n" +
      "{\"veredictos\":[{\"candidato\":1,\"veredicto\":\"duplicada\",\"referencia\":\"H2\",\"motivo\":\"breve\"}]}",
      { modelo: "rapido", maxTokens: 1200, etiqueta: "dedup" }
    );
    veredictos = res.veredictos || [];
  } catch (e) {
    console.error("Error en deduplicacion: " + e.message);
    // Ante fallo de API nos quedamos con el filtro de URL, que ya ha descartado
    // las repeticiones exactas. Perder el ciclo entero es peor.
    return candidatos.slice(0, maxFinal);
  }

  var finales = [];
  for (var i = 0; i < candidatos.length; i++) {
    var v = veredictos.find(function(x) { return x.candidato === (i + 1); });
    // Sin veredicto, se mantiene: el paso de seleccion ya la ha validado.
    var veredicto = v ? v.veredicto : "nueva";
    if (veredicto === "duplicada") {
      console.log("Duplicada (" + (v && v.referencia ? v.referencia : "?") + "): " +
        (candidatos[i].titulo_original || "").slice(0, 60) + " | " + (v ? v.motivo : "sin veredicto"));
      continue;
    }
    candidatos[i].es_actualizacion = (veredicto === "actualizacion");
    finales.push(candidatos[i]);
    if (finales.length >= maxFinal) break;
  }
  console.log("Tras deduplicacion: " + finales.length + " de " + candidatos.length);
  return finales;
}

// ── Analisis principal ────────────────────────────────────────────────────────
async function analizarYEnviar(titulares) {
  var fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  var seguimientos = await getSeguimientos();
  var historial = await getHistorialEnviadas();

  var MAX_TITULARES = 60;
  // Los titulares van numerados y SIN URL: Claude responde con indices, no con
  // enlaces. Asi la respuesta es mucho mas corta (no se trunca) y no puede
  // equivocarse al copiar una URL.
  var lista = titulares.slice(0, MAX_TITULARES);
  var resumen = lista.map(function(t, i) {
    return "[" + (i + 1) + "] (" + t.medio + ") " + t.titulo;
  }).join("\n");

  var historialStr = historial.length > 0
    ? "Contexto (ya cubierto en 48h, solo informativo — no es tu criterio de descarte):\n" +
      historial.map(function(h) { return "- " + (h.tema || h.titular); }).join("\n") + "\n\n"
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
    "3. FUENTES RELACIONADAS: en 'f' pon los numeros de TODOS los titulares de la lista que cubran ese mismo hecho, empezando por el principal. Si solo hay uno, pon solo ese: NO descartes la noticia por aparecer en un unico medio. La verificacion real se hace despues leyendo los articulos.\n" +
    "4. Umbrales: MENA >= 6, Global >= 7. Devuelve hasta 10 candidatos, ordenados de mayor a menor interes. Se generoso: un filtro posterior descarta repetidas y las que no se puedan verificar, asi que quedarte corto aqui deja el canal vacio. Solo devuelve array vacio si de verdad no hay ningun acontecimiento reseniable.\n" +
    "5. NO te preocupes por si algo ya se ha publicado antes: otro proceso posterior se encarga de descartar repeticiones. Tu trabajo aqui es solo seleccionar lo relevante.\n\n" +
    "FORMATO DE RESPUESTA. Un objeto por noticia, con claves cortas:\n" +
    "- 'i': numero del titular principal.\n" +
    "- 'f': array con los numeros de los titulares que cubren este mismo hecho (incluido el principal).\n" +
    "- 'p': puntuacion 1-10.\n" +
    "- 'reg': region. Una de: MENA, Europa, Asia-Pacifico, America, Africa Subsahariana, Global.\n" +
    "- 'cat': categoria. Una de: Conflictos armados, Diplomacia, Seguridad y defensa, Economia global, Energia y recursos, Derechos humanos.\n" +
    "- 'seg': nombre del seguimiento activo al que pertenece, o cadena vacia.\n" +
    "- 'res': el acontecimiento en 35 palabras COMO MAXIMO: actores, accion, lugar y cifra clave. Sirve para detectar duplicados mas adelante, asi que debe distinguirse de cualquier suceso parecido. Se telegrafico, no escribas prosa.\n\n" +
    "No incluyas titulos ni URLs en la respuesta: solo numeros. Responde unicamente con el JSON.\n\n" +
    "{\"sel\":[{\"i\":12,\"f\":[12,31],\"p\":8,\"reg\":\"MENA\",\"cat\":\"Conflictos armados\",\"seg\":\"\",\"res\":\"quien hizo que, donde, cifra clave\"}]}",
    { modelo: "bueno", maxTokens: 3000, etiqueta: "seleccion" }
  );

  // Se reconstruyen titulo, URL y medio a partir de los indices devueltos
  var crudas = sel.sel || sel.seleccion || [];
  var seleccionadas = [];
  crudas.forEach(function(c) {
    var principal = lista[(parseInt(c.i, 10) || 0) - 1];
    if (!principal) { console.warn("Indice fuera de rango en seleccion: " + c.i); return; }
    var fuentes = (Array.isArray(c.f) ? c.f : [c.i])
      .map(function(n) { return lista[(parseInt(n, 10) || 0) - 1]; })
      .filter(Boolean)
      .map(function(t) { return { medio: t.medio, url: t.link }; });
    if (!fuentes.length) fuentes = [{ medio: principal.medio, url: principal.link }];
    seleccionadas.push({
      titulo_original: principal.titulo,
      url: principal.link,
      medio: principal.medio,
      puntuacion: c.p || 7,
      region: c.reg || "Global",
      categoria: c.cat || "Diplomacia",
      seguimiento: c.seg || "",
      resumen_tematico: c.res || principal.titulo,
      es_actualizacion: false,
      fuentes: fuentes
    });
  });
  ultimoEmbudo.analizados = Math.min(titulares.length, MAX_TITULARES);
  ultimoEmbudo.candidatos = seleccionadas.length;
  if (seleccionadas.length === 0) { console.log("Sin noticias relevantes"); return 0; }
  console.log("Candidatos seleccionados: " + seleccionadas.length);

  console.log("Paso 1b: deduplicacion contra historial (" + historial.length + " items)...");
  seleccionadas = await filtrarDuplicados(seleccionadas, historial, 5);
  ultimoEmbudo.trasDedup = seleccionadas.length;
  if (seleccionadas.length === 0) { console.log("Todo duplicado, nada que enviar"); return 0; }

  console.log("Descargando contenido...");
  var AGENCIAS = ["reuters", "ap news", "associated press", "afp", "bloomberg", "efe"];
  var articulosConContenido = [];
  for (var i = 0; i < seleccionadas.length; i++) {
    var s = seleccionadas[i];

    // Fuentes candidatas: la principal + las de triangulacion, sin URLs repetidas
    var cand = [{ medio: s.medio || "", url: s.url }].concat(s.fuentes || []);
    var vistas = {}, porLeer = [];
    cand.forEach(function(f) {
      var k = normalizarUrl(f.url);
      if (k && !vistas[k]) { vistas[k] = true; porLeer.push(f); }
    });
    porLeer = porLeer.slice(0, 4);

    // Leer cada una de verdad
    var leidas = [];
    for (var j = 0; j < porLeer.length; j++) {
      var txt = await descargarContenido(porLeer[j].url);
      if (txt) {
        var medio = porLeer[j].medio;
        if (!medio) {
          var enLista = titulares.find(function(t) { return normalizarUrl(t.link) === normalizarUrl(porLeer[j].url); });
          medio = enLista ? enLista.medio : "Fuente";
        }
        // La primera fuente aporta el cuerpo; las demas solo sirven para contrastar
        var limite = leidas.length === 0 ? 2500 : 1200;
        leidas.push({ medio: medio, url: porLeer[j].url, contenido: txt.slice(0, limite) });
      }
    }

    // Con 2+ fuentes legibles se contrasta. Con una sola se publica igualmente
    // si el articulo es sustancial: la garantia contra inventar es que la
    // redaccion solo puede usar lo que esta en el texto leido, no el numero de
    // fuentes. Lo que no se publica nunca es una noticia sin texto que leer.
    if (leidas.length === 0) {
      console.warn("Descartada, ninguna fuente legible: " + s.titulo_original);
      ultimoEmbudo.sinFuentes = (ultimoEmbudo.sinFuentes || 0) + 1;
      continue;
    }
    if (leidas.length === 1 && leidas[0].contenido.length < 1200) {
      console.warn("Descartada, fuente unica y escasa (" + leidas[0].contenido.length + " chars): " + s.titulo_original);
      ultimoEmbudo.sinFuentes = (ultimoEmbudo.sinFuentes || 0) + 1;
      continue;
    }
    console.log("Fuentes leidas (" + leidas.length + "): " + leidas.map(function(l) { return l.medio; }).join(", "));

    articulosConContenido.push({
      titulo: s.titulo_original, url: s.url, region: s.region,
      categoria: s.categoria, seguimiento: s.seguimiento,
      puntuacion: s.puntuacion,
      resumen_tematico: s.resumen_tematico || "",
      es_actualizacion: s.es_actualizacion || false,
      leidas: leidas,
    });
  }
  ultimoEmbudo.conFuentes = articulosConContenido.length;
  if (articulosConContenido.length === 0) { console.log("Ninguna noticia con fuente legible"); return 0; }

  console.log("Claude paso 2: redaccion articulo por articulo (" + articulosConContenido.length + ")...");
  var redactadas = [];
  for (var i = 0; i < articulosConContenido.length; i++) {
    var a = articulosConContenido[i];
    var articuloStr = "Hecho: " + a.titulo + "\nRegion: " + a.region + " | Categoria: " + a.categoria + "\n\n" +
      a.leidas.map(function(l, k) {
        return "=== [F" + (k + 1) + "] " + l.medio + " ===\n" + l.contenido;
      }).join("\n\n");
    try {
      var red = await callClaude(
        "Eres el redactor de un canal de noticias geopoliticas en Telegram. Escribes en espanol. JSON valido unicamente.",
        "Redacta esta noticia a partir de los textos de las fuentes [F1], [F2]...\n\n" +
        "PROCEDENCIA (lo mas importante):\n" +
        "- Cada dato que escribas tiene que estar en alguno de los textos proporcionados. Nada de contexto de fondo, antecedentes ni cifras que conozcas por tu cuenta, aunque sean ciertos. Si no esta en los textos, no existe.\n" +
        "- En 'fuentes_usadas' indica las etiquetas de las fuentes de las que has sacado datos (ej. [\"F1\",\"F3\"]). No incluyas una fuente de la que no hayas usado nada.\n" +
        "- Si las fuentes se contradicen en un dato, no lo uses o indicalo en 'contradicciones'.\n\n" +
        "ESTILO DEL CAMPO 'texto' (REGLA DURA: MAXIMO 60 PALABRAS):\n" +
        "- Ve a lo esencial: que ha pasado y el dato que lo hace relevante. La forma la decide el hecho, no una plantilla.\n" +
        "- Elige UNA sola idea principal. Si el articulo contiene varios sucesos, quedate con el mas importante y descarta los demas: no los encadenes.\n" +
        "- Prohibido: listas de incidentes, enumeraciones de nombres de barcos, empresas o personas secundarias, fechas completas salvo que la fecha sea la noticia, cargos repetidos, frases de cierre que contextualicen o resuman, 'en el contexto de', valoraciones.\n" +
        "- Si una frase no anade informacion nueva, sobra. Sin titular dentro del texto.\n\n" +
        "Referencias de densidad (no las copies, imita solo el nivel de concision):\n" +
        "'Un masivo ataque ucraniano con drones golpeo la region de Moscu durante la ultima jornada de las elecciones legislativas rusas. Las autoridades afirmaron que fueron derribados 1.600 drones, 450 de ellos en las inmediaciones de la capital.'\n" +
        "'China modernizo su base militar en Yibuti para reforzar sus capacidades operativas y de inteligencia en Oriente Medio y Africa. El pequeno pais africano tambien alberga bases de EE. UU., Francia, Japon e Italia, convirtiendose en un enclave militar estrategico de la region.'\n\n" +
        "Antes de responder, cuenta las palabras de 'texto'. Si pasan de 60, reescribelo mas corto.\n\n" +
        "OTROS CAMPOS:\n" +
        "- 'banderas': emojis de los paises protagonistas (max 3).\n" +
        "- 'titular': breve, en espanol.\n" +
        "- 'extra': solo si hay 2 o mas datos concretos adicionales en los textos. Max 3 puntos. Si no, contenido vacio.\n\n" +
        "TEXTOS:\n" + articuloStr + "\n\n" +
        "{\"titular\":\"\",\"banderas\":\"\",\"texto\":\"max 60 palabras\",\"fuentes_usadas\":[\"F1\",\"F2\"],\"analisis\":\"implicaciones, solo con datos de los textos\",\"contradicciones\":\"\",\"extra\":{\"tipo\":\"claves\",\"contenido\":\"\"}}",
        { modelo: "bueno", maxTokens: 1200, etiqueta: "redaccion" }
      );
      red.titulo_original = a.titulo;

      // Fuentes mostradas = las realmente leidas Y usadas
      var usadas = (red.fuentes_usadas || []).map(function(tag) {
        var idx = parseInt(String(tag).replace(/\D/g, ""), 10) - 1;
        return a.leidas[idx];
      }).filter(Boolean);
      if (usadas.length === 0) usadas = a.leidas;
      red._fuentes = usadas.map(function(l) { return { medio: l.medio, url: l.url }; });

      var palabras = (red.texto || "").split(/\s+/).filter(Boolean).length;
      if (palabras > 70) console.warn("TEXTO LARGO (" + palabras + " palabras): " + (red.titular || "").slice(0, 50));
      redactadas.push(red);
      console.log("Redactado " + (i+1) + "/" + articulosConContenido.length);
    } catch (e) {
      console.error("Error redactando articulo " + (i+1) + ": " + e.message);
    }
  }

  ultimoEmbudo.redactadas = redactadas.length;
  if (redactadas.length === 0) { console.log("Ninguna noticia redactada"); return 0; }

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
      fuentes: n._fuentes || [],
      triangulacion: {
        fuentes: (n._fuentes || []).map(function(f) { return f.medio; }),
        contradicciones: n.contradicciones || ""
      },
      imagen: orig ? orig.imagen : null,
      imagen_fuente: orig ? orig.medio : null,
      puntuacion: s.puntuacion || 7,
      extra: n.extra || null,
    };

    // Guardar en historial para evitar repeticiones futuras
    // Guardar en historial ANTES de enviar para evitar duplicados aunque falle el envio
    await guardarEnHistorial(
      noticia.titular,
      s.resumen_tematico || noticia.titular,
      s.es_actualizacion || false,
      s.url || ""
    );
    console.log("Historial actualizado para: " + noticia.titular.slice(0, 50));
    await enviarMiniatura(noticia);
    if (i < redactadas.length - 1) await new Promise(function(r) { setTimeout(r, 1500); });
  }
  return redactadas.length;
}

// ── Ciclo ─────────────────────────────────────────────────────────────────────
var intervalHandle = null;
var cicloEnCurso = false;
var cicloInicio = 0;
var HORA_INICIO = 7;   // primer ciclo del dia (hora de Madrid)
var HORA_FIN = 24;     // ultimo ciclo: se para a partir de esta hora
var MAX_CICLO_MS = 20 * 60000; // un ciclo nunca deberia durar mas de 20 min

async function cicloActualizacion() {
  if (cicloEnCurso) {
    if (Date.now() - cicloInicio > MAX_CICLO_MS) {
      console.warn("Ciclo anterior colgado (" + Math.round((Date.now() - cicloInicio) / 60000) +
        " min). Se desbloquea y se lanza uno nuevo.");
      cicloEnCurso = false;
    } else {
      console.log("Ciclo en curso, se omite este disparo");
      return;
    }
  }
  // Ventana horaria: de madrugada no hay consumo y las noticias siguen ahi por la manana
  var horaMadrid = parseInt(new Date().toLocaleString("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", hour12: false
  }), 10);
  if (horaMadrid >= HORA_FIN || horaMadrid < HORA_INICIO) {
    console.log("Fuera de ventana horaria (" + horaMadrid + "h). Ciclo omitido.");
    return;
  }

  cicloEnCurso = true;
  cicloInicio = Date.now();
  costeCiclo = 0;
  console.log("Iniciando ciclo...");
  try {
    var titulares = await recogerNoticias();
    console.log("Titulares: " + titulares.length);

    // Si los titulares son exactamente los del ciclo anterior, no hay nada nuevo
    // que analizar: se evita el gasto entero de API.
    var huella = crypto.createHash("md5")
      .update(titulares.map(function(t) { return t.link; }).sort().join("|"))
      .digest("hex");
    var huellaPrevia = await redisGet("huella_titulares", "");
    if (huella === huellaPrevia) {
      console.log("Sin titulares nuevos desde el ciclo anterior. Se omite el analisis (coste $0).");
      await redisSet("ultimo_ciclo", Date.now());
      return;
    }

    ultimoEmbudo = { recogidos: ultimoEmbudo.recogidos, feedsOk: ultimoEmbudo.feedsOk,
                     feedsKo: ultimoEmbudo.feedsKo, ts: Date.now() };
    var enviadas = await analizarYEnviar(titulares);
    ultimoEmbudo.enviadas = enviadas || 0;
    await redisSet("embudo", ultimoEmbudo);
    await redisSet("huella_titulares", huella);
    await redisSet("ultimo_ciclo", Date.now());
    if (enviadas > 0) await redisSet("ultimo_envio", Date.now());

    // Contador de coste: se reinicia al cambiar de dia
    var hoyStr = new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
    var diaGuardado = await redisGet("coste_dia_fecha", "");
    var previo = diaGuardado === hoyStr ? Number(await redisGet("coste_dia", 0)) : 0;
    var acumulado = previo + costeCiclo;
    await redisSet("coste_dia", acumulado);
    await redisSet("coste_dia_fecha", hoyStr);
    var e = ultimoEmbudo;
    console.log("EMBUDO: " + (e.recogidos || 0) + " recogidos -> " + (e.analizados || 0) +
      " analizados -> " + (e.candidatos || 0) + " candidatos -> " + (e.trasDedup || 0) +
      " tras dedup -> " + (e.conFuentes || 0) + " con fuente -> " + (e.redactadas || 0) +
      " redactadas -> " + (e.enviadas || 0) + " enviadas" +
      (e.sinFuentes ? " (" + e.sinFuentes + " caidas por falta de fuente legible)" : ""));
    console.log("Ciclo completado (" + (enviadas || 0) + " enviadas) · coste $" +
      costeCiclo.toFixed(4) + " · acumulado $" + acumulado.toFixed(3));
  } catch (e) {
    console.error("Error ciclo: " + e.message);
    ultimoEmbudo.error = e.message.slice(0, 120);
    ultimoEmbudo.ts = ultimoEmbudo.ts || Date.now();
    try { await redisSet("embudo", ultimoEmbudo); } catch (e2) {}
  }
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
    var ultEnv = await redisGet("ultimo_envio", 0);
    var historial = await getHistorialEnviadas();
    function hace(t) {
      if (!t) return "nunca";
      var m = Math.round((Date.now() - t) / 60000);
      return m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "min";
    }
    await tgTexto("*Estado*\n🟢 ACTIVO\nFrecuencia: " + freq + " min\nUltimo ciclo: " + hace(ult) +
      "\nUltimo envio: " + hace(ultEnv) +
      (cicloEnCurso ? "\n⏳ Ciclo ejecutandose ahora" : "") +
      "\nNoticias en historial (72h): " + historial.length +
      "\n\n*Seguimientos:*\n" + segs.map(function(s) { return "• " + s; }).join("\n"));
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
    else { await tgTexto("*Noticias enviadas (72h):*\n" + historial.map(function(h, i) { return (i+1) + ". " + h.tema; }).join("\n")); }
  } else if (cmd === "/embudo") {
    var e = await redisGet("embudo", null);
    if (!e) { await tgTexto("Aun no hay datos del embudo. Lanza /ahora y vuelve a probar."); }
    else {
      var mins = e.ts ? Math.round((Date.now() - e.ts) / 60000) : "?";
      await tgTexto("*Ultimo ciclo* (hace " + mins + " min)\n" +
        "Feeds: " + (e.feedsOk || 0) + " ok / " + (e.feedsKo || 0) + " con error\n" +
        "Titulares recogidos: " + (e.recogidos || 0) + "\n" +
        "Analizados por Claude: " + (e.analizados || 0) + "\n" +
        "Candidatos: " + (e.candidatos || 0) + "\n" +
        "Tras deduplicacion: " + (e.trasDedup || 0) + "\n" +
        "Con fuente legible: " + (e.conFuentes || 0) +
        (e.sinFuentes ? " (" + e.sinFuentes + " caidas)" : "") + "\n" +
        "Redactadas: " + (e.redactadas || 0) + "\n" +
        "*Enviadas: " + (e.enviadas || 0) + "*" +
        (e.error ? "\n\n⚠️ El ciclo fallo: " + e.error : ""));
    }
  } else if (cmd === "/coste") {
    var hoy = await redisGet("coste_dia", 0);
    var dia = await redisGet("coste_dia_fecha", "");
    await tgTexto("*Coste API*\nAcumulado (" + (dia || "hoy") + "): *$" + Number(hoy).toFixed(3) + "*\n" +
      "Proyeccion mensual: ~$" + (Number(hoy) * 30).toFixed(1) + "\n\n" +
      "_El detalle por llamada esta en los logs de Render._");
  } else if (cmd === "/diag") {
    var lineas = [];
    var rawUrl = process.env.UPSTASH_REDIS_REST_URL || "";
    var rawTok = process.env.UPSTASH_REDIS_REST_TOKEN || "";
    lineas.push("URL definida: " + (rawUrl ? "SI" : "NO"));
    lineas.push("TOKEN definido: " + (rawTok ? "SI (" + rawTok.length + " chars)" : "NO"));
    lineas.push("Protocolo: " + (rawUrl.split("://")[0] || "ninguno"));
    lineas.push("Host: " + rawUrl.replace(/^[a-z]+:\/\//i, "").split("/")[0]);
    if (/\s/.test(rawUrl) || /\s/.test(rawTok)) lineas.push("OJO: hay espacios en URL o TOKEN");
    if (rawUrl.indexOf("https://") !== 0) lineas.push("OJO: la URL no empieza por https://");

    function detalle(e) {
      var c = e && e.cause;
      if (!c) return e.message;
      return e.message + " | causa: " + (c.code || c.message || String(c));
    }

    // Prueba directa contra el endpoint REST, sin pasar por el SDK
    try {
      var r = await axios.get(rawUrl.replace(/\/+$/, "") + "/get/diag_probe", {
        headers: { Authorization: "Bearer " + rawTok }, timeout: 8000
      });
      lineas.push("HTTP directo: " + r.status + " OK");
    } catch (e) {
      lineas.push("HTTP directo: " + (e.response ? "status " + e.response.status : detalle(e)));
    }

    try {
      var marca = "test_" + Date.now();
      await getRedis().set("diag_test", { marca: marca, ts: Date.now() }, { ex: 120 });
      var leido = await getRedis().get("diag_test");
      if (typeof leido === "string") { try { leido = JSON.parse(leido); } catch (e2) {} }
      lineas.push("SDK escritura/lectura: " + (leido && leido.marca === marca ? "OK" : "FALLA"));
    } catch (e) {
      lineas.push("SDK ERROR: " + detalle(e));
    }

    try {
      var bruto = await getRedis().get("historial_noticias");
      lineas.push("historial_noticias: " + (bruto === null || bruto === undefined
        ? "no existe"
        : typeof bruto + ", " + (Array.isArray(bruto) ? bruto.length + " items" : String(bruto).length + " chars")));
    } catch (e) {
      lineas.push("historial ERROR: " + detalle(e));
    }
    await tgTexto("*Diagnostico Redis*\n" + lineas.join("\n"));
  } else if (cmd === "/ahora") {
    await tgTexto("Lanzando analisis...");
    setTimeout(cicloActualizacion, 500);
  } else if (cmd === "/ayuda") {
    await tgTexto("*Comandos:*\n/estado\n/apagar\n/encender\n/frecuencia [min]\n/seguimiento list/add/remove\n/historial\n/embudo\n/coste\n/diag\n/ahora\n/ayuda");
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
