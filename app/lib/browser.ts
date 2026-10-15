import { CONTEXT_LIMIT, MAX_IMAGES, type ApiMessage, type ApiPart } from "./shared";
import { personaLabel } from "./personas";
import type { Session, UiMsg } from "./storage";

/* ---------- suara "pluk" ---------- */
let audioCtx: AudioContext | null = null;
// Suara "pluk/tak" sederhana ala WhatsApp, tanpa file audio.
export function playPluk(pitch = 600) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.5, t + 0.09);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {}
}

/* ---------- pesan untuk API ---------- */
/** Pesan yang ikut jadi konteks percakapan (bukan error / balasan kosong). */
export function isContextMsg(m: UiMsg): boolean {
  if (m.role === "user") return !!m.text.trim() || !!m.images?.length;
  return m.role === "bot" && !!m.text.trim();
}

export function toApiMessages(msgs: UiMsg[]): ApiMessage[] {
  const ctx = msgs.filter(isContextMsg).slice(-CONTEXT_LIMIT);
  let imagesLeft = MAX_IMAGES;
  const out: ApiMessage[] = [];
  // Dari yang terbaru, supaya gambar terbaru yang diprioritaskan.
  for (let i = ctx.length - 1; i >= 0; i--) {
    const m = ctx[i];
    if (m.role === "bot") {
      out.unshift({ role: "assistant", content: m.text });
      continue;
    }
    const pics = (m.images || []).slice(0, Math.max(0, imagesLeft));
    imagesLeft -= pics.length;
    const dropped = (m.images?.length || 0) - pics.length + (m.imagesLost || 0);
    const text = m.text + (dropped ? `${m.text ? "\n" : ""}[${dropped} earlier image(s) not shown]` : "");
    if (!pics.length) {
      out.unshift({ role: "user", content: text });
      continue;
    }
    const parts: ApiPart[] = pics.map((url) => ({ type: "image_url", image_url: { url } }));
    if (text.trim()) parts.unshift({ type: "text", text });
    out.unshift({ role: "user", content: parts });
  }
  return out;
}

/**
 * Id pesan pertama yang masih ikut terkirim saat user mengirim pesan berikutnya.
 * null kalau semua pesan masih muat dalam konteks.
 */
export function contextStartId(msgs: UiMsg[]): string | null {
  const ctx = msgs.filter(isContextMsg);
  const keep = CONTEXT_LIMIT - 1;
  return ctx.length > keep ? ctx[ctx.length - keep].id : null;
}

/* ---------- gambar ---------- */
const MAX_SIDE = 1280;

/** Perkecil gambar ke sisi maks 1280px lalu jadikan data URL JPEG. */
export async function imageToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    // Latar putih supaya PNG transparan tidak jadi hitam di JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- ekspor ---------- */
export function exportSession(s: Session, format: "md" | "txt") {
  const date = new Date(s.at).toLocaleString();
  const lines: string[] = [];
  if (format === "md") {
    lines.push(`# ${s.title}`, "", `_Rulerz · ${personaLabel(s.personaKey)} · ${s.lang} · ${date}_`, "");
  } else {
    lines.push(s.title, `Rulerz · ${personaLabel(s.personaKey)} · ${s.lang} · ${date}`, "");
  }
  for (const m of s.msgs) {
    if (m.role === "error") continue;
    const who = m.role === "user" ? "You" : "Rulerz";
    const pics = (m.images?.length || 0) + (m.imagesLost || 0);
    const body = (pics ? `[${pics} image(s)]\n` : "") + m.text;
    lines.push(format === "md" ? `**${who}:**\n\n${body}` : `${who}:\n${body}`, "");
    if (format === "md") lines.push("---", "");
  }
  const blob = new Blob([lines.join("\n")], {
    type: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const safe = s.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "chat";
  a.download = `rulerz-${safe}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- suara: text-to-speech ---------- */
export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Ubah markdown jadi teks biasa yang enak dibacakan. */
function plainForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, " (code block) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(text: string, lang: string, onEnd: () => void) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(plainForSpeech(text));
  u.lang = lang;
  const base = lang.split("-")[0];
  const voices = synth.getVoices();
  const voice =
    voices.find((v) => v.lang === lang) || voices.find((v) => v.lang.startsWith(base));
  if (voice) u.voice = voice;
  u.onend = onEnd;
  u.onerror = onEnd;
  synth.speak(u);
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/* ---------- suara: speech-to-text ---------- */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export function createRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}
