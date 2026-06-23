// Block-based document template model (wave 3.3 foundation).
//
// A Template is an ordered list of Blocks. Each Block carries three things at
// once: layout (width), style (typography), and content. Content is either a
// per-block `prompt` the LLM fills, or fixed `text` the firm always wants. The
// same model powers the drag-drop designer, the generation walk, and the
// rendered document — so "drag-drop layout" and "custom content prompt" are the
// same object.

export type BlockType =
  | "cover"
  | "heading"
  | "paragraph"
  | "bullets"
  | "metrics"
  | "chart"
  | "table"
  | "scoreBox"
  | "logo"
  | "divider";

export type BlockFont = "editorial" | "sans" | "mono";
export type BlockAccent = "paper" | "gold" | "teal" | "crimson";
export type BlockSize = "sm" | "md" | "lg" | "xl";

export type BlockStyle = {
  font?: BlockFont;
  size?: BlockSize;
  weight?: "regular" | "medium" | "bold";
  align?: "left" | "center";
  accent?: BlockAccent;
};

// Generated blocks get filled by the LLM from `prompt`; static blocks hold
// fixed text (disclaimer, firm name, …).
export type BlockContent =
  | { mode: "generated"; prompt: string }
  | { mode: "static"; text: string };

// Optional representative data used ONLY by the read-only gallery preview, so a
// user can see the shape of a template before generating anything real.
export type BlockSample = {
  text?: string;
  bullets?: string[];
  metrics?: { label: string; value: string }[];
  chart?: { label: string; value: number }[];
  rows?: string[][];
  score?: { label: string; value: string };
  caption?: string;
};

export type Block = {
  id: string;
  type: BlockType;
  label: string; // editor-facing name + section heading text
  width: "full" | "half";
  style?: BlockStyle;
  content: BlockContent;
  sample?: BlockSample;
};

export type TemplateKind = "memo" | "ic";
export type TemplateVariant = "simple" | "full";

export type Template = {
  // Starters use the canonical ids simple-memo / full-memo / simple-ic /
  // full-ic; user-forked templates use a generated `custom-…` id.
  id: string;
  name: string;
  kind: TemplateKind;
  variant: TemplateVariant;
  description: string;
  page: { font: BlockFont; accent: BlockAccent; showLogo: boolean };
  blocks: Block[];
};
