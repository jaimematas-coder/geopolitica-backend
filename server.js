const express = require("express");
const cors = require("cors");
const RSSParser = require("rss-parser");
const axios = require("axios");
const https = require("https");
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

    // Quedarse solo con parrafos reales (<p> con texto sustancial)
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

    if (texto.length < 800 || (pago && texto.length < 2500)) {
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
async function callClaude(system, user) {
  var response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
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
  var text = (response.data.content || [])
    .filter(function(b) { return b.type === "text"; })
    .map(function(b) { return b.text; })
    .join("");
  var start = text.indexOf("{");
  var end = text.lastIndexOf("}");
  while (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); }
    catch (e) { end = text.lastIndexOf("}", end - 1); }
  }
  throw new Error("No JSON found in: " + text.slice(0, 100));
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
      "ANTE LA DUDA, marca 'duplicada'. Repetir una noticia es peor que perder una.\n\n" +
      "Devuelve un veredicto por cada candidato, en orden:\n" +
      "{\"veredictos\":[{\"candidato\":1,\"veredicto\":\"duplicada\",\"referencia\":\"H2\",\"motivo\":\"breve\"}]}"
    );
    veredictos = res.veredictos || [];
  } catch (e) {
    console.error("Error en deduplicacion: " + e.message);
    return []; // ante fallo, no enviar nada antes que arriesgar duplicados
  }

  var finales = [];
  for (var i = 0; i < candidatos.length; i++) {
    var v = veredictos.find(function(x) { return x.candidato === (i + 1); });
    var veredicto = v ? v.veredicto : "duplicada"; // sin veredicto = descartar
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

  var resumen = titulares.slice(0, 40).map(function(t) {
    return "- [" + t.medio + "] " + t.titulo + " | " + t.link;
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
    "3. TRIANGULACION OBLIGATORIA: cada noticia seleccionada debe tener MINIMO 2 fuentes distintas en la lista de titulares que cubran el mismo hecho. Si solo hay una fuente, NO seleccionar salvo que sea agencia de primer nivel (Reuters, AP, AFP, Bloomberg, EFE).\n" +
    "4. Umbrales: MENA >= 7, Global >= 9. Maximo 8 candidatos, ordenados de mayor a menor interes. Si no hay nada que cumpla, devuelve array vacio.\n" +
    "5. NO te preocupes por si algo ya se ha publicado antes: otro proceso posterior se encarga de descartar repeticiones. Tu trabajo aqui es solo seleccionar lo relevante.\n\n" +
    "Para cada noticia incluye:\n" +
    "- 'resumen_tematico': descripcion COMPLETA y ESPECIFICA del acontecimiento en 2-3 frases cortas. Debe incluir: actores concretos, accion especifica, lugar exacto, fecha/momento, y cifras o datos clave si los hay. Ejemplo: 'EEUU destruye cinco petroleros iranies (Kaviz, Charminar, Horizon1, Riesco, Derya) en el Golfo de Oman cerca de la isla de Kharg el 9 de septiembre. Iran responde atacando ocho petroleros y dos buques de guerra. El precio del Brent sube a 100.70 dolares'. Este campo es CRITICO para evitar duplicados futuros — debe ser suficientemente especifico para distinguir este acontecimiento de cualquier otro similar.\n" +
    "- 'es_actualizacion': dejalo siempre en false. Lo decide el proceso posterior.\n" +
    "- 'fuentes': UNICAMENTE titulares de esta lista que cubran EXACTAMENTE este hecho\n\n" +
    "Categorias: Conflictos armados, Diplomacia, Seguridad y defensa, Economia global, Energia y recursos, Derechos humanos.\n" +
    "Regiones: MENA, Europa, Asia-Pacifico, America, Africa Subsahariana, Global.\n\n" +
    "{\"seleccion\":[{\"titulo_original\":\"titulo exacto\",\"url\":\"url\",\"puntuacion\":8,\"region\":\"MENA\",\"categoria\":\"Conflictos armados\",\"seguimiento\":\"\",\"resumen_tematico\":\"QUIEN + QUE + DONDE + CUANDO muy especifico\",\"es_actualizacion\":false,\"fuentes\":[{\"medio\":\"nombre\",\"url\":\"url exacta\"}]}]}"
  );

  var seleccionadas = sel.seleccion || [];
  if (seleccionadas.length === 0) { console.log("Sin noticias relevantes"); return; }
  console.log("Candidatos seleccionados: " + seleccionadas.length);

  console.log("Paso 1b: deduplicacion contra historial (" + historial.length + " items)...");
  seleccionadas = await filtrarDuplicados(seleccionadas, historial, 3);
  if (seleccionadas.length === 0) { console.log("Todo duplicado, nada que enviar"); return; }

  console.log("Descargando contenido...");
  var AGENCIAS = ["reuters", "ap news", "associated press", "afp", "bloomberg", "efe"];
  var articulosConContenido = [];
  for (var i = 0; i < seleccionadas.length; i++) {
    var s = seleccionadas[i];

    // Todas las fuentes candidatas: la principal + las de triangulacion, sin repetir URL
    var candidatas = [{ medio: s.medio || "", url: s.url }].concat(s.fuentes || []);
    var vistas = {}, porLeer = [];
    candidatas.forEach(function(f) {
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
        leidas.push({ medio: medio, url: porLeer[j].url, contenido: txt });
      }
    }

    var esAgencia = leidas.length === 1 && AGENCIAS.some(function(a) {
      return leidas[0].medio.toLowerCase().indexOf(a) !== -1;
    });
    if (leidas.length < 2 && !esAgencia) {
      console.warn("Descartada, solo " + leidas.length + " fuente(s) legible(s): " + s.titulo_original);
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
  if (articulosConContenido.length === 0) { console.log("Todos inaccesibles"); return; }

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
        "ESTILO DEL CAMPO 'texto':\n" +
        "- Ve a lo esencial: que ha pasado y el dato que lo hace relevante. La forma y la extension las decide el propio hecho, no una plantilla.\n" +
        "- Nada de relleno: sin fechas completas salvo que la fecha sea la noticia, sin cargos repetidos, sin frases de cierre que resuman o contextualicen, sin 'en el contexto de', sin valoraciones.\n" +
        "- Si una frase no anade informacion nueva, sobra. Normalmente cabe en dos o tres frases cortas; nunca mas de 60 palabras.\n" +
        "- Sin titular dentro del texto.\n\n" +
        "Referencias de tono y densidad (no las copies, solo el nivel de concision):\n" +
        "'Un masivo ataque ucraniano con drones golpeo la region de Moscu durante la ultima jornada de las elecciones legislativas rusas. Las autoridades afirmaron que fueron derribados 1.600 drones, 450 de ellos en las inmediaciones de la capital.'\n" +
        "'China modernizo su base militar en Yibuti para reforzar sus capacidades operativas y de inteligencia en Oriente Medio y Africa. El pequeno pais africano tambien alberga bases de EE. UU., Francia, Japon e Italia, convirtiendose en un enclave militar estrategico de la region.'\n\n" +
        "OTROS CAMPOS:\n" +
        "- 'banderas': emojis de los paises protagonistas (max 3).\n" +
        "- 'titular': breve, en espanol.\n" +
        "- 'extra': solo si hay 2 o mas datos concretos adicionales en los textos. Max 3 puntos. Si no, contenido vacio.\n\n" +
        "TEXTOS:\n" + articuloStr + "\n\n" +
        "{\"titular\":\"\",\"banderas\":\"\",\"texto\":\"\",\"fuentes_usadas\":[\"F1\",\"F2\"],\"analisis\":\"implicaciones, solo con datos de los textos\",\"contradicciones\":\"\",\"extra\":{\"tipo\":\"claves\",\"contenido\":\"\"}}"
      );
      red.titulo_original = a.titulo;

      // Fuentes que se muestran = las realmente leidas Y usadas
      var usadas = (red.fuentes_usadas || []).map(function(tag) {
        var idx = parseInt(String(tag).replace(/\D/g, ""), 10) - 1;
        return a.leidas[idx];
      }).filter(Boolean);
      if (usadas.length === 0) usadas = a.leidas; // si no lo indica, todas las leidas
      red._fuentes = usadas.map(function(l) { return { medio: l.medio, url: l.url }; });

      var palabras = (red.texto || "").split(/\s+/).filter(Boolean).length;
      if (palabras > 70) console.warn("Texto largo (" + palabras + " palabras): " + (red.titular || ""));
      redactadas.push(red);
      console.log("Redactado " + (i+1) + "/" + articulosConContenido.length);
    } catch (e) {
      console.error("Error redactando articulo " + (i+1) + ": " + e.message);
    }
  }

  if (redactadas.length === 0) { console.log("Ninguna noticia redactada"); return; }

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
    else { await tgTexto("*Noticias enviadas (72h):*\n" + historial.map(function(h, i) { return (i+1) + ". " + h.tema; }).join("\n")); }
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
    await tgTexto("*Comandos:*\n/estado\n/apagar\n/encender\n/frecuencia [min]\n/seguimiento list/add/remove\n/historial\n/diag\n/ahora\n/ayuda");
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
