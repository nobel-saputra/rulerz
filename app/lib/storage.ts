import { personaKeyFromPrompt, type PersonaKey } from "./personas";

export interface UiMsg {
  id: string;
  role: "user" | "bot" | "error";
  text: string;
  /** Gambar (data URL) yang dilampirkan user. */
  images?: string[];
  /** Jumlah gambar yang terpaksa dibuang karena localStorage penuh. */
  imagesLost?: number;
  model?: string;
  /** Model yang dipilih user saat pesan dikirim ("" = Auto). */
  wanted?: string;
  skipped?: number;
  streaming?: boolean;
}

export interface Session {
  id: string;
  title: string;
  /** true kalau judul diganti manual, jadi tidak ditimpa otomatis. */
  renamed?: boolean;
  at: number;
  msgs: UiMsg[];
  personaKey: PersonaKey;
  persona: string;
  lang: string;
  codeLang: string;
}

export interface Prefs {
  sound: boolean;
  model: string;
  customPersona: string;
}

export type Theme = "system" | "light" | "dark";

export const SESSIONS_KEY = "rulerz-sessions";
const UI_KEY = "rulerz-ui";
const PREFS_KEY = "rulerz-prefs";
export const THEME_KEY = "rulerz-theme";
const MAX_SESSIONS = 50;

export const DEFAULT_PREFS: Prefs = { sound: true, model: "", customPersona: "" };

export function nextId(prefix = "msg"): string {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

export function titleFrom(msgs: UiMsg[]): string {
  const first = msgs.find((m) => m.role === "user");
  const text = (first?.text || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 60);
  return first?.images?.length ? "Image chat" : "New chat";
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function cleanMsgs(msgs: unknown): UiMsg[] {
  if (!Array.isArray(msgs)) return [];
  return msgs
    .filter(
      (m): m is UiMsg =>
        !!m &&
        typeof m.id === "string" &&
        (m.role === "user" || m.role === "bot" || m.role === "error") &&
        typeof m.text === "string"
    )
    .map((m) => ({ ...m, streaming: false }));
}

interface LegacySession {
  id?: string;
  title?: string;
  at?: number;
  msgs?: unknown;
  persona?: string;
  lang?: string;
  codeLang?: string;
}

function fromLegacy(s: LegacySession): Session | null {
  const msgs = cleanMsgs(s.msgs);
  if (!msgs.length) return null;
  const persona = typeof s.persona === "string" ? s.persona : "";
  return {
    id: s.id || nextId("chat"),
    title: s.title || titleFrom(msgs),
    at: s.at || Date.now(),
    msgs,
    personaKey: personaKeyFromPrompt(persona),
    persona,
    lang: s.lang || "English (US)",
    codeLang: s.codeLang || "",
  };
}

export interface Stored {
  sessions: Session[];
  activeId: string | null;
  started: boolean;
}

/** State per tab: sesi aktif, layar, dan sesi aktif yang masih kosong. */
interface UiState {
  activeId: string | null;
  started: boolean;
  draft?: Session;
}

function normalize(list: unknown): Session[] {
  if (!Array.isArray(list)) return [];
  return (list as Session[])
    .filter((s) => s && typeof s.id === "string")
    .map((s) => ({
      ...s,
      title: typeof s.title === "string" ? s.title : "New chat",
      at: typeof s.at === "number" ? s.at : Date.now(),
      msgs: cleanMsgs(s.msgs),
      personaKey: s.personaKey ?? personaKeyFromPrompt(s.persona || ""),
      persona: typeof s.persona === "string" ? s.persona : "",
      lang: typeof s.lang === "string" && s.lang ? s.lang : "English (US)",
      codeLang: typeof s.codeLang === "string" ? s.codeLang : "",
    }));
}

/** Daftar sesi bersama (dipakai juga saat tab lain mengubahnya). */
export function readSessionList(): Session[] {
  return normalize(read<{ sessions?: unknown }>(SESSIONS_KEY)?.sessions);
}

function readUi(): UiState | null {
  try {
    // sessionStorage = per tab (tahan reload); localStorage = cadangan untuk tab baru.
    const raw = sessionStorage.getItem(UI_KEY) || localStorage.getItem(UI_KEY);
    return raw ? (JSON.parse(raw) as UiState) : null;
  } catch {
    return null;
  }
}

/** Muat sesi; data format lama (rulerz-chat + rulerz-history) digabungkan sekali. */
export function loadSessions(): Stored {
  const sessions = readSessionList();
  const ui = readUi();
  const draft = normalize(ui?.draft ? [ui.draft] : [])[0];
  if (draft && draft.id === ui?.activeId && !sessions.some((s) => s.id === draft.id)) {
    sessions.unshift(draft);
  }
  let activeId = sessions.some((s) => s.id === ui?.activeId) ? ui!.activeId : null;
  let started = !!ui?.started && !!activeId;

  const current = read<LegacySession & { started?: boolean }>("rulerz-chat");
  const old = read<LegacySession[]>("rulerz-history");
  if (!current && !old) return { sessions, activeId, started };

  const legacy: Session[] = [];
  if (current) {
    const s = fromLegacy({ ...current, id: nextId("chat"), at: Date.now() });
    if (s) {
      legacy.push(s);
      activeId = s.id;
      started = !!current.started;
    }
  }
  if (Array.isArray(old)) {
    for (const o of old) {
      const s = fromLegacy(o);
      if (s && !sessions.some((x) => x.id === s.id)) legacy.push(s);
    }
  }
  const stored = { sessions: [...legacy, ...sessions], activeId, started };
  if (saveSessions(stored)) {
    try {
      localStorage.removeItem("rulerz-chat");
      localStorage.removeItem("rulerz-history");
    } catch {}
  }
  return stored;
}

function stripImages(s: Session): Session {
  if (!s.msgs.some((m) => m.images?.length)) return s;
  return {
    ...s,
    msgs: s.msgs.map((m) =>
      m.images?.length
        ? { ...m, images: undefined, imagesLost: (m.imagesLost || 0) + m.images.length }
        : m
    ),
  };
}

/**
 * Simpan sesi. Hanya sesi berisi yang dibagi antar-tab; sesi aktif yang masih
 * kosong disimpan per tab. Kalau kuota localStorage penuh, gambar di sesi lain
 * dibuang dulu, lalu gambar di sesi aktif. Mengembalikan false kalau tetap gagal.
 */
export function saveSessions(data: Stored): boolean {
  const active = data.sessions.find((s) => s.id === data.activeId);
  const ui: UiState = {
    activeId: data.activeId,
    started: data.started,
    draft: active && !active.msgs.length ? active : undefined,
  };
  try {
    const raw = JSON.stringify(ui);
    sessionStorage.setItem(UI_KEY, raw);
    localStorage.setItem(UI_KEY, raw);
  } catch {}

  const sessions = data.sessions
    .filter((s) => s.msgs.length)
    .slice(0, MAX_SESSIONS)
    .map((s) => ({ ...s, msgs: s.msgs.map((m) => ({ ...m, streaming: undefined })) }));
  const attempts: Session[][] = [
    sessions,
    sessions.map((s) => (s.id === data.activeId ? s : stripImages(s))),
    sessions.map(stripImages),
  ];
  for (const list of attempts) {
    try {
      const raw = JSON.stringify({ v: 2, sessions: list });
      // Tidak menulis kalau sama, supaya tab lain tidak menerima event sia-sia.
      if (localStorage.getItem(SESSIONS_KEY) !== raw) localStorage.setItem(SESSIONS_KEY, raw);
      return true;
    } catch {}
  }
  return false;
}

export function loadPrefs(): Prefs {
  const p = read<Partial<Prefs>>(PREFS_KEY);
  return {
    sound: typeof p?.sound === "boolean" ? p.sound : DEFAULT_PREFS.sound,
    model: typeof p?.model === "string" ? p.model : DEFAULT_PREFS.model,
    customPersona:
      typeof p?.customPersona === "string" ? p.customPersona : DEFAULT_PREFS.customPersona,
  };
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {}
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
