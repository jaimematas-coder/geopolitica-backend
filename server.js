const express = require("express");
const cors = require("cors");
const RSSParser = require("rss-parser");
const fetch = require("node-fetch");

const app = express();
const parser = new RSSParser();

app.use(cors());
app.use(express.json());

// ── Fuentes RSS ───────────────────────────────────────────────────────────────
const RSS_FEEDS = [
  // Occidente - Generalistas
  { name: "BBC World",              url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Reuters World",          url: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "The Guardian World",     url: "https://www.theguardian.com/world/rss" },
  { name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { name: "Der Spiegel",            url: "https://www.spiegel.de/international/index.rss" },
  { name: "El País Internacional",  url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "France 24",              url: "https://www.france24.com/es/rss" },
  { name: "DW World",               url: "https://rss.dw.com/rss/en-all" },
  { name: "AP News",                url: "https://feeds.apnews.com/rss/apf-intlnews" },
  { name: "AFP",                    url: "https://www.afp.com/en/rss.xml" },

  // Think tanks y análisis
  { name: "Foreign Affairs",        url: "https://www.foreignaffairs.com/rss.xml" },
  { name: "Foreign Policy",         url: "https://foreignpolicy.com/feed/" },
  { name: "The Diplomat",           url: "https://thediplomat.com/feed/" },
  { name: "War on the Rocks",       url: "https://warontherocks.com/feed/" },
  { name: "Bellingcat",             url: "https://www.bellingcat.com/feed/" },
  { name: "Crisis Group",           url: "https://www.crisisgroup.org/rss.xml" },
  { name: "Council on Foreign Relations", url: "https://www.cfr.org/rss/feeds/publication_types/expert_brief" },

  // Perspectiva no occidental
  { name: "Al Jazeera",             url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { name: "Middle East Eye",        url: "https://www.middleeasteye.net/rss" },
  { name: "Daily Sabah",            url: "https://www.dailysabah.com/rssFeed/push_notifications" },

  // India y Asia del Sur
  { name: "The Hindu",              url: "https://www.thehindu.com/news/international/?service=rss" },
  { name: "The Wire",               url: "https://thewire.in/feed" },
  { name: "Indian Express World",   url: "https://indianexpress.com/section/world/feed/" },

  // África y América Latina
  { name: "African Arguments",      url: "https://africanarguments.org/feed/" },
  { name: "NACLA (América Latina)", url: "https://nacla.org/rss.xml" },
  { name: "Agencia EFE",            url: "https://www.efe.com/efe/espana/mundo/rss/16" },

  // Asia-Pacífico y otros
  { name: "Nikkei Asia",            url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "Asia Times",             url: "https://asiatimes.com/feed/" },
];

// ── Cache en memoria ───────────────────────────────────────────────────────────
let cache = {
  noticias:  [],
  encuestas: [],
  tracker:   { nuevos_conflictos: [], actualizaciones: [] },
  analisis:  [],
  biblioteca:[],
  lastUpdate: null,
};

// ── Recoger noticias por RSS ───────────────────────────────────────────────────
async function recogerNoticias() {
  const titulares = [];
  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, 8);
      for (const item of items) {
        titulares.push({
          titulo: item.title || "",
          resumen: item.contentSnippet || item.summary || "",
          link: item.link || "",
          medio: feed.name,
        });
      }
    } catch (e) {
      console.warn(`Error leyendo ${feed.name}: ${e.message}`);
    }
  }
  return titulares;
}

// ── Llamada a Claude ───────────────────────────────────────────────────────────
async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");

  // Extraer JSON robusto
  const start = text.indexOf("{");
  let end = text.lastIndexOf("}");
  while (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { end = text.lastIndexOf("}", end - 1); }
  }
  throw new Error("No se pudo extraer JSON de la respuesta");
}

// ── Análisis completo ──────────────────────────────────────────────────────────
async function analizarNoticias(titulares) {
  const fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const resumen = titulares.slice(0, 30).map(t => `- [${t.medio}] ${t.titulo}`).join("\n");

  // 1. Noticias
  const noticiasData = await callClaude(
    "Eres analista geopolítico senior con 15 años de experiencia. Responde ÚNICAMENTE con JSON válido y completo. Sin texto extra ni markdown.",
    `Fecha: ${fecha}.\nTitulares recogidos por RSS:\n${resumen}\n\nSelecciona las 5 más relevantes geopolíticamente y devuelve:\n{"noticias":[{"id":"n1","puntuacion":8,"titular":"Titular breve y directo","resumen":"1-2 frases concisas","bullets":["Frase corta. Máximo 10 palabras.","Frase corta. Máximo 10 palabras.","Frase corta. Máximo 10 palabras."],"analisis":"Análisis profundo con criterio propio: una frase larga y densa o dos frases cortas que aporten perspectiva real, no descripción. Debe revelar implicaciones, contexto histórico o consecuencias no evidentes.","medio":"BBC","link":"https://...","region":"Europa"}]}`
  );
  const noticias = (noticiasData.noticias || []).filter(n => n.puntuacion >= 6);

  const titularesIA = noticias.map(n => `- ${n.titular}`).join("\n") || "- Sin noticias";

  // 2. Resto en paralelo
  const [enc, trk, ana, bib] = await Promise.allSettled([
    callClaude(
      "Eres experto en comunidades de divulgación. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\n\nGenera 3 encuestas:\n{"encuestas":[{"id":"e1","titulo":"Pregunta","opciones":["A","B","C"],"motivo":"Razón","basada_en":"Noticia"}]}`
    ),
    callClaude(
      "Eres analista de conflictos. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\n\nGenera tracker:\n{"nuevos_conflictos":[{"id":"c1","nombre":"Conflicto","region":"Región","descripcion":"Frase","nivel_alerta":"alto"}],"actualizaciones":[{"conflicto":"Nombre","update":"Actualización breve"}]}`
    ),
    callClaude(
      "Eres experto en divulgación geopolítica. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\n\nGenera 3 temáticas para análisis del mes:\n{"tematicas":[{"id":"a1","titulo":"Título","subtitulo":"Enfoque","descripcion":"Relevancia","zonas":["Europa"],"secciones_sugeridas":["Sec1","Sec2","Sec3"]}]}`
    ),
    callClaude(
      "Eres experto en divulgación geopolítica. Responde ÚNICAMENTE con JSON válido.",
      `Noticias:\n${titularesIA}\n\nGenera 4 sugerencias de biblioteca:\n{"sugerencias":[{"id":"b1","zona":"Europa","titulo":"Título","descripcion":"De qué trata","motivo":"Por qué ahora","subtemas":["sub1","sub2"]}]}`
    ),
  ]);

  return {
    noticias,
    encuestas:  enc.status  === "fulfilled" ? enc.value.encuestas  || [] : [],
    tracker:    trk.status  === "fulfilled" ? trk.value            : { nuevos_conflictos: [], actualizaciones: [] },
    analisis:   ana.status  === "fulfilled" ? ana.value.tematicas  || [] : [],
    biblioteca: bib.status  === "fulfilled" ? bib.value.sugerencias|| [] : [],
    lastUpdate: new Date().toISOString(),
  };
}

// ── Ciclo automático cada 10 minutos ──────────────────────────────────────────
async function cicloActualizacion() {
  console.log("🔄 Iniciando ciclo de actualización...");
  try {
    const titulares = await recogerNoticias();
    console.log(`📰 ${titulares.length} titulares recogidos`);
    cache = await analizarNoticias(titulares);
    console.log(`✅ Actualización completada: ${cache.lastUpdate}`);
  } catch (e) {
    console.error("❌ Error en ciclo:", e.message);
  }
}

cicloActualizacion(); // Al arrancar
setInterval(cicloActualizacion, 30 * 60 * 1000); // Cada 30 min

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", lastUpdate: cache.lastUpdate }));
app.get("/api/datos", (req, res) => res.json(cache));
app.post("/api/actualizar", async (req, res) => {
  cicloActualizacion();
  res.json({ message: "Actualización iniciada" });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🌍 Servidor corriendo en puerto ${PORT}`));
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Puerto ${PORT} ocupado, reintentando en 5s...`);
    setTimeout(() => server.listen(PORT), 5000);
  }
});
