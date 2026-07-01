import { useEffect, useState } from "react";
import { en, zh, ja, type MessageKey } from "./messages";

// W7 — tiny i18n store, same shape as theme.ts (module store + hook, no context
// provider needed). `useT()` returns a `t(key)` bound to the current language;
// changing the language notifies every mounted consumer.

export type Lang = "en" | "zh" | "ja";
export const LANG_KEY = "kneecap_lang";

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, zh, ja };

export const LANG_LABELS: Record<Lang, string> = { en: "EN", zh: "中", ja: "日" };

/** Persisted choice, else OS language (zh / ja, else en). Safe if storage blocked. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "zh" || saved === "ja") return saved;
  } catch {
    /* storage blocked — fall through to OS detection */
  }
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("zh")) return "zh";
  if (nav.startsWith("ja")) return "ja";
  return "en";
}

let current: Lang = detectLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/** Translate with the CURRENT language, falling back to EN then the raw key. */
export function translate(key: MessageKey): string {
  return DICTS[current][key] ?? DICTS.en[key] ?? key;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage blocked — runtime value still applies */
  }
  listeners.forEach((fn) => fn());
}

/**
 * i18n hook. Returns `t` (bound to the live language), the current `lang`, and a
 * setter. Re-renders every consumer on a language change.
 */
export function useT(): {
  t: (key: MessageKey) => string;
  lang: Lang;
  setLang: (l: Lang) => void;
} {
  const [lang, setLangState] = useState<Lang>(current);
  useEffect(() => {
    const sync = () => setLangState(current);
    listeners.add(sync);
    sync(); // catch a change between render and subscribe
    return () => {
      listeners.delete(sync);
    };
  }, []);
  const t = (key: MessageKey) => DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return { t, lang, setLang };
}
