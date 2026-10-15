"use client";

import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import Swal from "sweetalert2";
import { Markdown } from "./components/markdown";
import Sidebar from "./components/sidebar";
import SetupScreen, { type ChatSettings } from "./components/setup-screen";
import {
  ClipIcon,
  CopyIcon,
  MenuIcon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SpeakerIcon,
  StopIcon,
  XIcon,
} from "./components/icons";
import {
  contextStartId,
  createRecognition,
  exportSession,
  imageToDataUrl,
  playPluk,
  speak,
  stopSpeaking,
  toApiMessages,
  ttsSupported,
  type Recognition,
} from "./lib/browser";
import { buildSystemPrompt, langCode, personaLabel, SUGGESTIONS } from "./lib/personas";
import { CONTEXT_LIMIT, MAX_IMAGE_CHARS, MAX_IMAGES, type ModelInfo } from "./lib/shared";
import {
  applyTheme,
  loadPrefs,
  loadSessions,
  loadTheme,
  nextId,
  savePrefs,
  readSessionList,
  saveSessions,
  SESSIONS_KEY,
  titleFrom,
  type Prefs,
  type Session,
  type Theme,
  type UiMsg,
} from "./lib/storage";

const DEFAULT_SETTINGS: ChatSettings = {
  personaKey: "",
  persona: "",
  lang: "English (US)",
  codeLang: "",
};

const swal = Swal.mixin({
  // Default-nya memaksa html/body height:auto, yang merusak layout tinggi penuh.
  heightAuto: false,
  background: "var(--panel)",
  color: "var(--ink)",
  confirmButtonColor: "var(--accent)",
  cancelButtonColor: "var(--muted)",
  reverseButtons: true,
});

function toast(title: string, icon: "error" | "warning" | "info" = "error") {
  swal.fire({ toast: true, position: "top", icon, title, timer: 3500, showConfirmButton: false });
}

function newSession(s: ChatSettings): Session {
  return { id: nextId("chat"), title: "New chat", at: Date.now(), msgs: [], ...s };
}

function settingsOf(s: Session | null | undefined): ChatSettings {
  if (!s) return DEFAULT_SETTINGS;
  return { personaKey: s.personaKey, persona: s.persona, lang: s.lang, codeLang: s.codeLang };
}

/** Index pesan user terakhir sebelum (atau di) posisi idx. */
function userIndexBefore(msgs: UiMsg[], idx: number): number {
  for (let i = idx; i >= 0; i--) if (msgs[i].role === "user") return i;
  return -1;
}

export default function ChatClient() {
  const [boot] = useState(() => ({
    stored: loadSessions(),
    prefs: loadPrefs(),
    theme: loadTheme(),
  }));
  const [sessions, setSessions] = useState<Session[]>(boot.stored.sessions);
  const [activeId, setActiveId] = useState<string | null>(boot.stored.activeId);
  const [started, setStarted] = useState(boot.stored.started);
  const [prefs, setPrefs] = useState<Prefs>(boot.prefs);
  const [theme, setTheme] = useState<Theme>(boot.theme);
  const [models, setModels] = useState<ModelInfo[] | null>(null);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [canTalk] = useState(() => !!createRecognition());
  const [canSpeak] = useState(() => ttsSupported());

  const controllerRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<"user" | "switch">("user");
  const scrollerRef = useRef<HTMLElement | null>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const latestRef = useRef({ sessions, activeId, started, streamingId: null as string | null });
  const warnedFullRef = useRef(false);

  const active = sessions.find((s) => s.id === activeId) || null;
  const msgs = active?.msgs || [];
  const busy = streamingId !== null;
  const inChat = started && !!active;

  useEffect(() => {
    latestRef.current = { sessions, activeId, started, streamingId };
  });

  /* ---------- simpan ke localStorage (debounce) ---------- */
  useEffect(() => {
    const t = setTimeout(() => {
      if (!saveSessions({ sessions, activeId, started }) && !warnedFullRef.current) {
        warnedFullRef.current = true;
        toast("Browser storage is full. Delete some old chats so new ones can be saved.", "warning");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [sessions, activeId, started]);

  useEffect(() => {
    const flush = () => saveSessions(latestRef.current);
    // Tab lain mengubah riwayat: ambil versinya, tapi pertahankan sesi aktif
    // yang masih kosong dan sesi yang sedang streaming di tab ini.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSIONS_KEY) return;
      const incoming = readSessionList();
      const { activeId: aid, streamingId: sid } = latestRef.current;
      setSessions((local) => {
        const keep = local.filter(
          (s) =>
            s.id === sid ||
            (s.id === aid && !s.msgs.length && !incoming.some((x) => x.id === s.id))
        );
        return [...keep, ...incoming.filter((x) => !keep.some((k) => k.id === x.id))];
      });
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /* ---------- daftar model gratis ---------- */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((r) => r.json())
      .then((j: { models?: ModelInfo[] }) => {
        if (!cancelled) setModels(Array.isArray(j.models) ? j.models : []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Model pilihan yang sudah tidak ada di daftar dianggap "Auto".
  const chosenModel =
    prefs.model && models && !models.some((m) => m.id === prefs.model) ? "" : prefs.model;

  /* ---------- auto-scroll hanya kalau user ada di bawah ---------- */
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [active?.msgs, started, activeId]);

  // Area chat mengecil (lampiran muncul, input membesar): tetap menempel di bawah.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [inChat]);

  /* ---------- tinggi textarea mengikuti isi ---------- */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight tidak termasuk border, jadi tambahkan selisihnya.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = Math.min(el.scrollHeight + border, 180) + "px";
  }, [input, started]);

  // Escape menutup drawer & pratinjau gambar.
  useEffect(() => {
    if (!drawer && !lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawer(false);
      setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, lightbox]);

  // Hentikan suara & mic saat komponen dilepas.
  useEffect(
    () => () => {
      stopSpeaking();
      recRef.current?.stop();
    },
    []
  );

  /* ---------- helper state ---------- */
  function patchSession(id: string, fn: (s: Session) => Session) {
    setSessions((list) => list.map((s) => (s.id === id ? fn(s) : s)));
  }

  function setMsgsOf(id: string, fn: (m: UiMsg[]) => UiMsg[]) {
    patchSession(id, (s) => {
      const next = fn(s.msgs);
      return { ...s, msgs: next, title: s.renamed ? s.title : titleFrom(next) };
    });
  }

  function updateMsg(sid: string, mid: string, patch: Partial<UiMsg>) {
    setMsgsOf(sid, (m) => m.map((x) => (x.id === mid ? { ...x, ...patch } : x)));
  }

  function stopStreaming(reason: "user" | "switch") {
    if (!controllerRef.current) return;
    abortReasonRef.current = reason;
    controllerRef.current.abort();
  }

  function focusInput() {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }

  /* ---------- kirim & stream jawaban ---------- */
  async function run(session: Session, base: UiMsg[], fresh?: UiMsg) {
    const sid = session.id;
    const botMsg: UiMsg = {
      id: nextId(),
      role: "bot",
      text: "",
      wanted: chosenModel || undefined,
      streaming: true,
    };
    patchSession(sid, (s) => ({ ...s, at: Date.now() }));
    setMsgsOf(sid, () => [...base, botMsg]);
    stickRef.current = true;
    stopSpeaking();
    setSpeakingId(null);
    if (prefs.sound) playPluk(520); // sound when sending

    const controller = new AbortController();
    controllerRef.current = controller;
    abortReasonRef.current = "user";
    setStreamingId(sid);

    let answer = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toApiMessages(base),
          system: buildSystemPrompt(session),
          model: chosenModel || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = "Something went wrong.";
        try {
          msg = (await res.json()).error || msg;
        } catch {}
        throw new Error(msg);
      }

      const model = res.headers.get("X-Model-Used") || "";
      const skipped = Number(res.headers.get("X-Models-Skipped") || 0);
      updateMsg(sid, botMsg.id, { model, skipped });

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let j: { error?: { message?: string }; choices?: { delta?: { content?: string } }[] };
          try {
            j = JSON.parse(data);
          } catch {
            continue;
          }
          if (j.error) throw new Error(j.error.message || "The model stopped mid-reply.");
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) {
            if (!answer && prefs.sound) playPluk(880); // sound when the reply starts
            answer += delta;
            updateMsg(sid, botMsg.id, { text: answer });
          }
        }
      }
      if (!answer) updateMsg(sid, botMsg.id, { text: "(the model didn't send a reply)" });
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        if (!answer) {
          const restore = fresh && abortReasonRef.current === "user";
          setMsgsOf(sid, (m) =>
            m.filter((x) => x.id !== botMsg.id && !(restore && x.id === fresh.id))
          );
          if (restore) {
            // Kembalikan pesan ke kotak input supaya bisa diedit.
            setInput((cur) => cur || fresh.text);
            setAttachments((cur) => (cur.length ? cur : fresh.images || []));
          }
        }
      } else {
        const text =
          err instanceof TypeError ? "Network error. Check your connection and try again." : err.message;
        if (answer) {
          // Simpan jawaban yang sudah masuk, tampilkan error di bawahnya.
          setMsgsOf(sid, (m) => [
            ...m.map((x) => (x.id === botMsg.id ? { ...x, streaming: false } : x)),
            { id: nextId(), role: "error", text: "The reply was cut off: " + text },
          ]);
        } else {
          updateMsg(sid, botMsg.id, { role: "error", text });
        }
      }
    } finally {
      updateMsg(sid, botMsg.id, { streaming: false });
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setStreamingId(null);
      }
      focusInput();
    }
  }

  function ask(text: string, images: string[] = []) {
    if (!active || busy) return;
    const userMsg: UiMsg = {
      id: nextId(),
      role: "user",
      text,
      images: images.length ? images : undefined,
    };
    run(active, [...active.msgs, userMsg], userMsg);
  }

  function submit() {
    if (busy) {
      stopStreaming("user");
      return;
    }
    const text = input.trim();
    if (!text && !attachments.length) return;
    recRef.current?.stop();
    setInput("");
    setAttachments([]);
    ask(text, attachments);
  }

  function retry(errorId: string) {
    if (!active || busy) return;
    const idx = active.msgs.findIndex((m) => m.id === errorId);
    const u = userIndexBefore(active.msgs, idx);
    if (u < 0) return;
    run(active, active.msgs.slice(0, u + 1));
  }

  function regenerate(botId: string) {
    retry(botId);
  }

  function saveEdit() {
    if (!active || busy || !editing) return;
    const idx = active.msgs.findIndex((m) => m.id === editing.id);
    const old = active.msgs[idx];
    const text = editing.text.trim();
    setEditing(null);
    if (!old || (!text && !old.images?.length) || text === old.text) return;
    run(active, [...active.msgs.slice(0, idx), { ...old, text }]);
  }

  function copy(m: UiMsg) {
    navigator.clipboard.writeText(m.text).then(() => {
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1500);
    });
  }

  function toggleSpeak(m: UiMsg) {
    if (speakingId === m.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    setSpeakingId(m.id);
    speak(m.text, langCode(active?.lang || ""), () =>
      setSpeakingId((c) => (c === m.id ? null : c))
    );
  }

  /* ---------- sesi ---------- */
  function leaveCurrent() {
    stopStreaming("switch");
    stopSpeaking();
    setSpeakingId(null);
    setEditing(null);
    recRef.current?.stop();
    stickRef.current = true;
  }

  function startChat(s: ChatSettings) {
    leaveCurrent();
    const fresh = newSession(s);
    // Sesi kosong yang sedang aktif diganti, bukan ditumpuk.
    setSessions((list) => [fresh, ...list.filter((x) => x.msgs.length || x.id !== activeId)]);
    setActiveId(fresh.id);
    setStarted(true);
    setDrawer(false);
    focusInput();
  }

  function newChat() {
    if (active && !active.msgs.length && started) {
      setDrawer(false);
      focusInput();
      return;
    }
    startChat(settingsOf(active || sessions[0]));
  }

  function selectSession(id: string) {
    if (id !== activeId) leaveCurrent();
    setActiveId(id);
    setStarted(true);
    setDrawer(false);
  }

  function renameSession(id: string, title: string) {
    patchSession(id, (s) => ({ ...s, title, renamed: true }));
  }

  async function deleteSession(id: string) {
    const r = await swal.fire({
      title: "Delete this chat?",
      text: "This can't be undone.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "var(--danger)",
    });
    if (!r.isConfirmed) return;
    if (id === activeId) {
      leaveCurrent();
      if (started) {
        const fresh = newSession(settingsOf(active));
        setSessions((list) => [fresh, ...list.filter((x) => x.id !== id)]);
        setActiveId(fresh.id);
        return;
      }
      setActiveId(null);
    }
    setSessions((list) => list.filter((x) => x.id !== id));
  }

  async function exportChat(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    const r = await swal.fire({
      title: "Export chat",
      text: "Choose a file format.",
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: "Markdown (.md)",
      denyButtonText: "Plain text (.txt)",
      denyButtonColor: "var(--accent)",
    });
    if (r.isConfirmed) exportSession(s, "md");
    else if (r.isDenied) exportSession(s, "txt");
  }

  async function goToMenu() {
    const r = await swal.fire({
      title: "Back to the main menu?",
      text: "This chat is saved in History, so you can come back to it anytime.",
      showCancelButton: true,
      confirmButtonText: "Go to menu",
      cancelButtonText: "Stay",
    });
    if (r.isConfirmed) {
      leaveCurrent();
      setStarted(false);
    }
  }

  /* ---------- preferensi ---------- */
  function updatePrefs(patch: Partial<Prefs>) {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }

  function changeTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
  }

  /* ---------- lampiran gambar ---------- */
  async function addFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) {
      if (files.length) toast("Only image files can be attached.");
      return;
    }
    const room = MAX_IMAGES - attachments.length;
    if (room <= 0) {
      toast(`You can attach up to ${MAX_IMAGES} images.`, "warning");
      return;
    }
    if (imgs.length > room) toast(`Only ${room} more image(s) can be attached.`, "warning");
    const out: string[] = [];
    for (const f of imgs.slice(0, room)) {
      try {
        const url = await imageToDataUrl(f);
        if (url.length > MAX_IMAGE_CHARS) toast(`"${f.name}" is too large.`);
        else out.push(url);
      } catch {
        toast(`Couldn't read "${f.name}".`);
      }
    }
    if (out.length) setAttachments((a) => [...a, ...out].slice(0, MAX_IMAGES));
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  /* ---------- input suara ---------- */
  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = createRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.lang = langCode(active?.lang || "");
    rec.continuous = true;
    rec.interimResults = true;
    const base = input ? input.replace(/\s*$/, " ") : "";
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput(base + finalText + interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast("Microphone access was blocked. Allow it in your browser settings.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        toast("Voice input stopped: " + e.error);
      }
    };
    rec.onend = () => {
      setListening(false);
      if (recRef.current === rec) recRef.current = null;
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  /* ---------- tampilan ---------- */
  const sorted = [...sessions].sort((a, b) => b.at - a.at);
  const sidebarProps = {
    sessions: sorted,
    activeId,
    inChat: started,
    onSelect: selectSession,
    onNew: newChat,
    onRename: renameSession,
    onDelete: deleteSession,
    onExport: exportChat,
    theme,
    onTheme: changeTheme,
    sound: prefs.sound,
    onSound: (on: boolean) => updatePrefs({ sound: on }),
  };

  const drawerEl = drawer && (
    <div
      className={`fixed inset-0 z-50 flex bg-black/40 ${inChat ? "lg:hidden" : ""}`}
      onClick={() => setDrawer(false)}
      role="presentation"
    >
      <div
        className="slide-in h-full w-[300px] max-w-[85vw] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Chat history"
      >
        <Sidebar {...sidebarProps} onClose={() => setDrawer(false)} />
      </div>
    </div>
  );

  if (!inChat || !active) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SetupScreen
          initial={settingsOf(active || sorted[0])}
          customPersona={prefs.customPersona}
          onCustomPersona={(t) => updatePrefs({ customPersona: t })}
          onStart={startChat}
          onOpenHistory={() => setDrawer(true)}
        />
        {drawerEl}
      </div>
    );
  }

  const ctxStart = contextStartId(msgs);
  const lastId = msgs[msgs.length - 1]?.id;
  const visionModels = models?.filter((m) => m.vision) || [];
  const chosenInfo = models?.find((m) => m.id === chosenModel);
  const modelName = (id: string) =>
    models?.find((m) => m.id === id)?.name || id.replace(/^[^/]+\//, "").replace(/:free$/, "");

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-[280px] shrink-0 border-r border-[var(--line)] lg:block">
        <Sidebar {...sidebarProps} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mx-auto flex w-full max-w-[760px] items-center gap-2 px-4 pb-3 pt-4 sm:px-5">
          <button
            type="button"
            className="icon-btn lg:hidden"
            aria-label="Open chat history"
            onClick={() => setDrawer(true)}
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            className="min-w-0 flex-1 text-left transition hover:opacity-70"
            onClick={goToMenu}
            title="Back to the main menu"
          >
            <span className="block font-[var(--display)] text-2xl font-bold leading-tight tracking-tight sm:text-[1.6rem]">
              Rulerz
            </span>
            <span className="block truncate text-xs text-[var(--muted)]">
              {personaLabel(active.personaKey)} · {active.lang}
              {active.codeLang ? ` · ${active.codeLang}` : ""}
            </span>
          </button>
          <select
            value={chosenModel}
            onChange={(e) => updatePrefs({ model: e.target.value })}
            aria-label="Model"
            title="Model (Auto picks the best available free model)"
            className="w-[130px] shrink-0 truncate rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--ink)] sm:w-[210px]"
          >
            <option value="">Auto</option>
            {models === null && <option disabled>Loading models…</option>}
            {models?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.vision ? " · images" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn shrink-0"
            onClick={newChat}
            aria-label="New chat"
            title="New chat"
          >
            <PlusIcon />
            <span className="ml-1.5 hidden text-sm sm:inline">New chat</span>
          </button>
        </header>

        <main
          ref={scrollerRef}
          className="min-h-0 w-full flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div
            className="mx-auto flex max-w-[760px] flex-col gap-[22px] px-4 pb-6 pt-2 sm:px-5"
            aria-live="polite"
          >
            {msgs.length === 0 && (
              <div className="mt-[8vh]">
                <strong className="mb-1.5 block font-[var(--display)] text-[1.25rem] text-[var(--ink)]">
                  Start chatting.
                </strong>
                <p className="mb-4 max-w-[46ch] text-[var(--muted)]">
                  Ask anything, or try one of these:
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(SUGGESTIONS[active.personaKey] || SUGGESTIONS[""]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="pop-in-left rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-left text-sm text-[var(--ink)] transition hover:border-[var(--accent)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m) => {
              const divider = m.id === ctxStart && (
                <div
                  className="flex items-center gap-3 text-xs text-[var(--muted)]"
                  role="note"
                >
                  <span className="h-px flex-1 bg-[var(--line)]" />
                  <span className="text-center">
                    Messages above are outside the model&apos;s memory (it sees the last{" "}
                    {CONTEXT_LIMIT})
                  </span>
                  <span className="h-px flex-1 bg-[var(--line)]" />
                </div>
              );

              if (m.role === "user") {
                const isEditing = editing?.id === m.id;
                return (
                  <Fragment key={m.id}>
                  {divider}
                  <div key={m.id} className="group flex flex-col items-end gap-1">
                    {isEditing ? (
                      <div className="w-full max-w-[92%] sm:max-w-[80%]">
                        <textarea
                          autoFocus
                          value={editing.text}
                          onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              saveEdit();
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                          rows={Math.min(8, editing.text.split("\n").length + 1)}
                          aria-label="Edit message"
                          className="w-full resize-y rounded-xl border border-[var(--accent)] bg-[var(--panel)] px-[14px] py-[10px] text-[var(--ink)]"
                        />
                        <div className="mt-1.5 flex justify-end gap-2">
                          <button type="button" className="ghost text-sm" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-ink)]"
                          >
                            Save &amp; send
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="pop-in max-w-[92%] break-words whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-[var(--accent)] px-[14px] py-[10px] text-[var(--accent-ink)] sm:max-w-[80%]">
                        {!!m.images?.length && (
                          <div className={`flex flex-wrap gap-1.5 ${m.text ? "mb-2" : ""}`}>
                            {m.images.map((src, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setLightbox(src)}
                                aria-label="View image"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- data URL lokal */}
                                <img
                                  src={src}
                                  alt=""
                                  className="h-24 w-24 rounded-lg object-cover sm:h-32 sm:w-32"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                        {!!m.imagesLost && (
                          <div className={`text-xs opacity-80 ${m.text ? "mb-1" : ""}`}>
                            [{m.imagesLost} image(s) not kept — browser storage was full]
                          </div>
                        )}
                        {m.text}
                      </div>
                    )}
                    {!isEditing && (
                      <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                        <button type="button" className="msg-action inline-flex items-center gap-1" onClick={() => copy(m)}>
                          <CopyIcon width={13} height={13} />
                          {copiedId === m.id ? "Copied!" : "Copy"}
                        </button>
                        <button
                          type="button"
                          className="msg-action inline-flex items-center gap-1"
                          disabled={busy}
                          onClick={() => setEditing({ id: m.id, text: m.text })}
                        >
                          <PencilIcon width={13} height={13} /> Edit
                        </button>
                      </div>
                    )}
                  </div>
                  </Fragment>
                );
              }

              if (m.role === "error") {
                return (
                  <Fragment key={m.id}>
                  {divider}
                  <div key={m.id} className="pop-in-left min-w-0 border-l-[3px] border-[var(--danger)] pl-[14px] text-[var(--danger)]">
                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    {m.id === lastId && !busy && (
                      <button
                        type="button"
                        onClick={() => retry(m.id)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-sm font-semibold text-[var(--ink)]"
                      >
                        <RefreshIcon width={14} height={14} /> Retry
                      </button>
                    )}
                  </div>
                  </Fragment>
                );
              }

              return (
                <Fragment key={m.id}>
                {divider}
                <div key={m.id} className="group pop-in-left min-w-0 border-l-[3px] border-[var(--line)] pl-[14px]">
                  {m.text ? <Markdown text={m.text} /> : <div className="dots" />}
                  {m.streaming && m.text && <span className="dots" />}
                  {!m.streaming && m.text && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <button type="button" className="msg-action inline-flex items-center gap-1" onClick={() => copy(m)}>
                        <CopyIcon width={13} height={13} />
                        {copiedId === m.id ? "Copied!" : "Copy"}
                      </button>
                      {canSpeak && (
                        <button
                          type="button"
                          className="msg-action inline-flex items-center gap-1"
                          onClick={() => toggleSpeak(m)}
                          aria-pressed={speakingId === m.id}
                        >
                          {speakingId === m.id ? (
                            <>
                              <StopIcon width={13} height={13} /> Stop
                            </>
                          ) : (
                            <>
                              <SpeakerIcon width={13} height={13} /> Listen
                            </>
                          )}
                        </button>
                      )}
                      {m.id === lastId && !busy && (
                        <button
                          type="button"
                          className="msg-action inline-flex items-center gap-1"
                          onClick={() => regenerate(m.id)}
                        >
                          <RefreshIcon width={13} height={13} /> Regenerate
                        </button>
                      )}
                      {m.model && (
                        <span className="ml-1 text-[0.72rem] text-[var(--muted)]" title={m.model}>
                          via {modelName(m.model)}
                          {m.wanted && m.wanted !== m.model
                            ? ` · ${modelName(m.wanted)} was unavailable`
                            : m.skipped
                              ? ` · ${m.skipped} busy model${m.skipped > 1 ? "s" : ""} skipped`
                              : ""}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                </Fragment>
              );
            })}
          </div>
        </main>

        <form
          className={`mx-auto w-full max-w-[760px] px-4 pb-2 pt-2 sm:px-5 ${
            dragOver ? "rounded-xl outline-2 outline-dashed outline-[var(--accent)]" : ""
          }`}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {attachments.length > 0 && (
            <div className="mb-2">
              <div className="flex flex-wrap gap-2">
                {attachments.map((src, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL lokal */}
                    <img
                      src={src}
                      alt={`Attachment ${i + 1}`}
                      className="h-16 w-16 rounded-lg border border-[var(--line)] object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove attachment ${i + 1}`}
                      onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--bg)]"
                    >
                      <XIcon width={12} height={12} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {models && visionModels.length === 0
                  ? "No free model can read images right now — sending may fail."
                  : chosenInfo && !chosenInfo.vision
                    ? "The selected model can't read images, so a model that can will answer instead."
                    : "A model that can read images will answer."}
              </p>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon-btn h-[46px] shrink-0"
              aria-label="Attach image"
              title="Attach image"
              disabled={attachments.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              <ClipIcon />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder={listening ? "Listening…" : "Type a message, Enter to send"}
              aria-label="Message"
              className="max-h-[180px] min-w-0 flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--panel)] px-[14px] py-[11px] text-[var(--ink)]"
              onChange={(e) => setInput(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {canTalk && (
              <button
                type="button"
                className={`icon-btn h-[46px] shrink-0 ${
                  listening ? "!border-[var(--danger)] !text-[var(--danger)]" : ""
                }`}
                aria-label={listening ? "Stop voice input" : "Voice input"}
                aria-pressed={listening}
                title={listening ? "Stop voice input" : "Voice input"}
                onClick={toggleMic}
              >
                {listening ? <StopIcon /> : <MicIcon />}
              </button>
            )}
            <button
              id="send"
              type="submit"
              disabled={!busy && !input.trim() && !attachments.length}
              className={
                busy
                  ? "h-[46px] shrink-0 rounded-xl bg-[var(--ink)] px-[18px] font-semibold text-[var(--bg)]"
                  : "h-[46px] shrink-0 rounded-xl bg-[var(--accent)] px-[18px] font-semibold text-[var(--accent-ink)] disabled:opacity-50"
              }
            >
              {busy ? "Stop" : "Send"}
            </button>
          </div>
        </form>

        <footer className="mx-auto w-full max-w-[760px] border-t border-[var(--line)] px-4 pb-5 pt-3 text-center text-xs text-[var(--muted)] sm:px-5">
          Made by{" "}
          <a
            href="https://github.com/nobel-saputra/rulerz"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--ink)] underline-offset-4 hover:underline"
          >
            nobelsaputra
          </a>
        </footer>
      </div>

      {drawerEl}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label="Image preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL lokal */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg" />
          <button
            type="button"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-black"
            aria-label="Close preview"
            onClick={() => setLightbox(null)}
          >
            <XIcon />
          </button>
        </div>
      )}
    </div>
  );
}
