export type PersonaKey =
  | ""
  | "teacher"
  | "programmer"
  | "girlfriend"
  | "boyfriend"
  | "friend"
  | "custom";

export const DEFAULT_PERSONA = "You are a helpful AI assistant.";

export const PERSONAS: { key: PersonaKey | "partner"; label: string; prompt: string }[] = [
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
  { key: "partner", label: "Partner", prompt: "" },
  {
    key: "friend",
    label: "Friend",
    prompt: "You are the user's close friend. Be casual, fun, honest, and supportive.",
  },
];

export const PARTNER_OPTIONS: { key: PersonaKey; label: string; prompt: string }[] = [
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

export function presetPrompt(key: PersonaKey): string {
  return [...PERSONAS, ...PARTNER_OPTIONS].find((p) => p.key === key)?.prompt || "";
}

/** Cari key persona dari teks prompt (untuk data lama yang belum punya key). */
export function personaKeyFromPrompt(prompt: string): PersonaKey {
  if (!prompt) return "";
  const hit = [...PERSONAS, ...PARTNER_OPTIONS].find((p) => p.prompt && p.prompt === prompt);
  return hit ? (hit.key as PersonaKey) : "custom";
}

export function personaLabel(key: PersonaKey): string {
  if (!key) return "Assistant";
  if (key === "custom") return "Custom";
  return [...PERSONAS, ...PARTNER_OPTIONS].find((p) => p.key === key)?.label || "Assistant";
}

/** Bahasa jawaban + kode BCP-47 untuk input & output suara. */
export const LANGUAGES: { label: string; code: string }[] = [
  { label: "English (US)", code: "en-US" },
  { label: "English (UK)", code: "en-GB" },
  { label: "Indonesian", code: "id-ID" },
  { label: "Spanish", code: "es-ES" },
  { label: "French", code: "fr-FR" },
  { label: "German", code: "de-DE" },
  { label: "Japanese", code: "ja-JP" },
  { label: "Mandarin", code: "zh-CN" },
  { label: "Korean", code: "ko-KR" },
  { label: "Arabic", code: "ar-SA" },
];

export function langCode(label: string): string {
  return LANGUAGES.find((l) => l.label === label)?.code || "en-US";
}

export const CODING_LANGUAGES = [
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

export const SUGGESTIONS: Record<PersonaKey, string[]> = {
  "": [
    "Summarize the key ideas of a book I like",
    "Help me plan a productive week",
    "Explain how the internet works in simple terms",
    "Give me 5 creative weekend ideas",
  ],
  teacher: [
    "Explain photosynthesis step by step",
    "Teach me the basics of algebra",
    "Quiz me on world capitals",
    "How do I study more effectively?",
  ],
  programmer: [
    "Explain async/await with an example",
    "Review this function for bugs",
    "What's the difference between SQL and NoSQL?",
    "Write a function that reverses a string",
  ],
  girlfriend: [
    "How was your day?",
    "I had a long day, cheer me up",
    "Let's plan a cute date",
    "Tell me something sweet",
  ],
  boyfriend: [
    "How was your day?",
    "I had a long day, cheer me up",
    "Let's plan a cute date",
    "Tell me something sweet",
  ],
  friend: [
    "I'm bored, entertain me",
    "Recommend a movie for tonight",
    "Help me reply to this awkward text",
    "Tell me a fun fact",
  ],
  custom: [
    "Introduce yourself",
    "What can you help me with?",
    "Surprise me",
    "Ask me a question",
  ],
};

export function buildSystemPrompt(s: {
  personaKey: PersonaKey;
  persona: string;
  lang: string;
  codeLang: string;
}): string {
  let out = s.persona || DEFAULT_PERSONA;
  out += ` Always respond in ${s.lang}, unless the user explicitly asks you to use another language.`;
  if (s.personaKey === "programmer") {
    out += s.codeLang
      ? ` The user's preferred programming language is ${s.codeLang}. When they ask for code without specifying a language and this is the first coding request, briefly confirm that this is the language they want; for later requests just answer directly.`
      : " You are strong at programming. When the user asks for code (e.g. 'write hello world') and this is the first coding request in the conversation, ALWAYS first ask which programming language they want to use instead of writing code right away — but only for that first coding request. After they answer, remember it and don't keep asking.";
  }
  return out;
}
