"use client";

import { useState } from "react";
import {
  CODING_LANGUAGES,
  LANGUAGES,
  PARTNER_OPTIONS,
  PERSONAS,
  presetPrompt,
  type PersonaKey,
} from "../lib/personas";
import { CUSTOM_PERSONA_CHARS } from "../lib/shared";

export interface ChatSettings {
  personaKey: PersonaKey;
  persona: string;
  lang: string;
  codeLang: string;
}

interface Props {
  initial: ChatSettings;
  customPersona: string;
  onCustomPersona: (text: string) => void;
  onStart: (s: ChatSettings) => void;
  onOpenHistory: () => void;
}

const chip = (on: boolean) =>
  `rounded-xl border font-semibold transition ${
    on
      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
      : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] hover:border-[var(--accent)]"
  }`;

export default function SetupScreen(p: Props) {
  const [key, setKey] = useState<PersonaKey>(p.initial.personaKey);
  const [partnerOpen, setPartnerOpen] = useState(
    p.initial.personaKey === "girlfriend" || p.initial.personaKey === "boyfriend"
  );
  const [lang, setLang] = useState(p.initial.lang);
  const [codeLang, setCodeLang] = useState(p.initial.codeLang);

  const custom = p.customPersona;
  const ready = key === "custom" ? !!custom.trim() : !!key;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8 text-center sm:px-6">
      <h1 className="font-[var(--display)] text-3xl font-bold tracking-tight sm:text-4xl">Rulerz</h1>
      <p className="max-w-[46ch] text-[var(--muted)]">
        Your AI assistant. Pick a personality and a response language, then start chatting.
      </p>

      <div className="grid w-full max-w-[420px] grid-cols-2 gap-3">
        {PERSONAS.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={x.key === "partner" ? partnerOpen : key === x.key}
            onClick={() => {
              if (x.key === "partner") {
                setPartnerOpen(true);
                if (key !== "girlfriend" && key !== "boyfriend") setKey("");
              } else {
                setPartnerOpen(false);
                setKey(x.key as PersonaKey);
              }
            }}
            className={`${chip(x.key === "partner" ? partnerOpen : key === x.key)} px-4 py-3`}
          >
            {x.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={key === "custom"}
          onClick={() => {
            setPartnerOpen(false);
            setKey("custom");
          }}
          className={`${chip(key === "custom")} col-span-2 px-4 py-3`}
        >
          Custom
        </button>
      </div>

      {partnerOpen && (
        <div className="pop-in grid w-full max-w-[420px] grid-cols-2 gap-3">
          {PARTNER_OPTIONS.map((x) => (
            <button
              key={x.key}
              type="button"
              aria-pressed={key === x.key}
              onClick={() => setKey(x.key)}
              className={`${chip(key === x.key)} px-4 py-3`}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}

      {key === "custom" && (
        <div className="pop-in w-full max-w-[420px] text-left">
          <label htmlFor="custom-persona" className="mb-1 block text-sm font-semibold text-[var(--muted)]">
            Describe your assistant
          </label>
          <textarea
            id="custom-persona"
            rows={4}
            maxLength={CUSTOM_PERSONA_CHARS}
            value={custom}
            onChange={(e) => p.onCustomPersona(e.target.value)}
            placeholder="e.g. You are a witty chef who explains recipes simply and always suggests a cheaper ingredient swap."
            className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-[var(--ink)]"
          />
          <div className="text-right text-xs text-[var(--muted)]">
            {custom.length}/{CUSTOM_PERSONA_CHARS}
          </div>
        </div>
      )}

      <p className="mt-1 w-full max-w-[420px] text-left text-sm font-semibold text-[var(--muted)]">
        Response language
      </p>
      <div className="grid w-full max-w-[420px] grid-cols-2 gap-2 sm:grid-cols-3">
        {LANGUAGES.map((l) => (
          <button
            key={l.label}
            type="button"
            aria-pressed={lang === l.label}
            onClick={() => setLang(l.label)}
            className={`${chip(lang === l.label)} px-3 py-2 text-sm`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {key === "programmer" && (
        <>
          <p className="mt-1 w-full max-w-[420px] text-left text-sm font-semibold text-[var(--muted)]">
            Coding language (optional)
          </p>
          <div className="grid w-full max-w-[420px] grid-cols-2 gap-2 sm:grid-cols-3">
            {CODING_LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={codeLang === l}
                onClick={() => setCodeLang(codeLang === l ? "" : l)}
                className={`${chip(codeLang === l)} px-3 py-2 text-sm`}
              >
                {l}
              </button>
            ))}
          </div>
          <input
            value={CODING_LANGUAGES.includes(codeLang) ? "" : codeLang}
            onChange={(e) => setCodeLang(e.target.value)}
            placeholder="Or type one, e.g. Ruby, Swift..."
            aria-label="Other coding language"
            className="w-full max-w-[420px] rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-[var(--ink)]"
          />
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => p.onStart({ personaKey: "", persona: "", lang, codeLang: "" })}
          className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-6 py-3 font-semibold text-[var(--ink)]"
        >
          Skip
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            p.onStart({
              personaKey: key,
              persona: key === "custom" ? custom.trim() : presetPrompt(key),
              lang,
              codeLang: key === "programmer" ? codeLang.trim() : "",
            })
          }
          className="pop-in rounded-xl bg-[var(--accent)] px-8 py-3 font-semibold text-[var(--accent-ink)] disabled:opacity-50"
        >
          Chat Now!
        </button>
      </div>

      <button type="button" onClick={p.onOpenHistory} className="ghost">
        History
      </button>

      <footer className="mt-8 w-full max-w-[420px] border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
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
  );
}
