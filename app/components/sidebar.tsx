"use client";

import { useState } from "react";
import { personaLabel } from "../lib/personas";
import type { Session, Theme } from "../lib/storage";
import {
  BellIcon,
  BellOffIcon,
  DownloadIcon,
  MonitorIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  TrashIcon,
  XIcon,
} from "./icons";

interface Props {
  sessions: Session[];
  activeId: string | null;
  /** Sesi aktif sedang tampil di layar chat (bukan di menu awal). */
  inChat: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  /** Ada kalau tampil sebagai drawer (mobile / menu awal). */
  onClose?: () => void;
}

const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

function relDate(at: number): string {
  const d = new Date(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export default function Sidebar(p: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const q = query.trim().toLowerCase();
  const list = p.sessions
    .filter((s) => s.msgs.length)
    .filter(
      (s) =>
        !q ||
        s.title.toLowerCase().includes(q) ||
        s.msgs.some((m) => m.text.toLowerCase().includes(q))
    );

  function commitRename(id: string) {
    const t = draft.replace(/\s+/g, " ").trim();
    if (t) p.onRename(id, t.slice(0, 80));
    setEditing(null);
  }

  return (
    <div className="flex h-full w-full flex-col gap-3 bg-[var(--panel)] p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={p.onNew}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--accent-ink)]"
        >
          <PlusIcon /> New chat
        </button>
        {p.onClose && (
          <button type="button" className="icon-btn" aria-label="Close history" onClick={p.onClose}>
            <XIcon />
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--muted)]">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="w-full bg-transparent text-sm text-[var(--ink)] outline-none"
        />
      </label>

      <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1" aria-label="Chat history">
        {list.length === 0 && (
          <p className="px-2 py-4 text-sm text-[var(--muted)]">
            {q ? "No chats match your search." : "No saved chats yet."}
          </p>
        )}
        {list.map((s) => {
          const active = p.inChat && s.id === p.activeId;
          return (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-xl border py-2 pl-3 pr-1.5 ${
                active
                  ? "border-[var(--accent)] bg-[var(--bg)]"
                  : "border-transparent hover:border-[var(--line)] hover:bg-[var(--bg)]"
              }`}
            >
              {editing === s.id ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={80}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  aria-label="Chat title"
                  className="w-full rounded-md border border-[var(--accent)] bg-[var(--panel)] px-2 py-1 text-sm text-[var(--ink)]"
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => p.onSelect(s.id)}
                    aria-current={active ? "true" : undefined}
                  >
                    <div className="truncate text-sm font-semibold text-[var(--ink)]">{s.title}</div>
                    <div className="truncate text-xs text-[var(--muted)]">
                      {personaLabel(s.personaKey)} · {relDate(s.at)}
                    </div>
                  </button>
                  <div className="flex shrink-0 opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                    <button
                      type="button"
                      className="msg-action p-1.5"
                      aria-label={`Rename "${s.title}"`}
                      title="Rename"
                      onClick={() => {
                        setDraft(s.title);
                        setEditing(s.id);
                      }}
                    >
                      <PencilIcon width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      className="msg-action p-1.5"
                      aria-label={`Export "${s.title}"`}
                      title="Export"
                      onClick={() => p.onExport(s.id)}
                    >
                      <DownloadIcon width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      className="msg-action p-1.5 hover:text-[var(--danger)]"
                      aria-label={`Delete "${s.title}"`}
                      title="Delete"
                      onClick={() => p.onDelete(s.id)}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex gap-2 border-t border-[var(--line)] pt-3">
        <button
          type="button"
          className="ghost flex flex-1 items-center justify-center gap-2 whitespace-nowrap text-sm"
          onClick={() => p.onTheme(THEME_NEXT[p.theme])}
          title="Change theme"
        >
          {p.theme === "light" ? <SunIcon /> : p.theme === "dark" ? <MoonIcon /> : <MonitorIcon />}
          {THEME_LABEL[p.theme]}
        </button>
        <button
          type="button"
          className="ghost flex flex-1 items-center justify-center gap-2 whitespace-nowrap text-sm"
          onClick={() => p.onSound(!p.sound)}
          aria-pressed={p.sound}
          title={p.sound ? "Message sounds: on" : "Message sounds: off"}
          aria-label={p.sound ? "Message sounds on" : "Message sounds off"}
        >
          {p.sound ? <BellIcon /> : <BellOffIcon />}
          Sound
        </button>
      </div>
    </div>
  );
}
