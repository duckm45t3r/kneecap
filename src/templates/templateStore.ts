import { invoke } from "@tauri-apps/api/core";
import type {
  Block,
  BlockAccent,
  BlockContent,
  BlockFont,
  BlockSample,
  BlockSize,
  BlockStyle,
  BlockType,
  Template,
  TemplateKind,
  TemplateVariant,
} from "./types";
import { MAX_TEMPLATE_BLOCKS } from "./types";
import type { MessageKey } from "../i18n/messages";
import { STARTER_TEMPLATES } from "./starters";

// ─── Custom templates — SQLite (Phase D) ──────────────────────────────
//
// User-forked / learned templates persist in kneecap.db via hand-rolled
// #[tauri::command] fns (template_list / template_save / template_delete),
// mirroring the deals store. Starters (STARTER_TEMPLATES) stay in code and are
// never persisted; editing one forks a custom copy.
//
// SQLite reads are async, but getAllTemplates / getTemplate are called
// synchronously all over (useState initialisers, the PDF/DOCX export path). So
// we keep an in-memory CACHE of the custom templates, hydrated once at app load
// via hydrateCustomTemplates(); the sync getters read the cache, and writes
// update the cache immediately AND fire the async DB command. The cache is the
// single source of truth the UI renders from.

// What template_list / template_save return per row (snake_case from Rust).
type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  data: string; // the full Template JSON
  created_at: string;
  updated_at: string;
};

// Newest-updated first, matching template_list's ORDER BY.
let customCache: Template[] = [];

/** Parse one row's `data` JSON into a Template; null if it's unparseable. */
function rowToTemplate(row: TemplateRow): Template | null {
  try {
    const t = JSON.parse(row.data) as Template;
    // Trust the row id over whatever's embedded (they're written together, but
    // the column is canonical for delete/overwrite).
    return t && typeof t === "object" ? { ...t, id: row.id } : null;
  } catch {
    return null;
  }
}

const LS_KEY = "kneecap_custom_templates";
const MIGRATED_FLAG = "templates_migrated";

/** Read any legacy localStorage custom templates (pre-Phase-D store). */
function readLegacyLocalTemplates(): Template[] {
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

/**
 * Load custom templates from SQLite into the cache. Call once at app start
 * (before the first render that reads templates) and await it. Also runs the
 * one-time localStorage → SQLite migration: if the DB has no custom templates
 * yet AND localStorage holds some AND we haven't migrated, push each into the
 * DB, then set a flag so it never runs again. The localStorage copy is left in
 * place as a safety net.
 */
export async function hydrateCustomTemplates(): Promise<void> {
  let rows = (await invoke<TemplateRow[]>("template_list")) ?? [];

  // One-time migration of the legacy localStorage store.
  const alreadyMigrated =
    typeof window !== "undefined" &&
    !!window.localStorage &&
    window.localStorage.getItem(MIGRATED_FLAG) === "1";
  if (rows.length === 0 && !alreadyMigrated) {
    const legacy = readLegacyLocalTemplates();
    if (legacy.length > 0) {
      for (const t of legacy) {
        try {
          await invoke<TemplateRow>("template_save", {
            id: t.id,
            name: t.name,
            kind: t.kind,
            data: JSON.stringify(t),
          });
        } catch {
          /* skip a single bad row; don't sink the whole migration */
        }
      }
      // Re-read so the cache reflects exactly what's now in the DB.
      rows = (await invoke<TemplateRow[]>("template_list")) ?? [];
    }
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(MIGRATED_FLAG, "1");
    }
  }

  customCache = rows
    .map(rowToTemplate)
    .filter((t): t is Template => t !== null);
}

/** The custom templates currently in the cache (sync). */
export function listCustomTemplates(): Template[] {
  return customCache;
}

export function getAllTemplates(): Template[] {
  return [...STARTER_TEMPLATES, ...customCache];
}

export function getTemplate(id: string): Template | undefined {
  return getAllTemplates().find((t) => t.id === id);
}

export function isStarter(id: string): boolean {
  return STARTER_TEMPLATES.some((t) => t.id === id);
}

/**
 * Create or overwrite a custom template. Updates the in-memory cache first (so
 * the next sync read is correct) then persists to SQLite. Awaitable so callers
 * can refresh UI state once the write lands.
 */
export async function saveCustomTemplate(t: Template): Promise<void> {
  const idx = customCache.findIndex((x) => x.id === t.id);
  if (idx >= 0) customCache = [t, ...customCache.filter((x) => x.id !== t.id)];
  else customCache = [t, ...customCache];
  await invoke<TemplateRow>("template_save", {
    id: t.id,
    name: t.name,
    kind: t.kind,
    data: JSON.stringify(t),
  });
}

/** Delete a custom template. Updates the cache then persists the delete. */
export async function deleteCustomTemplate(id: string): Promise<void> {
  customCache = customCache.filter((t) => t.id !== id);
  await invoke("template_delete", { id });
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

export function duplicateTemplate(t: Template, displayName?: string): Template {
  const clone: Template = JSON.parse(JSON.stringify(t));
  // A duplicate becomes a user-owned custom template — strip the starter i18n
  // keys so it renders as fixed text (in whatever language was on-screen at
  // duplication time) rather than staying dynamically re-translated forever.
  delete clone.nameKey;
  delete clone.descriptionKey;
  for (const b of clone.blocks) {
    delete b.labelKey;
    if (b.content.mode === "static") delete b.content.textKey;
  }
  return { ...clone, id: uid("custom"), name: `${displayName ?? t.name} (copy)` };
}

export const BLOCK_TYPE_META: Record<BlockType, { label: string; labelKey: MessageKey; icon: string }> = {
  cover: { label: "Cover", labelKey: "block.cover", icon: "▭" },
  heading: { label: "Heading", labelKey: "block.heading", icon: "H" },
  paragraph: { label: "Paragraph", labelKey: "block.paragraph", icon: "¶" },
  bullets: { label: "Bullets", labelKey: "block.bullets", icon: "•" },
  metrics: { label: "Metric strip", labelKey: "block.metrics", icon: "▦" },
  chart: { label: "Chart", labelKey: "block.chart", icon: "▮" },
  table: { label: "Table", labelKey: "block.table", icon: "▤" },
  scoreBox: { label: "Score box", labelKey: "block.scoreBox", icon: "★" },
  logo: { label: "Logo", labelKey: "block.logo", icon: "◈" },
  divider: { label: "Divider", labelKey: "block.divider", icon: "—" },
  // W7 layout marker — not offered in the content palette; PagedView consumes it.
  pageBreak: { label: "Page break", labelKey: "block.pageBreak", icon: "⤓" },
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
  // pageBreak is a layout marker — no content, always full width. It carries an
  // empty static content only to satisfy the uniform Block shape; PagedView
  // consumes it as a sheet boundary and the generation walk skips it.
  if (type === "pageBreak") {
    return {
      id: uid("brk"),
      type,
      label: "Page break",
      labelKey: BLOCK_TYPE_META.pageBreak.labelKey,
      width: "full",
      content: { mode: "static", text: "" },
    };
  }
  const isStatic = type === "logo" || type === "divider";
  return {
    id: uid("blk"),
    type,
    label: BLOCK_TYPE_META[type].label,
    labelKey: BLOCK_TYPE_META[type].labelKey,
    width: "full",
    content: isStatic
      ? {
          mode: "static",
          text: type === "logo" ? "Firm logo" : "",
          ...(type === "logo" ? { textKey: "starter.staticFirmLogo" as MessageKey } : {}),
        }
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

// W7 (D) — Format Learning now asks the model to emit a representative `sample`
// per block so the A4 preview reads like a real report, not ghost lines. The
// model is untrusted about shape, so we walk every field and coerce/drop.
function normaliseSample(v: unknown): BlockSample | undefined {
  if (!isRecord(v)) return undefined;
  const s: BlockSample = {};
  const text = asStr(v.text);
  if (text != null) s.text = text;
  const caption = asStr(v.caption);
  if (caption != null) s.caption = caption;
  if (Array.isArray(v.bullets)) {
    const bullets = v.bullets.filter((x): x is string => typeof x === "string");
    if (bullets.length) s.bullets = bullets;
  }
  if (Array.isArray(v.metrics)) {
    const metrics = v.metrics
      .filter(isRecord)
      .map((m) => ({ label: asStr(m.label) ?? "", value: asStr(m.value) ?? "" }))
      .filter((m) => m.label || m.value);
    if (metrics.length) s.metrics = metrics;
  }
  if (Array.isArray(v.chart)) {
    const chart = v.chart
      .filter(isRecord)
      .map((c) => ({
        label: asStr(c.label) ?? "",
        value: typeof c.value === "number" ? c.value : Number(c.value),
      }))
      .filter((c) => Number.isFinite(c.value));
    if (chart.length) s.chart = chart;
  }
  if (Array.isArray(v.rows)) {
    const rows = v.rows
      .filter((r): r is unknown[] => Array.isArray(r))
      .map((r) => r.map((cell) => asStr(cell) ?? String(cell ?? "")));
    if (rows.length) s.rows = rows;
  }
  if (isRecord(v.score)) {
    const label = asStr(v.score.label);
    const value = asStr(v.score.value);
    if (label != null || value != null) {
      s.score = { label: label ?? "", value: value ?? "" };
    }
  }
  return Object.keys(s).length > 0 ? s : undefined;
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
  const sample = normaliseSample(v.sample);
  if (sample) block.sample = sample;
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
