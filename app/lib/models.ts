import type { ModelInfo } from "./shared";

const MODELS_TTL_MS = 10 * 60 * 1000;

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

interface ModelCache {
  at: number;
  free: ModelInfo[];
  byId: Map<string, ModelInfo>;
}

/* ---------- daftar model (cache 10 menit) ---------- */
let cache: ModelCache = { at: 0, free: [], byId: new Map() };

function toInfo(m: OpenRouterModel): ModelInfo {
  return {
    id: m.id,
    name: (m.name || m.id).replace(/\s*\(free\)\s*$/i, ""),
    vision: (m.architecture?.input_modalities || []).includes("image"),
    context: m.context_length || 0,
  };
}

/**
 * Semua model OpenRouter (byId) dan subset model gratis yang bisa
 * menerima & membalas teks (free), urut dari konteks terbesar.
 */
export async function getModels(): Promise<ModelCache> {
  if (cache.free.length && Date.now() - cache.at < MODELS_TTL_MS) return cache;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j: { data: OpenRouterModel[] } = await r.json();
    const byId = new Map(j.data.map((m) => [m.id, toInfo(m)] as const));
    const free = j.data
      .filter(
        (m) =>
          m.id.endsWith(":free") &&
          // Model pengklasifikasi (guard/safety) bukan model chat.
          !/(guard|content-safety)/i.test(m.id) &&
          (m.architecture?.input_modalities || ["text"]).includes("text") &&
          (m.architecture?.output_modalities || ["text"]).includes("text")
      )
      .map(toInfo)
      .sort((a, b) => b.context - a.context);
    if (free.length) cache = { at: Date.now(), free, byId };
  } catch (e) {
    console.error("Gagal ambil daftar model:", (e as Error).message);
  }
  return cache;
}
