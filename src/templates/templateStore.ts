import type {
  Block,
  BlockAccent,
  BlockContent,
  BlockFont,
  BlockSize,
  BlockStyle,
  BlockType,
  Template,
  TemplateKind,
  TemplateVariant,
} from "./types";
import { MAX_TEMPLATE_BLOCKS } from "./types";
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

// ─── Firm logo (app-level, shared across templates) ───────────────────
//
// Stored as a data URL so a single upload (PNG or SVG) follows the firm
// across every template and generated report. Always rendered via <img>,
// which neutralises any script embedded in an SVG.

const LOGO_KEY = "kneecap_firm_logo";

export type FirmLogo = { dataUrl: string; name: string };

export function getFirmLogo(): FirmLogo | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(LOGO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.dataUrl === "string" ? (parsed as FirmLogo) : null;
  } catch {
    return null;
  }
}

export function setFirmLogo(logo: FirmLogo): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(LOGO_KEY, JSON.stringify(logo));
}

export function clearFirmLogo(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(LOGO_KEY);
}

// Accepts PNG or SVG; returns a full data URL (with the data: prefix intact,
// unlike App's fileToBase64 which strips it for the PDF path).
const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_ACCEPT = "image/png,image/svg+xml,.png,.svg";

export function readLogoFile(file: File): Promise<FirmLogo> {
  return new Promise((resolve, reject) => {
    const okType =
      file.type === "image/png" ||
      file.type === "image/svg+xml" ||
      /\.(png|svg)$/i.test(file.name);
    if (!okType) {
      reject(new Error("Use a PNG or SVG file."));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      reject(new Error("Logo is too large — keep it under ~1 MB (SVG is ideal)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the file."));
        return;
      }
      resolve({ dataUrl: result, name: file.name });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
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

// ─── Format Learning — validate a model-inferred template ──────────────
//
// The `infer_templates` Rust command sends each example doc to the LLM and asks
// it to EMIT a kneecap Template as JSON (schema spelled out in the prompt). The
// model is not trustworthy about the schema, so we never `as Template` raw JSON
// — we walk it field by field, coercing/clamping every value into the real
// types and assigning ids ourselves. Anything we can't make valid throws, and
// the Format Learning UI skips just that one example.

const BLOCK_TYPES: readonly BlockType[] = [
  "cover",
  "heading",
  "paragraph",
  "bullets",
  "metrics",
  "chart",
  "table",
  "scoreBox",
  "logo",
  "divider",
];
const FONTS: readonly BlockFont[] = ["editorial", "sans", "mono"];
const ACCENTS: readonly BlockAccent[] = ["paper", "gold", "teal", "crimson"];
const SIZES: readonly BlockSize[] = ["sm", "md", "lg", "xl"];
const WEIGHTS = ["regular", "medium", "bold"] as const;
const ALIGNS = ["left", "center"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

function normaliseStyle(v: unknown): BlockStyle | undefined {
  if (!isRecord(v)) return undefined;
  const style: BlockStyle = {};
  const font = oneOf(v.font, FONTS);
  if (font) style.font = font;
  const size = oneOf(v.size, SIZES);
  if (size) style.size = size;
  const weight = oneOf(v.weight, WEIGHTS);
  if (weight) style.weight = weight;
  const align = oneOf(v.align, ALIGNS);
  if (align) style.align = align;
  const accent = oneOf(v.accent, ACCENTS);
  if (accent) style.accent = accent;
  return Object.keys(style).length > 0 ? style : undefined;
}

function normaliseContent(v: unknown, type: BlockType): BlockContent {
  if (isRecord(v)) {
    if (v.mode === "static") {
      return { mode: "static", text: asStr(v.text) ?? "" };
    }
    if (v.mode === "generated") {
      const prompt = asStr(v.prompt)?.trim();
      if (prompt) return { mode: "generated", prompt };
    }
    // A `prompt` with no/garbled mode → treat as generated.
    const loosePrompt = asStr(v.prompt)?.trim();
    if (loosePrompt) return { mode: "generated", prompt: loosePrompt };
    const looseText = asStr(v.text);
    if (looseText != null) return { mode: "static", text: looseText };
  }
  // Fall back to the type's sensible default content.
  return type === "logo" || type === "divider"
    ? { mode: "static", text: type === "logo" ? "Firm logo" : "" }
    : { mode: "generated", prompt: DEFAULT_PROMPT[type] ?? "Write this section from the source." };
}

function normaliseBlock(v: unknown): Block | null {
  if (!isRecord(v)) return null;
  const type = oneOf(v.type, BLOCK_TYPES);
  if (!type) return null; // unknown block type → drop this block
  const label = asStr(v.label)?.trim() || BLOCK_TYPE_META[type].label;
  const width: "full" | "half" = v.width === "half" ? "half" : "full";
  const style = normaliseStyle(v.style);
  const block: Block = {
    id: uid("blk"),
    type,
    label,
    width,
    content: normaliseContent(v.content, type),
  };
  if (style) block.style = style;
  return block;
}

/**
 * Coerce arbitrary parsed JSON (from the model) into a valid custom Template,
 * assigning fresh ids. `fallbackName` (the example filename) is used when the
 * model omits a name. Throws if the JSON has no usable blocks at all.
 */
export function templateFromInferred(raw: unknown, fallbackName: string): Template {
  if (!isRecord(raw)) {
    throw new Error("Model did not return a template object");
  }
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks = rawBlocks
    .map(normaliseBlock)
    .filter((b): b is Block => b !== null)
    .slice(0, MAX_TEMPLATE_BLOCKS);
  if (blocks.length === 0) {
    throw new Error("No recognisable blocks in the model's template");
  }

  const kind: TemplateKind = oneOf(raw.kind, ["memo", "ic"] as const) ?? "memo";
  const variant: TemplateVariant =
    oneOf(raw.variant, ["simple", "full"] as const) ?? "full";

  const page = isRecord(raw.page) ? raw.page : {};
  const pageFont = oneOf(page.font, FONTS) ?? "editorial";
  const pageAccent = oneOf(page.accent, ACCENTS) ?? "paper";
  const showLogo = typeof page.showLogo === "boolean" ? page.showLogo : false;

  const name = asStr(raw.name)?.trim() || `Learned — ${fallbackName}`;
  const description =
    asStr(raw.description)?.trim() || `Learned from ${fallbackName}.`;

  return {
    id: uid("custom"),
    name,
    kind,
    variant,
    description,
    page: { font: pageFont, accent: pageAccent, showLogo },
    blocks,
  };
}
