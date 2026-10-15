// Konstanta & tipe yang dipakai bersama oleh server (route) dan client.

/** Jumlah pesan terakhir yang dikirim ke model sebagai konteks. */
export const CONTEXT_LIMIT = 20;
/** Panjang maksimal teks per pesan. */
export const MAX_TEXT_CHARS = 8000;
/** Jumlah gambar maksimal dalam satu request (yang paling baru). */
export const MAX_IMAGES = 4;
/** Ukuran maksimal satu gambar dalam bentuk data URL (≈ 2 MB biner). */
export const MAX_IMAGE_CHARS = 2_800_000;
/** Panjang maksimal persona kustom yang ditulis user. */
export const CUSTOM_PERSONA_CHARS = 800;
/** Panjang maksimal system prompt dari client (persona + instruksi bahasa). */
export const MAX_PERSONA_CHARS = 2000;

export type ApiPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ApiMessage {
  role: "user" | "assistant";
  content: string | ApiPart[];
}

export interface ModelInfo {
  id: string;
  name: string;
  vision: boolean;
  context: number;
}

export const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
