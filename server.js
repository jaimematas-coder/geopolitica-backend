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
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "AP News", url: "https://feeds.apnews.com/rss/apf-intlnews" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss" },
  { name: "The Independent World", url: "https://www.independent.co.uk/news/world/rss" },
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "France 24", url: "https://www.france24.com/es/rss" },
  { name: "Der Spiegel", url: "https://www.spiegel.de/international/index.rss" },
  { name: "Euronews", url: "https://feeds.feedburner.com/euronews/en/news/" },
  { name: "The Economist", url: "https://www.economist.com/international/rss.xml" },
  { name: "Financial Times World", url: "https://www.ft.com/world?format=rss" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { name: "Washington Post World", url: "https://feeds.washingtonpost.com/rss/world" },
  { name: "Newsweek World", url: "https://www.newsweek.com/rss" },
  { name: "Politico EU", url: "https://www.politico.eu/feed/" },
  { name: "El Pais Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "El Mundo Internacional", url: "https://e00-elmundo.uecdn.es/elmundo/rss/internacional.xml" },
  { name: "El Confidencial Mundo", url: "https://www.elconfidencial.com/mundo/rss/" },
  { name: "La Vanguardia Internacional", url: "https://www.lavanguardia.com/internacional/index.rss" },
  { name: "Agencia EFE", url: "https://www.efe.com/efe/espana/mundo/rss/16" },
  { name: "Infobae Internacional", url: "https://www.infobae.com/feeds/rss/internacional/" },
  { name: "DW Espanol", url: "https://rss.dw.com/rss/es-all" },
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "Global Times", url: "https://www.globaltimes.cn/rss/outbrain.xml" },
  { name: "CGTN World", url: "https://www.cgtn.com/subscribe/rss/section/world.xml" },
  { name: "The Straits Times", url: "https://www.straitstimes.com/news/world/rss.xml" },
  { name: "The Hindu World", url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "Asia Times", url: "https://asiatimes.com/feed/" },
  { name: "Dawn Pakistan", url: "https://www.dawn.com/feeds/home" },
  { name: "Hurriyet Daily News", url: "https://www.hurriyetdailynews.com/rss" },
  { name: "AllAfrica", url: "https://allafrica.com/tools/headlines/rdf/world/headlines.rdf" },
  { name: "The East African", url: "https://www.theeastafrican.co.ke/tea/rss" },
  { name: "African Arguments", url: "https://africanarguments.org/feed/" },
  { name: "Folha Internacional", url: "https://feeds.folha.uol.com.br/mundo/rss091.xml" },
  { name: "TASS English", url: "https://tass.com/rss/v2.xml" },
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
];

async function getConfig(key, defaultVal) {
  try {
    const data = await redis.get(key);
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

async function callClaude(system, user) {
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model: "claude-sonnet-4-6", max_tokens: 4000, system: system, messages: [{ role: "user", content: user }] },
    { timeout: 60000, headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } }
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

async function recogerNoticias() {
  const titulares = [];
  for (var i = 0; i < RSS_FEEDS.length; i++) {
    var feed = RSS_FEEDS[i];
    try {
      var parsed = await parser.parseURL(feed.url);
      var items = (parsed.items || []).slice(0, 5);
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        titulares.push({
          titulo: item.title || "",
          resumen: item.contentSnippet || "",
          link: item.link || "",
          medio: feed.name,
          imagen: extraerImagenRSS(item),
        });
      }
    } catch (e) { console.warn("Error reading " + feed.name + ": " + e.message); }
  }
  return titulares;
}

async function enviarTextoTelegram(texto) {
  try {
    await axios.post(TELEGRAM_API + "/sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: texto, parse_mode: "Markdown" }, { timeout: 10000 });
  } catch (e) { console.error("Telegram msg error: " + e.message); }
}

async function enviarNoticiaTelegram(noticia, esRecuperacion) {
  var urgencia = noticia.puntuacion >= 9 ? "🔴 URGENTE" : noticia.puntuacion >= 8 ? "🟠 IMPORTANTE" : "🟡 DESTACADO";
  var temaEmoji = { "Conflictos armados": "⚔️", "Diplomacia": "🤝", "Seguridad y defensa": "🛡️", "Economia global": "💰", "Energia y recursos": "⚡", "Derechos humanos": "🕊️" };
  var emojiTema = temaEmoji[noticia.categoria_tematica] || "🌍";

  var seguimientoLinea = (noticia.seguimiento && noticia.seguimiento !== "") ? "🔔 SEGUIMIENTO: " + noticia.seguimiento + "\n" : "";
  var recuperacionLinea = esRecuperacion ? "🕐 Noticia reciente no enviada\n" : "";

  var triangulacion = "";
  if (noticia.triangulacion && noticia.triangulacion.fuentes_contrastadas && noticia.triangulacion.fuentes_contrastadas.length > 0) {
    triangulacion = "\n\n*📡 VERIFICACION:* " + noticia.triangulacion.fuentes_contrastadas.join(", ");
    if (noticia.triangulacion.contradicciones && noticia.triangulacion.contradicciones !== "") {
      triangulacion += "\n⚠️ _" + noticia.triangulacion.contradicciones + "_";
    } else {
      triangulacion += "\n✅ _Fuentes consistentes_";
    }
  } else {
    triangulacion = "\n\n*📡 VERIFICACION:* _Fuente unica_";
  }

  var imagenFuente = noticia.imagen_fuente ? "\n🖼️ _Imagen: " + noticia.imagen_fuente + "_" : "";
  var linksStr = (noticia.fuentes_links || []).map(function(f) { return "• [" + f.medio + "](" + f.url + ")"; }).join("\n");

  var extraBloque = "";
  if (noticia.extra && noticia.extra.contenido && noticia.extra.contenido !== "null" && noticia.extra.contenido !== "") {
    var extraEmoji = { "claves": "🔑 *3 CLAVES:*", "implicaciones": "❓ *QUE IMPLICA:*", "visita_estado": "🤝 *QUE SE BUSCA / CONSIGUE:*", "reaccion_potencias": "🌐 *REACCION INTERNACIONAL:*" };
    var extraLabel = extraEmoji[noticia.extra.tipo] || "📌 *NOTA:*";
    extraBloque = "\n\n" + extraLabel + "\n" + noticia.extra.contenido;
  }

  var fuentesStr = (noticia.fuentes_links || []).map(function(f) { return f.medio; }).join(" · ");

  // MENSAJE 1: Interno
  var msg1 = urgencia + "\n" +
    seguimientoLinea +
    recuperacionLinea +
    emojiTema + " *" + noticia.categoria_tematica + "* | " + noticia.region + "\n\n" +
    "📰 *" + noticia.titular + "*\n\n" +
    "*📊 ANALISIS INTERNO:*\n" + noticia.analisis_interno +
    triangulacion + "\n\n" +
    "*🔗 FUENTES:*\n" + linksStr +
    imagenFuente;

  // MENSAJE 2: Externo listo para copiar
  var categoriaLinea = "🌍 " + noticia.categoria_tematica + " · " + noticia.region + "\n";
  var seguimientoExt = (noticia.seguimiento && noticia.seguimiento !== "") ? "🔔 Seguimiento: " + noticia.seguimiento + "\n" : "";

  var msg2 = categoriaLinea +
    seguimientoExt + "\n" +
    noticia.titular + "\n\n" +
    noticia.texto_instagram +
    extraBloque + "\n\n" +
    "📰 " + fuentesStr;

  try {
    if (noticia.imagen) {
      await axios.post(TELEGRAM_API + "/sendPhoto", { chat_id: TELEGRAM_CHAT_ID, photo: noticia.imagen, caption: msg1, parse_mode: "Markdown" }, { timeout: 15000 });
    } else {
      await axios.post(TELEGRAM_API + "/sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: msg1, parse_mode: "Markdown", disable_web_page_preview: false }, { timeout: 15000 });
    }
    await new Promise(function(r) { setTimeout(r, 1000); });
    await axios.post(TELEGRAM_API + "/sendMessage", { chat_id: TELEGRAM_CHAT_ID, text: msg2, parse_mode: "Markdown" }, { timeout: 15000 });
    console.log("Sent: " + noticia.titular);
    return true;
  } catch (e) {
    console.error("Telegram error: " + e.message);
    return false;
  }
}

async function analizarYEnviar(titulares, esRecuperacion) {
  var fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  var seguimientos = await getSeguimientos();
  var seguimientosStr = seguimientos.join(", ");

  var resumen = titulares.slice(0, 35).map(function(t) {
    return "- [" + t.medio + "] " + t.titulo + (t.imagen ? " [IMG]" : "");
  }).join("\n");

  console.log("Calling Claude...");
  var data = await callClaude(
    "Eres analista geopolitico senior especializado en Oriente Medio y Norte de Africa (MENA), aunque cubres geopolitica global. Responde UNICAMENTE con JSON valido y completo. Sin markdown.",
    "Fecha: " + fecha + ".\n" +
    "Seguimientos activos: " + seguimientosStr + "\n" +
    "Titulares (los marcados con [IMG] tienen imagen):\n" + resumen + "\n\n" +
    "INSTRUCCIONES:\n" +
    "1. Selecciona entre 4 y 6 noticias: 2-3 MENA con analisis profundo + 2-3 globales importantes. No excluyas noticias relevantes de otras regiones.\n" +
    "2. UMBRALES: para noticias MENA acepta puntuacion >= 6. Para noticias globales acepta >= 8.\n" +
    "3. Si varios titulares cubren el mismo hecho, cuentalos como UNO y contrasta hasta 3 fuentes.\n" +
    "4. Decide si cada noticia requiere bloque extra (no siempre): claves, implicaciones, visita_estado, reaccion_potencias.\n" +
    "5. Si la noticia actualiza un seguimiento activo, indicalo.\n" +
    "6. Categorias tematicas: Conflictos armados, Diplomacia, Seguridad y defensa, Economia global, Energia y recursos, Derechos humanos.\n" +
    "7. Categorias de region: MENA, Europa, Asia-Pacifico, America, Africa Subsahariana, Global.\n" +
    "8. TASS y Global Times usarlos solo para triangulacion, nunca como fuente principal.\n\n" +
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

  var noticias = data.noticias || [];
  console.log("Noticias seleccionadas: " + noticias.length);

  for (var i = 0; i < noticias.length; i++) {
    var n = noticias[i];
    var original = null;
    for (var j = 0; j < titulares.length; j++) {
      if (titulares[j].titulo && n.titulo_original &&
        titulares[j].titulo.toLowerCase().slice(0, 30) === n.titulo_original.toLowerCase().slice(0, 30)) {
        original = titulares[j];
        break;
      }
    }
    if (original && original.imagen) {
      n.imagen = original.imagen;
      n.imagen_fuente = original.medio;
    } else { n.imagen = null; }
    if (n.extra && (!n.extra.contenido || n.extra.contenido === "" || n.extra.contenido === "null")) n.extra = null;
  }

  var enviadas = filtrar24h(await getEnviadas());
  var idsEnviados = {};
  for (var k = 0; k < enviadas.length; k++) { idsEnviados[enviadas[k].id] = true; }
  var nuevas = noticias.filter(function(n) { return !idsEnviados[generarId(n.titular)]; });

  console.log("Nuevas a enviar: " + nuevas.length);

  for (var i = 0; i < nuevas.length; i++) {
    var enviado = await enviarNoticiaTelegram(nuevas[i], esRecuperacion || false);
    if (enviado) enviadas.push({ id: generarId(nuevas[i].titular), timestamp: Date.now() });
    if (i < nuevas.length - 1) await new Promise(function(r) { setTimeout(r, 3000); });
  }

  await saveEnviadas(enviadas);
  return noticias;
}

var intervalHandle = null;

async function cicloActualizacion(esRecuperacion) {
  var apagado = await getApagado();
  if (apagado) { console.log("Sistema apagado, skipping"); return; }

  try {
    var bloqueado = await redis.get("ciclo_lock");
    if (bloqueado) { console.log("Cycle already running, skipping"); return; }
    await redis.set("ciclo_lock", "1");
    await redis.expire("ciclo_lock", 300);
  } catch (e) { console.warn("Lock error: " + e.message); }

  console.log("Starting cycle...");
  try {
    var titulares = await recogerNoticias();
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
  var mins = await getFrecuencia();
  console.log("Interval: every " + mins + " min");
  intervalHandle = setInterval(function() { cicloActualizacion(false); }, mins * 60 * 1000);
}

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
    await enviarTextoTelegram("🟢 Sistema *encendido*. Buscando noticias recientes...");
    await cicloActualizacion(true);
    await arrancarIntervalo();
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
      await enviarTextoTelegram("Frecuencia actualizada: cada *" + mins + " minutos*");
    }
  } else if (cmd === "/seguimiento") {
    var accion = partes[1] ? partes[1].toLowerCase() : "";
    var nombre = partes.slice(2).join(" ");
    var seguimientos = await getSeguimientos();
    if (accion === "add" && nombre) {
      if (seguimientos.indexOf(nombre) === -1) {
        seguimientos.push(nombre);
        await setConfig("seguimientos", seguimientos);
        await enviarTextoTelegram("Seguimiento añadido: *" + nombre + "*");
      } else {
        await enviarTextoTelegram("Ya existe ese seguimiento.");
      }
    } else if (accion === "remove" && nombre) {
      var idx = -1;
      for (var i = 0; i < seguimientos.length; i++) {
        if (seguimientos[i].toLowerCase() === nombre.toLowerCase()) { idx = i; break; }
      }
      if (idx !== -1) {
        seguimientos.splice(idx, 1);
        await setConfig("seguimientos", seguimientos);
        await enviarTextoTelegram("Seguimiento eliminado: *" + nombre + "*");
      } else {
        await enviarTextoTelegram("No encontrado.");
      }
    } else if (accion === "list") {
      var lista = seguimientos.length > 0 ? seguimientos.map(function(s) { return "• " + s; }).join("\n") : "Sin seguimientos.";
      await enviarTextoTelegram("*Seguimientos activos:*\n" + lista);
    } else {
      await enviarTextoTelegram("/seguimiento list\n/seguimiento add [nombre]\n/seguimiento remove [nombre]");
    }
  } else if (cmd === "/ahora") {
    await enviarTextoTelegram("Lanzando analisis...");
    cicloActualizacion(false);
  } else if (cmd === "/ayuda") {
    await enviarTextoTelegram(
      "*Comandos disponibles:*\n\n" +
      "/estado\n/encender\n/apagar\n" +
      "/frecuencia [min]\n" +
      "/seguimiento list\n" +
      "/seguimiento add [nombre]\n" +
      "/seguimiento remove [nombre]\n" +
      "/ahora\n/ayuda"
    );
  }
}

app.post("/webhook", async function(req, res) {
  res.sendStatus(200);
  var msg = req.body && req.body.message;
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) return;
  if (msg.text.startsWith("/")) {
    procesarComando(msg.text).catch(function(e) { console.error("Command error:", e.message); });
  }
});

async function init() {
  var ultimoCiclo = await getConfig("ultimo_ciclo", 0);
  var horasApagado = (Date.now() - ultimoCiclo) / 3600000;
  var apagado = await getApagado();

  if (!apagado && horasApagado > 0.6) {
    console.log("Recovery: " + horasApagado.toFixed(1) + "h since last cycle");
    await enviarTextoTelegram("Sistema reactivado. Buscando noticias de las ultimas " + Math.round(horasApagado) + "h...");
    await cicloActualizacion(true);
  } else if (!apagado) {
    await cicloActualizacion(false);
  }
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
    .then(function() { console.log("Webhook set: " + webhookUrl); })
    .catch(function(e) { console.warn("Webhook error: " + e.message); });
});
server.on("error", function(err) {
  if (err.code === "EADDRINUSE") setTimeout(function() { server.listen(PORT); }, 5000);
});
