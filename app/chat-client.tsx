"use client";

import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface UiMsg {
  id: string;
  role: "user" | "bot" | "error";
  text: string;
  model?: string;
  skipped?: number;
  streaming?: boolean;
}

let audioCtx: AudioContext | null = null;
// Suara "pluk/tak" sederhana ala WhatsApp, tanpa file audio.
function playPluk(pitch = 600) {
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

function nextId(): string {
  return "msg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

interface Session {
  id: string;
  title: string;
  at: number;
  msgs: UiMsg[];
  history: ChatMsg[];
  persona: string;
  lang: string;
  codeLang: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

// Render sederhana: blok kode ``` dan `kode` inline, sisanya teks biasa.
function render(text: string): string {
  const parts = text.split("```");
  return parts
    .map((p, i) => {
      if (i % 2 === 1) {
        const body = p.replace(/^[^\n]*\n/, "");
        return "<pre><code>" + esc(body.replace(/\n$/, "")) + "</code></pre>";
      }
      let out = esc(p)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
        .replace(/^#{1,3}\s+(.+)$/gm, "<strong>$1</strong>");
      return out;
    })
    .join("");
}

export default function ChatClient() {
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [persona, setPersona] = useState("");
  const [personaOpen, setPersonaOpen] = useState(false);
  const [lang, setLang] = useState("English (US)");
  const [codeLang, setCodeLang] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const historyRef = useRef<ChatMsg[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [msgs]);

  // Muat chat dari localStorage saat pertama dibuka
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rulerz-chat");
      if (saved) {
        const j = JSON.parse(saved);
        if (Array.isArray(j.msgs)) {
          setMsgs(j.msgs.map((m: UiMsg) => ({ ...m, streaming: false })));
        }
        if (Array.isArray(j.history)) historyRef.current = j.history;
        if (j.started) setStarted(true);
        if (typeof j.lang === "string" && j.lang) setLang(j.lang);
        if (typeof j.persona === "string") setPersona(j.persona);
        if (typeof j.codeLang === "string") setCodeLang(j.codeLang);
      }
      const hist = localStorage.getItem("rulerz-history");
      if (hist) {
        const arr = JSON.parse(hist);
        if (Array.isArray(arr)) setSessions(arr);
      }
    } catch {}
  }, []);

  // Simpan chat ke localStorage setiap berubah
  useEffect(() => {
    try {
      localStorage.setItem(
        "rulerz-chat",
        JSON.stringify({
          msgs,
          history: historyRef.current,
          started,
          lang,
          persona,
          codeLang,
        })
      );
    } catch {}
  }, [msgs, started, lang, persona, codeLang]);

  // Tambahkan tombol "Copy" di setiap blok kode
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector("[data-copy-btn]")) return;
      pre.style.position = "relative";
      const btn = document.createElement("button");
      btn.textContent = "Copy";
      btn.setAttribute("data-copy-btn", "true");
      btn.style.cssText =
        "position:absolute;top:6px;right:6px;font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;";
      btn.onclick = () => {
        const text = pre.querySelector("code")?.innerText || pre.innerText;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = "Copy"), 1500);
        });
      };
      pre.appendChild(btn);
    });
  }, [msgs]);

  const isProgrammer = persona.includes("expert programmer");

  async function ask(text: string) {
    playPluk(520); // sound when sending
    const userMsg: UiMsg = { id: nextId(), role: "user", text };
    const botMsg: UiMsg = { id: nextId(), role: "bot", text: "", streaming: true };
    setMsgs((m) => [...m, userMsg, botMsg]);
    historyRef.current = [...historyRef.current, { role: "user", content: text }];

    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);

    let answer = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyRef.current,
          system:
            (persona
              ? persona
              : "You are a helpful AI assistant.") +
            ` Always respond in ${lang}, unless the user explicitly asks you to use another language.` +
            (isProgrammer
              ? codeLang
                ? ` The user's preferred programming language is ${codeLang}. When they ask for code without specifying a language and this is the first coding request, briefly confirm that this is the language they want; for later requests just answer directly.`
                : " You are strong at programming. When the user asks for code (e.g. 'write hello world') and this is the first coding request in the conversation, ALWAYS first ask which programming language they want to use instead of writing code right away — but only for that first coding request. After they answer, remember it and don't keep asking."
              : ""),
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
      setMsgs((m) =>
        m.map((x) => (x.id === botMsg.id ? { ...x, model, skipped } : x))
      );

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
          try {
            const j = JSON.parse(data);
            if (j.error) throw new Error(j.error.message || "The model stopped mid-reply.");
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) {
              if (!answer) playPluk(880); // sound when the reply starts
              answer += delta;
              setMsgs((m) =>
                m.map((x) => (x.id === botMsg.id ? { ...x, text: answer } : x))
              );
            }
          } catch (e: any) {
            if (e.message && !(e instanceof SyntaxError)) throw e;
          }
        }
      }
      if (answer) {
        historyRef.current = [...historyRef.current, { role: "assistant", content: answer }];
      } else {
        setMsgs((m) =>
          m.map((x) => (x.id === botMsg.id ? { ...x, text: "(the model didn't send a reply)" } : x))
        );
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        if (answer) {
          historyRef.current = [...historyRef.current, { role: "assistant", content: answer }];
        } else {
          setMsgs((m) => m.filter((x) => x.id !== botMsg.id && x.id !== userMsg.id));
          historyRef.current = historyRef.current.slice(0, -1);
        }
      } else {
        if (!answer) historyRef.current = historyRef.current.slice(0, -1);
        setMsgs((m) =>
          m.map((x) =>
            x.id === botMsg.id ? { ...x, role: "error", text: e.message } : x
          )
        );
      }
    } finally {
      setMsgs((m) =>
        m.map((x) => (x.id === botMsg.id ? { ...x, streaming: false } : x))
      );
      controllerRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function submit() {
    if (controllerRef.current) {
      controllerRef.current.abort();
      return;
    }
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    ask(text);
  }

  const historyOverlay =
    showHistory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="pop-in w-full max-w-[480px] rounded-2xl bg-[var(--panel)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-[var(--display)] text-xl font-bold text-[var(--ink)]">
              Chat history
            </h2>
            {sessions.length === 0 ? (
              <p className="text-[var(--muted)]">No saved chats yet.</p>
            ) : (
              <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 py-3"
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => {
                        setMsgs(s.msgs.map((m) => ({ ...m, streaming: false })));
                        historyRef.current = s.history;
                        setPersona(s.persona);
                        setLang(s.lang);
                        setCodeLang(s.codeLang);
                        setStarted(true);
                        setShowHistory(false);
                        // pindahkan ke chat aktif: hapus dari history agar tidak dobel
                        const updated = sessions.filter((x) => x.id !== s.id);
                        setSessions(updated);
                        try {
                          localStorage.setItem(
                            "rulerz-history",
                            JSON.stringify(updated)
                          );
                        } catch {}
                      }}
                    >
                      <div className="truncate font-semibold text-[var(--ink)]">
                        {s.title}
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {new Date(s.at).toLocaleString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      className="ghost"
                      onClick={() => {
                        const updated = sessions.filter((x) => x.id !== s.id);
                        setSessions(updated);
                        try {
                          localStorage.setItem(
                            "rulerz-history",
                            JSON.stringify(updated)
                          );
                        } catch {}
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    );

  if (!started) {
    const personas = [
      {
        key: "teacher",
        label: "Teacher",
        prompt:
          "You are a patient and encouraging teacher. Explain concepts clearly, use simple examples, and help the user learn step by step.",
      },
      {
        key: "programmer",
        label: "Programmer",
        prompt:
          "You are an expert programmer. Give clear, practical coding help with examples, debug issues, and explain technical concepts concisely.",
      },
      {
        key: "partner",
        label: "Partner",
        prompt: "",
      },
      {
        key: "friend",
        label: "Friend",
        prompt:
          "You are the user's close friend. Be casual, fun, honest, and supportive.",
      },
    ];
    const partnerOptions = [
      {
        key: "girlfriend",
        label: "Girlfriend",
        prompt:
          "You are the user's caring girlfriend. Be warm, affectionate, supportive, and sweetly playful.",
      },
      {
        key: "boyfriend",
        label: "Boyfriend",
        prompt:
          "You are the user's caring boyfriend. Be warm, supportive, attentive, and playful in a sweet way.",
      },
    ];

    const languages = [
      "English (US)",
      "English (UK)",
      "Indonesian",
      "Spanish",
      "French",
      "German",
      "Japanese",
      "Mandarin",
      "Korean",
      "Arabic",
    ];

    const codingLanguages = [
      "TypeScript",
      "JavaScript",
      "Python",
      "Java",
      "C++",
      "C#",
      "Go",
      "Rust",
      "PHP",
      "Kotlin",
    ];

    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <h1 className="font-[var(--display)] text-4xl font-bold tracking-tight">Rulerz</h1>
        <p className="max-w-[46ch] text-[var(--muted)]">
          Your AI assistant. Pick a personality and a response language, then start chatting.
        </p>

        <div className="grid w-full max-w-[420px] grid-cols-2 gap-3">
          {personas.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                if (p.key === "partner") {
                  setPersonaOpen(true);
                  setPersona("");
                } else {
                  setPersonaOpen(false);
                  setPersona(p.prompt);
                }
              }}
              className={`rounded-xl border px-4 py-3 font-semibold transition ${
                (p.key === "partner" && personaOpen) || persona === p.prompt && p.prompt
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {personaOpen && (
          <div className="pop-in grid w-full max-w-[420px] grid-cols-2 gap-3">
            {partnerOptions.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPersona(p.prompt)}
                className={`rounded-xl border px-4 py-3 font-semibold transition ${
                  persona === p.prompt
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <p className="mt-1 w-full max-w-[420px] text-left text-sm font-semibold text-[var(--muted)]">
          Response language
        </p>
        <div className="grid w-full max-w-[420px] grid-cols-2 gap-2 sm:grid-cols-3">
          {languages.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                lang === l
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {isProgrammer && (
          <>
            <p className="mt-1 w-full max-w-[420px] text-left text-sm font-semibold text-[var(--muted)]">
              Coding language (optional)
            </p>
            <div className="grid w-full max-w-[420px] grid-cols-2 gap-2 sm:grid-cols-3">
              {codingLanguages.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setCodeLang(codeLang === l ? "" : l)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    codeLang === l
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <input
              value={codingLanguages.includes(codeLang) ? "" : codeLang}
              onChange={(e) => setCodeLang(e.target.value)}
              placeholder="Or type one, e.g. Ruby, Swift..."
              className="w-full max-w-[420px] rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-[var(--ink)]"
            />
          </>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPersona("");
              setPersonaOpen(false);
              setStarted(true);
            }}
            className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-6 py-3 font-semibold text-[var(--ink)]"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={!persona}
            onClick={() => setStarted(true)}
            className="pop-in rounded-xl bg-[var(--accent)] px-8 py-3 font-semibold text-[var(--accent-ink)] disabled:opacity-50"
          >
            Chat Now!
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="ghost"
        >
          History
        </button>

        {historyOverlay}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[760px] items-baseline justify-between gap-3 px-5 pb-3 pt-4">
        <h1
          className="cursor-pointer font-[var(--display)] text-[1.6rem] font-bold tracking-tight transition hover:opacity-70"
          onClick={() => {
            Swal.fire({
              title: "Hey, are you wanna stay?",
              text: "Your chat is saved, but leaving goes back to the main menu.",
              showCancelButton: true,
              confirmButtonText: "No, go to menu",
              cancelButtonText: "Yes, stay",
              reverseButtons: true,
              background: "var(--panel)",
              color: "var(--ink)",
              confirmButtonColor: "#c0392b",
              cancelButtonColor: "var(--accent)",
            }).then((result) => {
              if (result.isConfirmed) setStarted(false);
            });
          }}
          title="Back to the main menu"
        >
          Rulerz
          <span className="ml-2.5 font-[var(--body)] text-[0.85rem] font-normal text-[var(--muted)] max-sm:hidden">
            your AI assistant
          </span>
        </h1>
        <div className="flex gap-2">
        <button
          className="ghost"
          type="button"
          onClick={() => {
            setShowHistory(true);
          }}
        >
          History
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            controllerRef.current?.abort();
            // simpan chat sekarang ke history
            if (msgs.length > 0) {
              const firstUser = msgs.find((m) => m.role === "user");
              const session: Session = {
                id: nextId(),
                title: (firstUser?.text || "Untitled chat").slice(0, 60),
                at: Date.now(),
                msgs,
                history: historyRef.current,
                persona,
                lang,
                codeLang,
              };
              const updated = [session, ...sessions].slice(0, 30);
              setSessions(updated);
              try {
                localStorage.setItem("rulerz-history", JSON.stringify(updated));
              } catch {}
            }
            historyRef.current = [];
            setMsgs([]);
            try {
              localStorage.removeItem("rulerz-chat");
            } catch {}
            setStarted(true);
          }}
        >
          New chat
        </button>
        </div>
      </header>

      <main ref={scrollerRef} className="w-full flex-1 overflow-y-auto">
        <div ref={logRef} className="mx-auto flex max-w-[760px] flex-col gap-[22px] px-5 pb-6 pt-2" aria-live="polite">
          {msgs.length === 0 && (
            <div className="mt-[12vh] max-w-[46ch] text-[var(--muted)]">
              <strong className="mb-1.5 block font-[var(--display)] text-[1.25rem] text-[var(--ink)]">
                Start chatting.
              </strong>
              Ask anything. The answer will appear here.
            </div>
          )}

          {msgs.map((m) => {
            if (m.role === "user") {
              return (
                <div
                  key={m.id}
                  className="pop-in max-w-[85%] self-end whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-[var(--accent)] px-[14px] py-[10px] text-[var(--accent-ink)]"
                >
                  {m.text}
                </div>
              );
            }
            return (
              <div
                key={m.id}
                className={`pop-in-left border-l-[3px] pl-[14px] ${
                  m.role === "error" ? "border-[#c0392b] text-[#c0392b]" : "border-[var(--line)]"
                }`}
              >
                {m.role === "error" ? (
                  <div className="whitespace-pre-wrap">{m.text}</div>
                ) : (
                  <>
                    {m.text ? (
                      <div
                        className="select-text whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ __html: render(m.text) }}
                      />
                    ) : (
                      <div className="dots" />
                    )}
                    {m.streaming && m.text && <span className="dots" />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </main>

      <form
        className="mx-auto flex w-full max-w-[760px] items-end gap-2.5 px-5 pb-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Type a message, Enter to send"
          aria-label="Message"
          className="max-h-[180px] flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--panel)] px-[14px] py-[11px] text-[var(--ink)]"
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          id="send"
          type="submit"
          className={
            busy
              ? "rounded-xl bg-[var(--ink)] px-[18px] py-[11px] font-semibold text-[var(--bg)]"
              : "rounded-xl bg-[var(--accent)] px-[18px] py-[11px] font-semibold text-[var(--accent-ink)] disabled:opacity-50"
          }
        >
          {busy ? "Stop" : "Send"}
        </button>
      </form>

      {historyOverlay}
    </div>
  );
}
