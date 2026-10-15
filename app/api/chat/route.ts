import { getModels } from "../../lib/models";
import {
  CONTEXT_LIMIT,
  IMAGE_DATA_URL,
  MAX_IMAGE_CHARS,
  MAX_IMAGES,
  MAX_PERSONA_CHARS,
  MAX_TEXT_CHARS,
  type ApiPart,
} from "../../lib/shared";

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
// Ditolak permanen (akses/model tidak ada): jangan dicoba lagi untuk sementara.
const BLOCKED_MS = 60 * 60 * 1000;
const FIRST_TOKEN_TIMEOUT_MS = 20000;

/* ---------- kandidat model ---------- */
const cooling = new Map<string, number>();
// Model yang terakhir berhasil menjawab dicoba lebih dulu.
let lastGood = "";

async function buildCandidates(needVision: boolean): Promise<string[]> {
  const { free, byId } = await getModels();
  let all = [...new Set([lastGood, ...PREFERRED, ...free.map((m) => m.id)])].filter(Boolean);
  if (needVision) all = all.filter((id) => byId.get(id)?.vision);
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
  content: string | ApiPart[];
}

/* ---------- validasi pesan dari client ---------- */
function sanitize(raw: unknown): { messages: ChatMessage[]; images: number } {
  const list = Array.isArray(raw) ? raw.slice(-CONTEXT_LIMIT) : [];
  const out: ChatMessage[] = [];
  let images = 0;

  // Dari pesan terbaru ke terlama, supaya batas gambar menyisakan yang terbaru.
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] as { role?: unknown; content?: unknown };
    if (m?.role !== "user" && m?.role !== "assistant") continue;

    if (typeof m.content === "string") {
      if (m.content.trim()) {
        out.unshift({ role: m.role, content: m.content.slice(0, MAX_TEXT_CHARS) });
      }
      continue;
    }
    if (m.role !== "user" || !Array.isArray(m.content)) continue;

    let text = "";
    const pics: ApiPart[] = [];
    for (const p of m.content as Partial<ApiPart>[]) {
      if (p?.type === "text" && typeof p.text === "string") {
        text += p.text;
      } else if (p?.type === "image_url") {
        const url = p.image_url?.url;
        if (
          typeof url === "string" &&
          url.length <= MAX_IMAGE_CHARS &&
          IMAGE_DATA_URL.test(url) &&
          images < MAX_IMAGES
        ) {
          pics.push({ type: "image_url", image_url: { url } });
          images++;
        }
      }
    }
    text = text.slice(0, MAX_TEXT_CHARS);
    if (!pics.length) {
      if (text.trim()) out.unshift({ role: "user", content: text });
      continue;
    }
    const parts: ApiPart[] = text.trim() ? [{ type: "text", text }, ...pics] : pics;
    out.unshift({ role: "user", content: parts });
  }
  return { messages: out, images };
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
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });

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

  let body: { messages?: unknown; system?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Inject persona dari client (maks 2000 karakter, cuma teks biasa)
  const persona =
    typeof body?.system === "string"
      ? body.system.slice(0, MAX_PERSONA_CHARS).trim()
      : "";
  const { messages, images } = sanitize(body?.messages);

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Invalid message." }, { status: 400 });
  }
  if (SYSTEM_PROMPT) messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  if (persona) messages.unshift({ role: "system", content: persona });

  const clientCtrl = new AbortController();
  req.signal.addEventListener("abort", () => clientCtrl.abort());

  const candidates = await buildCandidates(images > 0);
  if (!candidates.length) {
    return Response.json(
      {
        error: images
          ? "Images can't be read right now. Remove the image or try again later."
          : "The assistant is unavailable right now. Please try again later.",
      },
      { status: 503 }
    );
  }

  for (const model of candidates) {
    if (clientCtrl.signal.aborted) return new Response(null, { status: 499 });
    try {
      const { reader, held } = await tryModel(model, messages, clientCtrl.signal);
      lastGood = model;

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
        },
      });
    } catch (e) {
      if (clientCtrl.signal.aborted) return new Response(null, { status: 499 });
      console.warn(`[skip] ${model}: ${(e as Error).message}`);
      const status = (e as { status?: number }).status;
      const permanent = status === 401 || status === 403 || status === 404;
      cooling.set(model, Date.now() + (permanent ? BLOCKED_MS : COOLDOWN_MS));
      if (model === lastGood) lastGood = "";
    }
  }

  return Response.json(
    {
      error: "The assistant is busy right now. Please try again in a moment.",
    },
    { status: 503 }
  );
}
