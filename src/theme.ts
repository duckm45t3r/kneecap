import { useCallback, useEffect, useState } from "react";

/**
 * Ink / Paper theme. The whole UI is token-driven (src/vhs-tokens.css): :root is
 * the dark "ink" default and a [data-theme="paper"] block redefines the same role
 * tokens to their light values, so flipping the attribute on <html> repaints
 * every view with no per-component change.
 *
 *   ink   → dark  (default; no data-theme attribute)
 *   paper → light ([data-theme="paper"] on <html>)
 *
 * Persisted to localStorage under THEME_KEY. The saved theme is applied
 * synchronously in main.tsx BEFORE React renders (and ideally before first
 * paint) to avoid a flash-of-wrong-theme.
 */

export type Theme = "ink" | "paper";

export const THEME_KEY = "kneecap_theme";

/** Read the persisted theme, defaulting to "ink". Safe if storage is blocked. */
export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "paper" ? "paper" : "ink";
  } catch {
    return "ink";
  }
}

/** Reflect a theme onto <html>: set data-theme for paper, remove it for ink. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "paper") {
    root.setAttribute("data-theme", "paper");
  } else {
    root.removeAttribute("data-theme");
  }
}

/**
 * Apply the persisted theme as early as possible. Called once from main.tsx
 * before ReactDOM.render so the correct surface is in place at (or before) the
 * first paint — no flash. Returns the resolved theme so callers can seed state.
 */
export function initThemeBeforePaint(): Theme {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}

// ── Tiny shared store ───────────────────────────────────────────────
//
// Several toggles (Settings + sidebar footer) can be mounted at once. A module
// store keeps them all in sync on a change, and centralises the side effect
// (reflect <html> + persist), without needing a context/provider wrapper.

let current: Theme =
  document.documentElement.getAttribute("data-theme") === "paper"
    ? "paper"
    : readStoredTheme();

const listeners = new Set<() => void>();

/** Set the active theme, persist it, reflect it on <html>, and notify hooks. */
export function setTheme(theme: Theme): void {
  if (theme === current) return;
  current = theme;
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked — runtime attribute is still applied */
  }
  listeners.forEach((fn) => fn());
}

/**
 * Small theme hook. Reads from the shared store (seeded from the attribute set
 * in main.tsx, so it matches what's on screen) and re-renders every consumer
 * when the theme changes. Kept deliberately simple — the visual switch happens
 * entirely through the <html> attribute + CSS tokens.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(current);

  useEffect(() => {
    const sync = () => setThemeState(current);
    listeners.add(sync);
    sync(); // catch a change that landed between render and subscribe
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const toggleTheme = useCallback(
    () => setTheme(current === "ink" ? "paper" : "ink"),
    [],
  );

  return { theme, setTheme, toggleTheme };
}
