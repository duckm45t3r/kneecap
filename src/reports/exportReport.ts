// Report export — PDF + DOCX (P1 follow-on).
//
// A finished report used to dead-end at on-screen markdown / clipboard; a VC
// couldn't hand it to an IC. This module turns a SavedReport's compiled
// markdown into a real deliverable:
//
//   • PDF  — render a clean, print-styled HTML document (firm logo + serif
//            headings + the report's accent rule) into a hidden iframe and call
//            the webview's print-to-PDF. macOS's print panel lets the user
//            "Save as PDF" and choose location/filename. No extra crate/lib.
//   • DOCX — build a Word document from the same parsed markdown tokens using
//            the `docx` JS lib, then save the .docx bytes through a native
//            Save-As dialog (tauri-plugin-dialog) + our save_export_file
//            command.
//
// Both paths share ONE markdown tokeniser (below) so headings / paragraphs /
// bullets / numbered lists / tables / blockquotes / rules map consistently.
// Anything we can't map cleanly (e.g. a fenced ```chart block) degrades to a
// plain paragraph rather than breaking the export — a slightly plain export
// that reliably works beats a fancy one that throws.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from "docx";
import type { SavedReport } from "./reportStore";
import { getTemplate, getFirmLogo, type FirmLogo } from "../templates/templateStore";
import type { BlockAccent } from "../templates/types";

// ─── Accent → print colour ───────────────────────────────────────────
//
// The on-screen viewer is dark-themed (paper text on ink). A printed memo an IC
// reads should be the inverse — dark ink on white paper. We map the template's
// accent to a hex that reads well on white (the *-dim token variants), used for
// the heading rule + h1 colour. Hex (not CSS vars) because the print iframe and
// the docx lib both need concrete values.
const ACCENT_HEX: Record<BlockAccent, string> = {
  paper: "1a1e2e", // ink — the neutral default
  gold: "a08c4e",
  teal: "2d9a8c",
  crimson: "8a3832",
};

const INK = "1a1e2e";
const INK_MUTE = "5e5a52";

function accentForReport(report: SavedReport): string {
  const tpl = report.templateId ? getTemplate(report.templateId) : undefined;
  const accent = tpl?.page?.accent ?? "gold";
  return ACCENT_HEX[accent] ?? ACCENT_HEX.gold;
}

// ─── Markdown tokeniser ──────────────────────────────────────────────
//
// A deliberately small, forgiving block-level parser. It covers exactly what
// the report markdown contains (the LLM emits clean GFM) and degrades unknown
// constructs to paragraphs. Inline emphasis (**bold**, *italic*, `code`) is
// kept as raw text spans the two renderers split themselves.

type Tok =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

function splitTableRow(line: string): string[] {
  // "| a | b |" → ["a","b"]; tolerate missing outer pipes.
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableDivider(line: string): boolean {
  // | --- | :--: | ---: |
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

export function tokenizeMarkdown(md: string): Tok[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const toks: Tok[] = [];
  let i = 0;
  let inFence = false; // skip fenced code/chart blocks → collapse to a note

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code / chart blocks: we can't lay these out cleanly, so emit a
    // single muted paragraph noting an embedded element and skip the body.
    const fence = trimmed.match(/^```(\w*)/);
    if (fence) {
      if (!inFence) {
        const lang = fence[1] || "code";
        toks.push({
          kind: "paragraph",
          text: lang === "chart" ? "[Chart omitted in export]" : "",
        });
        inFence = true;
      } else {
        inFence = false;
      }
      i += 1;
      continue;
    }
    if (inFence) {
      i += 1;
      continue;
    }

    if (trimmed === "") {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(trimmed)) {
      toks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    // ATX heading
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(3, h[1].length) as 1 | 2 | 3;
      toks.push({ kind: "heading", level, text: h[2].trim() });
      i += 1;
      continue;
    }

    // GFM table: header row followed by a divider row.
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const rows: string[][] = [splitTableRow(line)];
      i += 2; // skip header + divider
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      toks.push({ kind: "table", rows });
      continue;
    }

    // Blockquote (collapse a run of > lines into one)
    if (/^>\s?/.test(trimmed)) {
      const parts: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^\s*>\s?/, "").trim());
        i += 1;
      }
      toks.push({ kind: "quote", text: parts.join(" ") });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, "").trim());
        i += 1;
      }
      toks.push({ kind: "bullets", items });
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "").trim());
        i += 1;
      }
      toks.push({ kind: "numbers", items });
      continue;
    }

    // Paragraph — gather consecutive non-blank lines that aren't another block.
    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        t === "" ||
        /^(#{1,6})\s+/.test(t) ||
        /^[-*+]\s+/.test(t) ||
        /^\d+[.)]\s+/.test(t) ||
        /^>\s?/.test(t) ||
        /^```/.test(t) ||
        (t.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1]))
      ) {
        break;
      }
      para.push(t);
      i += 1;
    }
    toks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return toks;
}

// ─── Inline span splitting (**bold**, *italic*, `code`) ──────────────

type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  // Split on the three markers; keep delimiters so we can toggle state.
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) {
      spans.push({ text: tok.slice(2, -2), bold: true });
    } else if (tok.startsWith("`")) {
      spans.push({ text: tok.slice(1, -1), code: true });
    } else {
      spans.push({ text: tok.slice(1, -1), italic: true });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length ? spans : [{ text }];
}

function stripInline(text: string): string {
  return parseInline(text)
    .map((s) => s.text)
    .join("");
}

// ─── PDF: print-to-PDF via a hidden, print-styled iframe ─────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineToHtml(text: string): string {
  return parseInline(text)
    .map((s) => {
      const t = escapeHtml(s.text);
      if (s.code) return `<code>${t}</code>`;
      if (s.bold) return `<strong>${t}</strong>`;
      if (s.italic) return `<em>${t}</em>`;
      return t;
    })
    .join("");
}

function tokensToHtml(toks: Tok[]): string {
  const out: string[] = [];
  for (const tk of toks) {
    switch (tk.kind) {
      case "heading":
        out.push(`<h${tk.level}>${inlineToHtml(tk.text)}</h${tk.level}>`);
        break;
      case "paragraph":
        if (tk.text.trim()) out.push(`<p>${inlineToHtml(tk.text)}</p>`);
        break;
      case "bullets":
        out.push(
          `<ul>${tk.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join("")}</ul>`
        );
        break;
      case "numbers":
        out.push(
          `<ol>${tk.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join("")}</ol>`
        );
        break;
      case "quote":
        out.push(`<blockquote>${inlineToHtml(tk.text)}</blockquote>`);
        break;
      case "rule":
        out.push("<hr/>");
        break;
      case "table": {
        const [head, ...body] = tk.rows;
        const thead = head
          ? `<thead><tr>${head.map((c) => `<th>${inlineToHtml(c)}</th>`).join("")}</tr></thead>`
          : "";
        const tbody = `<tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inlineToHtml(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody>`;
        out.push(`<table>${thead}${tbody}</table>`);
        break;
      }
    }
  }
  return out.join("\n");
}

function buildPrintHtml(report: SavedReport, logo: FirmLogo | null): string {
  const accent = accentForReport(report);
  const body = tokensToHtml(tokenizeMarkdown(report.markdown));
  const meta = [
    report.templateName || "report",
    report.provider || "",
    report.createdAt ? new Date(report.createdAt).toLocaleString() : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const logoImg = logo
    ? `<img class="logo" src="${escapeHtml(logo.dataUrl)}" alt=""/>`
    : "";

  // Self-contained light/print theme. Serif headings mirror the viewer
  // (Cormorant Garamond) with safe fallbacks; the accent drives the top rule
  // + h1 colour so the firm's styling carries onto paper.
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${escapeHtml(report.title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Inter", -apple-system, Helvetica, Arial, sans-serif;
    font-size: 11pt; line-height: 1.6; color: #${INK};
    margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .head { border-top: 3px solid #${accent}; padding-top: 12px; margin-bottom: 18px; }
  .logo { max-height: 48px; max-width: 220px; margin-bottom: 10px; display: block; }
  h1.title {
    font-family: "Cormorant Garamond", Georgia, serif;
    font-size: 24pt; font-weight: 600; color: #${accent}; margin: 0 0 4px;
  }
  .meta { font-size: 8.5pt; color: #${INK_MUTE}; letter-spacing: 0.02em; }
  h1, h2, h3 { font-family: "Cormorant Garamond", Georgia, serif; color: #${INK}; line-height: 1.25; }
  h1 { font-size: 18pt; font-weight: 600; margin: 18px 0 8px; }
  h2 { font-size: 15pt; font-weight: 600; margin: 16px 0 6px; }
  h3 { font-size: 13pt; font-weight: 600; margin: 14px 0 6px; }
  p { margin: 0 0 9px; }
  ul, ol { margin: 0 0 9px; padding-left: 20px; }
  li { margin-bottom: 3px; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 9.5pt;
         background: #f0ece3; padding: 0 3px; border-radius: 2px; }
  blockquote { border-left: 3px solid #${accent}; padding-left: 12px; margin: 0 0 9px;
               color: #4a463e; font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 12px; font-size: 9.5pt; }
  th, td { border: 1px solid #cfc8bb; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f0ece3; font-weight: 600; }
  hr { border: 0; border-top: 1px solid #d8d2c6; margin: 14px 0; }
  thead { display: table-header-group; }
  tr, li, blockquote { page-break-inside: avoid; }
</style></head>
<body>
  <div class="head">
    ${logoImg}
    <h1 class="title">${escapeHtml(report.title)}</h1>
    <div class="meta">${escapeHtml(meta)}</div>
  </div>
  ${body}
</body></html>`;
}

/**
 * Export the report to PDF via the webview's print-to-PDF. Renders the report
 * into a hidden same-origin iframe and calls print() on it; macOS shows the
 * print panel where the user picks "Save as PDF" + the destination. Resolves
 * once print() returns (the OS panel is modal). Returns false if the iframe
 * couldn't be prepared.
 */
export async function exportReportToPdf(report: SavedReport): Promise<boolean> {
  const logo = getFirmLogo();
  const html = buildPrintHtml(report, logo);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) return false;
    doc.open();
    doc.write(html);
    doc.close();

    // Give the iframe a tick to lay out + decode the logo image before print.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    win.focus();
    win.print();
    return true;
  } finally {
    // Leave the iframe in place briefly — some webviews finish print() async.
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1000);
  }
}

// ─── DOCX: build a Word document with the `docx` lib ─────────────────

function inlineToRuns(text: string): TextRun[] {
  return parseInline(text).map(
    (s) =>
      new TextRun({
        text: s.text,
        bold: s.bold,
        italics: s.italic,
        font: s.code ? "Consolas" : undefined,
      })
  );
}

function tableCell(text: string, header: boolean): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: header
          ? [new TextRun({ text: stripInline(text), bold: true })]
          : inlineToRuns(text),
      }),
    ],
    shading: header ? { fill: "F0ECE3" } : undefined,
  });
}

function tokensToDocxChildren(toks: Tok[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const HEADING = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  } as const;

  for (const tk of toks) {
    switch (tk.kind) {
      case "heading":
        out.push(new Paragraph({ heading: HEADING[tk.level], children: inlineToRuns(tk.text) }));
        break;
      case "paragraph":
        if (tk.text.trim()) out.push(new Paragraph({ children: inlineToRuns(tk.text) }));
        break;
      case "bullets":
        for (const it of tk.items) {
          out.push(new Paragraph({ bullet: { level: 0 }, children: inlineToRuns(it) }));
        }
        break;
      case "numbers":
        for (const it of tk.items) {
          out.push(
            new Paragraph({ numbering: { reference: "report-numbering", level: 0 }, children: inlineToRuns(it) })
          );
        }
        break;
      case "quote":
        out.push(
          new Paragraph({
            children: inlineToRuns(tk.text),
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 18, space: 12, color: "A08C4E" } },
          })
        );
        break;
      case "rule":
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "D8D2C6" } },
            children: [],
          })
        );
        break;
      case "table": {
        const rows = tk.rows.map(
          (r, ri) =>
            new TableRow({
              tableHeader: ri === 0,
              children: r.map((c) => tableCell(c, ri === 0)),
            })
        );
        out.push(
          new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
        );
        break;
      }
    }
  }
  return out;
}

function buildDocx(report: SavedReport): Document {
  const accent = accentForReport(report).toUpperCase();
  const meta = [
    report.templateName || "report",
    report.provider || "",
    report.createdAt ? new Date(report.createdAt).toLocaleString() : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const header: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun({ text: report.title, bold: true, size: 44, color: accent })],
      spacing: { after: 60 },
      border: { top: { style: BorderStyle.SINGLE, size: 24, space: 6, color: accent } },
    }),
    new Paragraph({
      children: [new TextRun({ text: meta, size: 17, color: "5E5A52" })],
      spacing: { after: 240 },
    }),
  ];

  return new Document({
    // A "report-numbering" instance so ordered-list items render as 1. 2. 3.
    numbering: {
      config: [
        {
          reference: "report-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 360, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: [...header, ...tokensToDocxChildren(tokenizeMarkdown(report.markdown))],
      },
    ],
  });
}

// ─── Save helper: native dialog → save_export_file command ───────────

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Chunked to avoid String.fromCharCode stack overflow on large reports.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function safeFilename(title: string): string {
  const base = (title || "report").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-");
  return (base || "report").slice(0, 80);
}

/**
 * Export the report to DOCX. Builds the Word document client-side, opens a
 * native Save-As dialog (user picks location/filename), then writes the bytes
 * via the save_export_file command. Returns false if the user cancels the
 * dialog.
 */
export async function exportReportToDocx(report: SavedReport): Promise<boolean> {
  const doc = buildDocx(report);
  const blob = await Packer.toBlob(doc);

  const path = await save({
    title: "Export report as Word document",
    defaultPath: `${safeFilename(report.title)}.docx`,
    filters: [{ name: "Word document", extensions: ["docx"] }],
  });
  if (!path) return false; // user cancelled

  const base64 = await blobToBase64(blob);
  await invoke("save_export_file", { path, base64Data: base64 });
  return true;
}
