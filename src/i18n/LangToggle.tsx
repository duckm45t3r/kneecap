import { LANG_LABELS, useT, type Lang } from "./index";

const LANGS: Lang[] = ["en", "zh", "ja"];

// EN / 中 / 日 segmented switch. Mirrors the ThemeToggle; used in Settings and
// the sidebar footer.
export function LangToggle() {
  const { lang, setLang } = useT();
  return (
    <div className="kn-lang-toggle" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={`kn-lang-btn ${lang === l ? "kn-lang-btn--on" : ""}`}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
