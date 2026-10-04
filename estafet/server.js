import "dotenv/config";
import express from "express";

const KEY = process.env.OPENROUTER_API_KEY;
const PORT = process.env.PORT || 3000;
const PREFERRED = (process.env.PREFERRED_MODELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_TRIES = Number(process.env.MAX_TRIES || 8); // berapa model dicoba per pesan
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 20);

const COOLDOWN_MS = 2 * 60 * 1000; // model yang gagal diistirahatkan 2 menit
const FIRST_TOKEN_TIMEOUT_MS = 20000; // kalau 20 detik belum ngomong, dianggap mokad
const MODELS_TTL_MS = 10 * 60 * 1000;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

/* ---------- daftar model gratis (diambil langsung dari OpenRouter) ---------- */
let modelCache = { at: 0, ids: [] };
const cooling = new Map(); // modelId -> timestamp sampai kapan diistirahatkan

async function getFreeModels() {
  if (modelCache.ids.length && Date.now() - modelCache.at < MODELS_TTL_MS) {
    return modelCache.ids;
  }
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    const j = await r.json();
    const ids = j.data
      .filter(
        (m) =>
          m.id.endsWith(":free") &&
          (m.architecture?.input_modalities || ["text"]).includes("text") &&
          (m.architecture?.output_modalities || ["text"]).includes("text")
      )
      .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
      .map((m) => m.id);
    if (ids.length) modelCache = { at: Date.now(), ids };
  } catch (e) {
    console.error("Gagal ambil daftar model:", e.message);
  }
  return modelCache.ids;
}

async function buildCandidates() {
  const free = await getFreeModels();
  const all = [...new Set([...PREFERRED, ...free])];
  const now = Date.now();
  const ready = all.filter((id) => (cooling.get(id) || 0) < now);
  return (ready.length ? ready : all).slice(0, MAX_TRIES);
}

/* ---------- rate limit sederhana per IP (melindungi kuota gratis) ---------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT_PER_MIN;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    if (!arr.some((t) => now - t < 60000)) hits.delete(ip);
  }
}, 60000).unref();

/* ---------- coba satu model; sukses kalau sudah ada token pertama ---------- */
async function tryModel(model, messages, clientSignal) {
  const ctrl = new AbortController();
  const onClientAbort = () => ctrl.abort();
  clientSignal.addEventListener("abort", onClientAbort);
  const timer = setTimeout(() => ctrl.abort(), FIRST_TOKEN_TIMEOUT_MS);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Estafet Chat",
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const held = [];
    let buf = "";
    const hasToken = /"(content|reasoning)"\s*:\s*"[^"]/;

    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream kosong");
      held.push(value);
      buf += dec.decode(value, { stream: true });
      if (hasToken.test(buf)) break;
      if (/"error"\s*:/.test(buf)) throw new Error("error di dalam stream");
      if (buf.includes("[DONE]")) throw new Error("stream kosong");
    }

    clearTimeout(timer);
    return { reader, held };
  } catch (e) {
    clearTimeout(timer);
    ctrl.abort();
    clientSignal.removeEventListener("abort", onClientAbort);
    throw e;
  }
}

/* ---------- endpoint ---------- */
app.get("/api/health", async (_req, res) => {
  const ids = await getFreeModels();
  res.json({ ok: !!KEY, freeModels: ids.length });
});

app.post("/api/chat", async (req, res) => {
  if (!KEY) {
    return res
      .status(500)
      .json({ error: "OPENROUTER_API_KEY belum diisi di file .env" });
  }
  if (rateLimited(req.ip)) {
    return res
      .status(429)
      .json({ error: "Terlalu cepat. Tunggu sebentar lalu coba lagi." });
  }

  const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = raw
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Pesan tidak valid." });
  }
  if (SYSTEM_PROMPT) messages.unshift({ role: "system", content: SYSTEM_PROMPT });

  const clientCtrl = new AbortController();
  res.on("close", () => clientCtrl.abort());

  const candidates = await buildCandidates();
  if (!candidates.length) {
    return res.status(503).json({ error: "Daftar model gratis kosong." });
  }

  let skipped = 0;
  for (const model of candidates) {
    if (clientCtrl.signal.aborted) return;
    try {
      const { reader, held } = await tryModel(model, messages, clientCtrl.signal);

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Model-Used": model,
        "X-Models-Skipped": String(skipped),
      });
      for (const chunk of held) res.write(chunk);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      return res.end();
    } catch (e) {
      if (clientCtrl.signal.aborted) return;
      console.warn(`[skip] ${model}: ${e.message}`);
      cooling.set(model, Date.now() + COOLDOWN_MS);
      skipped++;
    }
  }

  res.status(503).json({
    error:
      "Semua model gratis lagi penuh atau mati. Coba lagi beberapa saat lagi.",
  });
});

app.listen(PORT, () => {
  console.log(`Estafet jalan di http://localhost:${PORT}`);
  if (!KEY) console.warn("Peringatan: OPENROUTER_API_KEY belum diisi.");
});
