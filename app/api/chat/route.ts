export const runtime = "nodejs";

const KEY = process.env.OPENROUTER_API_KEY;
const PREFERRED = (process.env.PREFERRED_MODELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_TRIES = Number(process.env.MAX_TRIES || 8);
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 20);

const COOLDOWN_MS = 2 * 60 * 1000;
const FIRST_TOKEN_TIMEOUT_MS = 20000;
const MODELS_TTL_MS = 10 * 60 * 1000;

/* ---------- daftar model gratis (cache 10 menit) ---------- */
let modelCache: { at: number; ids: string[] } = { at: 0, ids: [] };
const cooling = new Map<string, number>();

async function getFreeModels(): Promise<string[]> {
  if (modelCache.ids.length && Date.now() - modelCache.at < MODELS_TTL_MS) {
    return modelCache.ids;
  }
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    const j = await r.json();
    const ids: string[] = j.data
      .filter(
        (m: any) =>
          m.id.endsWith(":free") &&
          (m.architecture?.input_modalities || ["text"]).includes("text") &&
          (m.architecture?.output_modalities || ["text"]).includes("text")
      )
      .sort((a: any, b: any) => (b.context_length || 0) - (a.context_length || 0))
      .map((m: any) => m.id);
    if (ids.length) modelCache = { at: Date.now(), ids };
  } catch (e: any) {
    console.error("Gagal ambil daftar model:", e.message);
  }
  return modelCache.ids;
}

async function buildCandidates(): Promise<string[]> {
  const free = await getFreeModels();
  const all = [...new Set([...PREFERRED, ...free])];
  const now = Date.now();
  const ready = all.filter((id) => (cooling.get(id) || 0) < now);
  return (ready.length ? ready : all).slice(0, MAX_TRIES);
}

/* ---------- rate limit sederhana per IP ---------- */
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT_PER_MIN;
}
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of hits) {
      if (!arr.some((t) => now - t < 60000)) hits.delete(ip);
    }
  }, 60000);
  timer.unref?.();
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/* ---------- coba satu model; sukses kalau sudah ada token pertama ---------- */
async function tryModel(
  model: string,
  messages: ChatMessage[],
  clientSignal: AbortSignal
): Promise<{ reader: ReadableStreamDefaultReader<Uint8Array>; held: Uint8Array[] }> {
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
        "X-Title": "Rulerz",
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const held: Uint8Array[] = [];
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

export async function POST(req: Request) {
  if (!KEY) {
    return Response.json(
      { error: "OPENROUTER_API_KEY is not set in the .env file" },
      { status: 500 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (rateLimited(ip)) {
    return Response.json(
      { error: "Too fast. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const raw = Array.isArray(body?.messages) ? body.messages : [];
  // Inject persona dari client (maks 800 karakter, cuma teks biasa)
  const persona =
    typeof body?.system === "string" ? body.system.slice(0, 800).trim() : "";
  const messages: ChatMessage[] = raw
    .filter(
      (m: any) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-20)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Invalid message." }, { status: 400 });
  }
  if (SYSTEM_PROMPT) messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  if (persona) messages.unshift({ role: "system", content: persona });

  const clientCtrl = new AbortController();
  req.signal.addEventListener("abort", () => clientCtrl.abort());

  const candidates = await buildCandidates();
  if (!candidates.length) {
    return Response.json(
      { error: "The free model list is empty." },
      { status: 503 }
    );
  }

  let skipped = 0;
  for (const model of candidates) {
    if (clientCtrl.signal.aborted) return new Response(null, { status: 499 as any });
    try {
      const { reader, held } = await tryModel(model, messages, clientCtrl.signal);

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (const chunk of held) controller.enqueue(chunk);
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
        cancel() {
          clientCtrl.abort();
          reader.cancel().catch(() => {});
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Model-Used": model,
          "X-Models-Skipped": String(skipped),
        },
      });
    } catch (e: any) {
      if (clientCtrl.signal.aborted) return new Response(null, { status: 499 as any });
      console.warn(`[skip] ${model}: ${e.message}`);
      cooling.set(model, Date.now() + COOLDOWN_MS);
      skipped++;
    }
  }

  return Response.json(
    {
      error:
        "All free models are busy or unavailable. Please try again later.",
    },
    { status: 503 }
  );
}
