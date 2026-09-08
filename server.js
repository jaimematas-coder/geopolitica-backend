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
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = "https://api.telegram.org/bot" + TELEGRAM_TOKEN;

const SEGUIMIENTOS_DEFAULT = [
  "Guerra Ucrania-Rusia",
  "Guerra Israel-Gaza",
  "Guerra en Sudan",
  "Tension EEUU-Iran",
  "Crisis Mar Rojo",
  "Guerra Civil Myanmar",
  "Tension China-Taiwan",
];

const RSS_FEEDS = [
  // Generalistas anglosajones
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss" },
  { name: "The Independent World", url: "https://www.independent.co.uk/news/world/rss" },
  { name: "Newsweek World", url: "https://www.newsweek.com/rss" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { name: "Washington Post World", url: "https://feeds.washingtonpost.com/rss/world" },
  { name: "The Economist", url: "https://www.economist.com/international/rss.xml" },
  { name: "Financial Times World", url: "https://www.ft.com/world?format=rss" },
  // Generalistas europeos
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "France 24 ES", url: "https://www.france24.com/es/rss" },
  { name: "Der Spiegel", url: "https://www.spiegel.de/international/index.rss" },
  { name: "Euronews", url: "https://feeds.feedburner.com/euronews/en/news/" },
  { name: "Politico EU", url: "https://www.politico.eu/feed/" },
  // Generalistas hispanohablantes
  { name: "El Pais Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "El Mundo Internacional", url: "https://e00-elmundo.uecdn.es/elmundo/rss/internacional.xml" },
  { name: "EFE Mundial", url: "https://www.efe.com/efe/espana/portada/rss/16" },
  // Eje asiatico
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "Global Times", url: "https://www.globaltimes.cn/rss/outbrain.xml" },
  { name: "The Hindu World", url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "Asia Times", url: "https://asiatimes.com/feed/" },
  { name: "The Straits Times", url: "https://www.straitstimes.com/news/world/rss.xml" },
  { name: "Hurriyet Daily News", url: "https://www.hurriyetdailynews.com/rss" },
  // Africa y America Latina
  { name: "African Arguments", url: "https://africanarguments.org/feed/" },
  { name: "Folha Internacional", url: "https://feeds.folha.uol.com.br/mundo/rss091.xml" },
  // Para triangulacion (perspectiva rusa/china)
  { name: "TASS English", url: "https://tass.com/rss/v2.xml" },
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
  // MENA especializados (URLs actualizadas)
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "Al Monitor", url: "https://www.al-monitor.com/rss" },
  { name: "Jerusalem Post", url: "https://www.jpost.com/rss/rssfeedsheadlines.aspx" },
  { name: "Middle East Monitor", url: "https://www.middleeastmonitor.com/feed/" },
  { name: "Daily Sabah", url: "https://www.dailysabah.com/rssFeed/push_notifications" },
  { name: "Egypt Independent", url: "https://egyptindependent.com/feed/" },
  { name: "Iran International EN", url: "https://www.iranintl.com/en/rss.xml" },
  { name: "Arab News EN", url: "https://www.arabnews.com/node/rss.xml" },
  { name: "The National", url: "https://www.thenationalnews.com/rss/world" },
  { name: "Rudaw EN", url: "https://www.rudaw.net/english/rss" },
];

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function getConfig(key, defaultVal) {
  try {
    var data = await redis.get(key);
    if (data === null || data === undefined) return defaultVal;
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) { return defaultVal; }
}
async function setConfig(key, value) {
  try { await redis.set(key, JSON.stringify(value)); }
  catch (e) { console.error("Error setting " + key + ": " + e.message); }
}
async function getSeguimientos() { return getConfig("seguimientos", SEGUIMIENTOS_DEFAULT); }
async function getFrecuencia() { return getConfig("frecuencia_min", 30); }
async function getApagado() { return getConfig("apagado", false); }
async function getEnviadas() { return getConfig("enviadas", []); }
async function saveEnviadas(e) { await setConfig("enviadas", e); }

// Cache de noticias persistido en Redis
async function guardarNoticiaCache(nid, noticia) {
  try {
    await redis.set("noticia_" + nid, JSON.stringify(noticia));
    await redis.expire("noticia_" + nid, 86400); // 24h
  } catch (e) { console.warn("Cache save error: " + e.message); }
}

async function obtenerNoticiaCache(nid) {
  try {
    var data = await redis.get("noticia_" + nid);
    if (!data) return null;
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) { return null; }
}

async function borrarNoticiaCache(nid) {
  try { await redis.del("noticia_" + nid); } catch (e) {}
}

function generarId(titular) {
  // ID corto para que quepa en callback_data de Telegram (max 64 chars, prefijo "ver_" = 4)
  var base = titular.toLowerCase()
    .replace(/[aáàä]/g, "a").replace(/[eéèë]/g, "e")
    .replace(/[iíìï]/g, "i").replace(/[oóòö]/g, "o").replace(/[uúùü]/g, "u")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 55); // max 55 para dejar espacio al prefijo
  return base;
}

function filtrar24h(items) {
  var ahora = Date.now();
  return items.filter(function(n) { return (ahora - n.timestamp) < 24 * 60 * 60 * 1000; });
}

function extraerImagenRSS(item) {
  var candidatas = [];
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
    candidatas.push({ url: item.mediaContent.$.url, w: parseInt(item.mediaContent.$.width || "0"), h: parseInt(item.mediaContent.$.height || "0") });
  }
  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
    candidatas.push({ url: item.mediaThumbnail.$.url, w: parseInt(item.mediaThumbnail.$.width || "0"), h: parseInt(item.mediaThumbnail.$.height || "0") });
  }
  if (item.enclosure && item.enclosure.type && item.enclosure.type.startsWith("image") && item.enclosure.url) {
    candidatas.push({ url: item.enclosure.url, w: 0, h: 0 });
  }
  if (item.content) {
    var match = item.content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) candidatas.push({ url: match[1], w: 0, h: 0 });
  }
  for (var i = 0; i < candidatas.length; i++) {
    var c = candidatas[i];
    var u = c.url.toLowerCase();
    // Descartar logos, avatares, iconos, thumbnails de autor, imagenes muy pequenas
    if (u.includes("logo") || u.includes("avatar") || u.includes("profile") ||
        u.includes("icon") || u.includes("author") || u.includes("badge") ||
        u.includes("sprite") || u.includes("pixel") || u.includes("1x1") ||
        u.includes("placeholder") || u.includes("blank")) continue;
    // Descartar si las dimensiones conocidas son demasiado pequenas
    if (c.w > 0 && c.w < 300) continue;
    if (c.h > 0 && c.h < 200) continue;
    return c.url;
  }
  return null;
}

// ── Claude ────────────────────────────────────────────────────────────────────
async function callClaude(system, user) {
  var message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: system,
    messages: [{ role: "user", content: user }]
  });
  var text = (message.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
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
  var limite48h = ahora - (48 * 60 * 60 * 1000);
  var titulares = [];
  for (var i = 0; i < RSS_FEEDS.length; i++) {
    var feed = RSS_FEEDS[i];
    try {
      var parsed = await parser.parseURL(feed.url);
      var items = (parsed.items || []).slice(0, 5);
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var pubDate = item.pubDate || item.isoDate;
        var pubTs = pubDate ? new Date(pubDate).getTime() : ahora;
        if (pubTs < limite48h) continue;
        titulares.push({
          titulo: item.title || "",
          resumen: item.contentSnippet || "",
          link: item.link || "",
          medio: feed.name,
          imagen: extraerImagenRSS(item),
          pubTs: pubTs,
        });
      }
    } catch (e) { console.warn("Error reading " + feed.name + ": " + e.message); }
  }
  titulares.sort(function(a, b) { return b.pubTs - a.pubTs; });
  return titulares;
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function telegramRequest(method, body) {
  try {
    var res = await axios.post(TELEGRAM_API + "/" + method, body, { timeout: 15000 });
    return res.data;
  } catch (e) {
    console.error("Telegram " + method + " error: " + e.message);
    return null;
  }
}

async function enviarTextoTelegram(texto) {
  await telegramRequest("sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: texto, parse_mode: "Markdown" });
}

async function enviarSeparador() {
  await telegramRequest("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID,
    text: "─────────────────────",
  });
}

async function enviarNoticiaMiniatura(noticia) {
  var urgencia = noticia.puntuacion >= 9 ? "🔴" : noticia.puntuacion >= 8 ? "🟠" : "🟡";
  var temaEmoji = { "Conflictos armados": "⚔️", "Diplomacia": "🤝", "Seguridad y defensa": "🛡️", "Economia global": "💰", "Energia y recursos": "⚡", "Derechos humanos": "🕊️" };
  var emojiTema = temaEmoji[noticia.categoria_tematica] || "🌍";
  var seguimientoLinea = (noticia.seguimiento && noticia.seguimiento !== "") ? "\n🔔 " + noticia.seguimiento : "";

  var texto = urgencia + " " + emojiTema + " *" + noticia.categoria_tematica + "* | " + noticia.region +
    seguimientoLinea + "\n\n" +
    "*" + noticia.titular + "*";

  var nid = generarId(noticia.titular);
  await guardarNoticiaCache(nid, noticia);

  var resultado = await telegramRequest("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID,
    text: texto,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[
        { text: "👁 Ver análisis", callback_data: "ver_" + nid },
        { text: "🗑 Descartar", callback_data: "del_" + nid }
      ]]
    }
  });

  return resultado;
}

async function enviarAnalisisCompleto(noticia, chatId, messageId) {
  var temaEmoji = { "Conflictos armados": "⚔️", "Diplomacia": "🤝", "Seguridad y defensa": "🛡️", "Economia global": "💰", "Energia y recursos": "⚡", "Derechos humanos": "🕊️" };
  var emojiTema = temaEmoji[noticia.categoria_tematica] || "🌍";

  var triangulacion = "";
  if (noticia.triangulacion && noticia.triangulacion.fuentes_contrastadas && noticia.triangulacion.fuentes_contrastadas.length > 0) {
    triangulacion = "\n\n*📡 VERIFICACION:* " + noticia.triangulacion.fuentes_contrastadas.join(", ");
    if (noticia.triangulacion.contradicciones && noticia.triangulacion.contradicciones !== "") {
      triangulacion += "\n⚠️ _" + noticia.triangulacion.contradicciones + "_";
    } else {
      triangulacion += "\n✅ _Fuentes consistentes_";
    }
  }

  var linksStr = (noticia.fuentes_links || []).map(function(f) {
    return "• [" + (f.medio || f) + "](" + (f.url || "#") + ")";
  }).join("\n");

  var imagenInfo = noticia.imagen ? "\n🖼️ _Imagen: " + (noticia.imagen_fuente || "fuente") + "_" : "\n📷 _Sin imagen disponible para esta noticia_";

  var extraBloque = "";
  if (noticia.extra && noticia.extra.contenido && noticia.extra.contenido !== "" && noticia.extra.contenido !== "null") {
    var extraEmojis = { "claves": "🔑", "analisis": "📊", "actores": "🌐", "contexto": "❓" };
    var extraTitulos = { "claves": "CLAVES", "analisis": "ANALISIS", "actores": "ACTORES IMPLICADOS", "contexto": "QUE SIGNIFICA ESTO" };
    var eEmoji = extraEmojis[noticia.extra.tipo] || "📌";
    var eTitulo = extraTitulos[noticia.extra.tipo] || "NOTA";
    extraBloque = "\n\n" + eEmoji + " *" + eTitulo + ":*\n" + noticia.extra.contenido;
  }

  // MENSAJE INTERNO
  var msg1 = emojiTema + " *" + noticia.categoria_tematica + "* | " + noticia.region + "\n" +
    ((noticia.seguimiento && noticia.seguimiento !== "") ? "🔔 *SEGUIMIENTO:* " + noticia.seguimiento + "\n" : "") +
    "\n📰 *" + noticia.titular + "*\n\n" +
    "*📊 ANALISIS INTERNO:*\n" + noticia.analisis_interno +
    triangulacion + "\n\n" +
    "*🔗 FUENTES:*\n" + linksStr +
    imagenInfo;

  // MENSAJE EXTERNO
  var fuentesStr = (noticia.fuentes_links || []).map(function(f) { return f.medio || f; }).join(" · ");
  var msg2 = "🌍 " + noticia.categoria_tematica + " · " + noticia.region + "\n" +
    ((noticia.seguimiento && noticia.seguimiento !== "") ? "🔔 Seguimiento: " + noticia.seguimiento + "\n" : "") +
    "\n" + noticia.titular + "\n\n" +
    noticia.texto_instagram +
    extraBloque + "\n\n" +
    "📰 " + fuentesStr;

  // Editar mensaje original para indicar que fue leido
  if (messageId) {
    await telegramRequest("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    });
  }

  // Enviar imagen si existe
  if (noticia.imagen) {
    try {
      await telegramRequest("sendPhoto", {
        chat_id: chatId,
        photo: noticia.imagen,
        caption: "🖼️ " + noticia.titular,
      });
    } catch (e) {
      console.warn("Imagen no enviable, continuando sin ella");
    }
  }

  await telegramRequest("sendMessage", { chat_id: chatId, text: msg1, parse_mode: "Markdown", disable_web_page_preview: false });
  await new Promise(function(r) { setTimeout(r, 800); });
  await telegramRequest("sendMessage", { chat_id: chatId, text: msg2, parse_mode: "Markdown" });
}

// ── Analisis ──────────────────────────────────────────────────────────────────
async function analizarYEnviar(titulares) {
  var fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  var seguimientos = await getSeguimientos();
  var seguimientosStr = seguimientos.join(", ");

  var resumen = titulares.slice(0, 35).map(function(t) {
    return "- [" + t.medio + "] " + t.titulo + (t.imagen ? " [IMG]" : "") + " | " + t.link;
  }).join("\n");

  console.log("Claude paso 1: seleccionando...");
  var seleccion = await callClaude(
    "Eres analista geopolitico senior especializado en MENA. Responde UNICAMENTE con JSON valido. Sin markdown.",
    "Fecha: " + fecha + ". Seguimientos activos: " + seguimientosStr + "\n" +
    "Titulares recientes:\n" + resumen + "\n\n" +
    "Selecciona entre 2 y 4 noticias verdaderamente importantes. Prioriza calidad sobre cantidad. Si no hay nada relevante devuelve array vacio.\n" +
    "Umbrales: MENA >= 6, Global >= 8. Si varios titulares tratan el mismo hecho cuentalos como UNO.\n" +
    "Categorias validas: Conflictos armados, Diplomacia, Seguridad y defensa, Economia global, Energia y recursos, Derechos humanos.\n" +
    "Regiones validas: MENA, Europa, Asia-Pacifico, America, Africa Subsahariana, Global.\n\n" +
    "{\"seleccion\":[{\"titulo_original\":\"Titulo exacto\",\"url_noticia\":\"URL del articulo\",\"puntuacion\":8,\"region\":\"MENA\",\"categoria_tematica\":\"Conflictos armados\",\"seguimiento\":\"\",\"fuentes_detectadas\":[{\"medio\":\"Al Jazeera\",\"url\":\"URL especifica del articulo\"}]}]}"
  );

  var seleccionadas = seleccion.seleccion || [];
  if (seleccionadas.length === 0) {
    console.log("Sin noticias relevantes en este ciclo");
    return [];
  }
  console.log("Seleccionadas: " + seleccionadas.length);

  console.log("Claude paso 2: redactando...");
  var titulosStr = seleccionadas.map(function(s) {
    return "- " + s.titulo_original + " [" + s.region + "] [" + s.categoria_tematica + "] URL: " + s.url_noticia;
  }).join("\n");

  var redaccion = await callClaude(
    "Eres analista geopolitico senior especializado en MENA. Responde UNICAMENTE con JSON valido. Sin markdown.",
    "Redacta estas noticias para un canal de divulgacion geopolitica en Instagram.\n\n" +
    "NORMAS DE TONO ESTRICTAS:\n" +
    "- Solo hechos verificables y sus consecuencias objetivas. Cero valoraciones morales o ideologicas.\n" +
    "- Si citas un dato (cifra, acuerdo, nombre de organismo), indica entre parentesis la fuente: (segun ONU), (segun Reuters).\n" +
    "- El analisis explica que implica el hecho geopoliticamente. No juzga si es bueno o malo.\n" +
    "- El bloque extra es opcional. Solo incluyelo si aporta informacion factual adicional relevante. Tipos:\n" +
    "  * claves: 3 puntos factuales concretos sobre el hecho en cuestion (no sobre la region en general)\n" +
    "  * analisis: implicaciones estructurales no evidentes del hecho especifico\n" +
    "  * actores: como afecta o que posicion tienen terceros actores (EEUU, China, UE...) respecto a ESTE hecho\n" +
    "  * contexto: explicacion para noticias tecnicas o poco conocidas\n" +
    "- Si usas un bloque extra, debe tener minimo 3 puntos. Si no los hay, deja el contenido vacio.\n\n" +
    "Noticias:\n" + titulosStr + "\n\n" +
    "{\"noticias\":[{" +
    "\"titular\":\"Titular breve en espanol\"," +
    "\"texto_instagram\":\"2-3 frases. Hechos y consecuencias objetivas. Sin valoraciones. Sin hashtags.\"," +
    "\"analisis_interno\":\"Que implica geopoliticamente. Solo hechos y consecuencias. Datos con fuente entre parentesis.\"," +
    "\"titulo_original\":\"Titulo original exacto\"," +
    "\"extra\":{\"tipo\":\"claves\",\"contenido\":\"\"}" +
    "}]}"
  );

  var noticiasRedactadas = redaccion.noticias || [];
  var noticias = noticiasRedactadas.map(function(n) {
    var sel = seleccionadas.find(function(s) {
      return s.titulo_original && n.titulo_original &&
        s.titulo_original.toLowerCase().slice(0, 25) === n.titulo_original.toLowerCase().slice(0, 25);
    }) || {};

    var fuentes = sel.fuentes_detectadas || [];
    var triangulacion = {
      fuentes_contrastadas: fuentes.map(function(f) { return f.medio || f; }),
      contradicciones: ""
    };

    // Buscar imagen en titulares originales
    var originalTitular = titulares.find(function(t) {
      return t.titulo && n.titulo_original &&
        t.titulo.toLowerCase().slice(0, 25) === n.titulo_original.toLowerCase().slice(0, 25);
    });
    var imagen = originalTitular ? originalTitular.imagen : null;
    var imagen_fuente = (imagen && originalTitular) ? originalTitular.medio : null;

    if (n.extra && (!n.extra.contenido || n.extra.contenido === "" || n.extra.contenido === "null")) {
      n.extra = null;
    }

    return Object.assign({}, n, {
      puntuacion: sel.puntuacion || 7,
      region: sel.region || "Global",
      categoria_tematica: sel.categoria_tematica || "Diplomacia",
      seguimiento: sel.seguimiento || "",
      fuentes_links: fuentes,
      triangulacion: triangulacion,
      imagen: imagen,
      imagen_fuente: imagen_fuente,
    });
  });

  // Deduplicacion
  var enviadas = filtrar24h(await getEnviadas());
  var idsEnviados = {};
  for (var k = 0; k < enviadas.length; k++) { idsEnviados[enviadas[k].id] = true; }
  var nuevas = noticias.filter(function(n) { return !idsEnviados[generarId(n.titular)]; });

  console.log("Nuevas a enviar: " + nuevas.length);
  if (nuevas.length === 0) return noticias;

  // Enviar separador si hay noticias
  await enviarSeparador();

  for (var i = 0; i < nuevas.length; i++) {
    await enviarNoticiaMiniatura(nuevas[i]);
    enviadas.push({ id: generarId(nuevas[i].titular), timestamp: Date.now() });
    if (i < nuevas.length - 1) await new Promise(function(r) { setTimeout(r, 1500); });
  }

  await saveEnviadas(enviadas);
  return noticias;
}

// ── Ciclo ─────────────────────────────────────────────────────────────────────
var intervalHandle = null;

async function cicloActualizacion(esRecuperacion) {
  var apagado = await getApagado();
  if (apagado) { console.log("Sistema apagado"); return; }

  var bloqueado = false;
  try {
    var lock = await redis.get("ciclo_lock");
    if (lock) { console.log("Ciclo ya en curso"); return; }
    await redis.set("ciclo_lock", "1");
    await redis.expire("ciclo_lock", 300);
  } catch (e) { console.warn("Lock error: " + e.message); }

  console.log("Iniciando ciclo...");
  try {
    var titulares = await recogerNoticias();
    console.log("Titulares recogidos: " + titulares.length);
    await analizarYEnviar(titulares);
    await setConfig("ultimo_ciclo", Date.now());
    console.log("Ciclo completado");
  } catch (e) {
    console.error("Error en ciclo: " + e.message);
  } finally {
    try { await redis.del("ciclo_lock"); } catch (e) {}
  }
}

async function arrancarIntervalo() {
  if (intervalHandle) clearInterval(intervalHandle);
  var mins = await getFrecuencia();
  console.log("Intervalo: cada " + mins + " min");
  intervalHandle = setInterval(function() { cicloActualizacion(false); }, mins * 60 * 1000);
}

// ── Comandos Telegram ─────────────────────────────────────────────────────────
async function procesarComando(texto) {
  var partes = texto.trim().split(" ");
  var cmd = partes[0].toLowerCase();

  if (cmd === "/estado") {
    var apagado = await getApagado();
    var frecuencia = await getFrecuencia();
    var seguimientos = await getSeguimientos();
    var ultimoCiclo = await getConfig("ultimo_ciclo", 0);
    var hace = ultimoCiclo ? Math.round((Date.now() - ultimoCiclo) / 60000) + " min" : "nunca";
    await enviarTextoTelegram(
      "*Estado del sistema*\n\n" +
      (apagado ? "🔴 APAGADO" : "🟢 ACTIVO") + "\n" +
      "Frecuencia: cada " + frecuencia + " min\n" +
      "Ultimo ciclo: hace " + hace + "\n\n" +
      "*Seguimientos:*\n" + seguimientos.map(function(s) { return "• " + s; }).join("\n")
    );
  } else if (cmd === "/encender") {
    await setConfig("apagado", false);
    await redis.del("ciclo_lock");
    await enviarTextoTelegram("🟢 Sistema *encendido*.");
    await arrancarIntervalo();
    setTimeout(function() { cicloActualizacion(false); }, 2000);
  } else if (cmd === "/apagar") {
    await setConfig("apagado", true);
    await enviarTextoTelegram("🔴 Sistema *apagado*.");
  } else if (cmd === "/frecuencia") {
    var mins = parseInt(partes[1]);
    if (!mins || mins < 10 || mins > 360) {
      await enviarTextoTelegram("Uso: /frecuencia [minutos] (min 10, max 360)");
    } else {
      await setConfig("frecuencia_min", mins);
      await arrancarIntervalo();
      await enviarTextoTelegram("Frecuencia: cada *" + mins + " min*");
    }
  } else if (cmd === "/seguimiento") {
    var accion = partes[1] ? partes[1].toLowerCase() : "";
    var nombre = partes.slice(2).join(" ");
    var seguimientos = await getSeguimientos();
    if (accion === "add" && nombre) {
      if (seguimientos.indexOf(nombre) === -1) {
        seguimientos.push(nombre);
        await setConfig("seguimientos", seguimientos);
        await enviarTextoTelegram("✅ Añadido: *" + nombre + "*");
      } else { await enviarTextoTelegram("Ya existe."); }
    } else if (accion === "remove" && nombre) {
      var idx = -1;
      for (var i = 0; i < seguimientos.length; i++) {
        if (seguimientos[i].toLowerCase() === nombre.toLowerCase()) { idx = i; break; }
      }
      if (idx !== -1) {
        seguimientos.splice(idx, 1);
        await setConfig("seguimientos", seguimientos);
        await enviarTextoTelegram("✅ Eliminado: *" + nombre + "*");
      } else { await enviarTextoTelegram("No encontrado."); }
    } else if (accion === "list") {
      var lista = seguimientos.length > 0 ? seguimientos.map(function(s) { return "• " + s; }).join("\n") : "Sin seguimientos.";
      await enviarTextoTelegram("*Seguimientos:*\n" + lista);
    } else {
      await enviarTextoTelegram("/seguimiento list\n/seguimiento add [nombre]\n/seguimiento remove [nombre]");
    }
  } else if (cmd === "/ahora") {
    await enviarTextoTelegram("Lanzando analisis...");
    setTimeout(function() { cicloActualizacion(false); }, 500);
  } else if (cmd === "/ayuda") {
    await enviarTextoTelegram(
      "*Comandos:*\n\n" +
      "/estado\n/encender\n/apagar\n" +
      "/frecuencia [min]\n" +
      "/seguimiento list\n" +
      "/seguimiento add [nombre]\n" +
      "/seguimiento remove [nombre]\n" +
      "/ahora\n/ayuda"
    );
  }
}

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post("/webhook", async function(req, res) {
  res.sendStatus(200);
  var body = req.body;
  if (!body) return;

  // Manejar callback de botones
  if (body.callback_query) {
    var cb = body.callback_query;
    var cbId = cb.id;
    var cbData = cb.data || "";
    var cbChatId = cb.message && cb.message.chat && cb.message.chat.id;
    var cbMsgId = cb.message && cb.message.message_id;

    // Confirmar recepcion del callback
    await telegramRequest("answerCallbackQuery", { callback_query_id: cbId });

    if (String(cbChatId) !== String(TELEGRAM_CHAT_ID)) return;

    if (cbData.startsWith("ver_")) {
      var nid = cbData.replace("ver_", "");
      var noticia = await obtenerNoticiaCache(nid);
      if (noticia) {
        await enviarAnalisisCompleto(noticia, cbChatId, cbMsgId);
      } else {
        await telegramRequest("sendMessage", { chat_id: cbChatId, text: "⚠️ La noticia ya no esta disponible en cache." });
      }
    } else if (cbData.startsWith("del_")) {
      var nid = cbData.replace("del_", "");
      await borrarNoticiaCache(nid);
      await telegramRequest("deleteMessage", { chat_id: cbChatId, message_id: cbMsgId });
    }
    return;
  }

  // Manejar comandos de texto
  var msg = body.message;
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) return;
  if (msg.text.startsWith("/")) {
    procesarComando(msg.text).catch(function(e) { console.error("Command error:", e.message); });
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await new Promise(function(r) { setTimeout(r, 3000); });
  try { await redis.del("ciclo_lock"); } catch (e) { console.warn("Lock clear: " + e.message); }
  var apagado = await getApagado();
  if (!apagado) {
    await cicloActualizacion(false);
  }
  // Arrancar intervalo DESPUES del primer ciclo para evitar solapamiento
  await arrancarIntervalo();
}

init();

app.get("/", async function(req, res) {
  var apagado = await getApagado();
  var frecuencia = await getFrecuencia();
  var ultimoCiclo = await getConfig("ultimo_ciclo", 0);
  res.json({ status: apagado ? "off" : "on", frecuencia_min: frecuencia, lastUpdate: ultimoCiclo ? new Date(ultimoCiclo).toISOString() : null });
});

var PORT = process.env.PORT || 3000;
var server = app.listen(PORT, function() {
  console.log("Server running on port " + PORT);
  var webhookUrl = process.env.RENDER_EXTERNAL_URL + "/webhook";
  axios.post(TELEGRAM_API + "/setWebhook", { url: webhookUrl })
    .then(function() { console.log("Webhook: " + webhookUrl); })
    .catch(function(e) { console.warn("Webhook error: " + e.message); });
});
server.on("error", function(err) {
  if (err.code === "EADDRINUSE") setTimeout(function() { server.listen(PORT); }, 5000);
});
