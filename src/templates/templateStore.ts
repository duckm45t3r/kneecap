import type { Block, BlockType, Template } from "./types";
import { STARTER_TEMPLATES } from "./starters";

// User-forked templates live in localStorage (interim store — moves to the
// Tauri filesystem when report/template persistence lands in the structural
// rebuild). Starters are read-only; editing one forks a custom copy.

const LS_KEY = "kneecap_custom_templates";

export function listCustomTemplates(): Template[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Template[]) : [];
  } catch {
    return [];
  }
}

function writeCustom(list: Template[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(list));
}

export function getAllTemplates(): Template[] {
  return [...STARTER_TEMPLATES, ...listCustomTemplates()];
}

export function getTemplate(id: string): Template | undefined {
  return getAllTemplates().find((t) => t.id === id);
}

export function isStarter(id: string): boolean {
  return STARTER_TEMPLATES.some((t) => t.id === id);
}

export function saveCustomTemplate(t: Template): void {
  const list = listCustomTemplates();
  const idx = list.findIndex((x) => x.id === t.id);
  if (idx >= 0) list[idx] = t;
  else list.push(t);
  writeCustom(list);
}

export function deleteCustomTemplate(id: string): void {
  writeCustom(listCustomTemplates().filter((t) => t.id !== id));
}

// ─── Factory helpers ──────────────────────────────────────────────────

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function duplicateTemplate(t: Template): Template {
  const clone: Template = JSON.parse(JSON.stringify(t));
  return { ...clone, id: uid("custom"), name: `${t.name} (copy)` };
}

export const BLOCK_TYPE_META: Record<BlockType, { label: string; icon: string }> = {
  cover: { label: "Cover", icon: "▭" },
  heading: { label: "Heading", icon: "H" },
  paragraph: { label: "Paragraph", icon: "¶" },
  bullets: { label: "Bullets", icon: "•" },
  metrics: { label: "Metric strip", icon: "▦" },
  chart: { label: "Chart", icon: "▮" },
  table: { label: "Table", icon: "▤" },
  scoreBox: { label: "Score box", icon: "★" },
  logo: { label: "Logo", icon: "◈" },
  divider: { label: "Divider", icon: "—" },
};

const DEFAULT_PROMPT: Partial<Record<BlockType, string>> = {
  cover: "Company name as the title, with a one-line subtitle.",
  heading: "A short section heading.",
  paragraph: "Write this section in 2–4 sentences from the source. No hype.",
  bullets: "3–4 bullets from the source.",
  metrics: "Pull 3–4 key numbers into short metrics (label + value).",
  chart: "Emit a bar chart of the key figures as a ```chart fenced block.",
  table: "A small markdown table of the relevant rows.",
  scoreBox: "An overall score out of 10 with a one-line reason.",
};

export function newBlock(type: BlockType): Block {
  const isStatic = type === "logo" || type === "divider";
  return {
    id: uid("blk"),
    type,
    label: BLOCK_TYPE_META[type].label,
    width: "full",
    content: isStatic
      ? { mode: "static", text: type === "logo" ? "Firm logo" : "" }
      : { mode: "generated", prompt: DEFAULT_PROMPT[type] ?? "" },
  };
}
