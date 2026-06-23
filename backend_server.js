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
  { name: "BBC World",            url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/worldNews" },
  { name: "Al Jazeera",           url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "France 24",            url: "https://www.france24.com/es/rss" },
  { name: "DW España",            url: "https://rss.dw.com/rss/es-all" },
  { name: "El País Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada" },
  { name: "The Guardian World",   url: "https://www.theguardian.com/world/rss" },
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
    "Eres analista geopolítico experto. Responde ÚNICAMENTE con JSON válido y completo. Sin texto extra ni markdown.",
    `Fecha: ${fecha}.\nTitulares recogidos por RSS:\n${resumen}\n\nSelecciona las 5 más relevantes geopolíticamente y devuelve:\n{"noticias":[{"id":"n1","puntuacion":8,"titular":"Titular breve","resumen":"1-2 frases","bullets":["punto1","punto2","punto3"],"analisis":"Análisis propio","medio":"BBC","link":"https://...","region":"Europa"}]}`
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
setInterval(cicloActualizacion, 10 * 60 * 1000); // Cada 10 min

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", lastUpdate: cache.lastUpdate }));
app.get("/api/datos", (req, res) => res.json(cache));
app.post("/api/actualizar", async (req, res) => {
  cicloActualizacion();
  res.json({ message: "Actualización iniciada" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Servidor corriendo en puerto ${PORT}`));
