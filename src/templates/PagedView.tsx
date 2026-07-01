import type { CSSProperties, ReactNode } from "react";
import type { Block, BlockFont, Template } from "./types";
import type { FirmLogo } from "./templateStore";
import { BlockView } from "./BlockView";

// W7 — the ONE A4 paged surface. Splits the flat block list into A4 sheets at
// each `pageBreak` marker and renders each sheet with the template's page style.
// Used by (a) the Template Studio center canvas (interactive), (b) the final
// report view, and (c) PDF/DOCX export — so "design preview = final doc = export"
// is WYSIWYG by construction.

const FONT_VAR: Record<BlockFont, string> = {
  editorial: "var(--vhs-serif)",
  sans: "var(--vhs-sans)",
  mono: "var(--vhs-mono)",
};

const ACCENT_VAR: Record<Template["page"]["accent"], string> = {
  paper: "var(--vhs-paper)",
  gold: "var(--vhs-gold)",
  teal: "var(--vhs-teal)",
  crimson: "var(--vhs-crimson)",
};

/**
 * Split the flat block list into A4 pages at each `pageBreak` marker.
 * `keepEmpty` keeps blank sheets — the designer wants the fresh page that
 * "＋ 新增分頁" just added; the read-only doc / export drops empties so we never
 * print a blank page.
 */
export function splitIntoPages(blocks: Block[], keepEmpty: boolean): Block[][] {
  const pages: Block[][] = [[]];
  for (const b of blocks) {
    if (b.type === "pageBreak") {
      pages.push([]);
      continue;
    }
    pages[pages.length - 1].push(b);
  }
  return keepEmpty ? pages : pages.filter((p) => p.length > 0);
}

export function PagedView({
  blocks,
  page,
  firmLogo,
  keepEmptyPages = false,
  selectedId,
  onSelectBlock,
  blockChrome,
  draggable = false,
  dragDocIndex = null,
  onBlockDragStart,
  onBlockDrop,
  onBlockDragEnd,
}: {
  blocks: Block[];
  page: Template["page"];
  firmLogo?: FirmLogo | null;
  /** Designer keeps blank sheets so a just-added page is visible; docs drop them. */
  keepEmptyPages?: boolean;
  /** Interactive (designer) props — omit for a read-only document. */
  selectedId?: string | null;
  onSelectBlock?: (id: string) => void;
  /** Per-block chrome (drag grip, delete) the designer injects onto each block. */
  blockChrome?: (block: Block, docIndex: number) => ReactNode;
  /** Drag-to-reorder (works across pages — it's one flat list). docIndex is the
   *  block's position in the ORIGINAL blocks[], which the designer feeds to
   *  moveBlock(from, to). */
  draggable?: boolean;
  dragDocIndex?: number | null;
  onBlockDragStart?: (docIndex: number) => void;
  onBlockDrop?: (docIndex: number) => void;
  onBlockDragEnd?: () => void;
}) {
  const pages = splitIntoPages(blocks, keepEmptyPages);
  const interactive = typeof onSelectBlock === "function";

  // Index of each block in the ORIGINAL blocks[] (pageBreaks included) so the
  // designer's select/drag can address the true position.
  const docIndexOf = new Map<string, number>();
  blocks.forEach((b, i) => docIndexOf.set(b.id, i));

  const sheetStyle: CSSProperties = {
    fontFamily: FONT_VAR[page.font],
    // Expose the page accent as a CSS var sheets/footers can pick up.
    ["--kn-page-accent" as string]: ACCENT_VAR[page.accent],
  };

  if (pages.length === 0) {
    return (
      <div className="kn-a4-stack">
        <div className="kn-a4-empty">Add a block to start your first page.</div>
      </div>
    );
  }

  return (
    <div className="kn-a4-stack">
      {pages.map((pageBlocks, pi) => (
        <section key={pi} className="kn-a4" style={sheetStyle} data-page={pi + 1}>
          <div className="kn-a4-inner">
            {pageBlocks.length === 0 ? (
              <div className="kn-a4-blank">
                Blank page — add a block or drag one here.
              </div>
            ) : (
              pageBlocks.map((b) => {
                const di = docIndexOf.get(b.id) ?? 0;
                const sel = selectedId === b.id;
                const isDragging = draggable && dragDocIndex === di;
                return (
                  <div
                    key={b.id}
                    className={
                      `kn-a4-block kn-a4-block--${b.width}` +
                      (interactive ? " kn-a4-block--interactive" : "") +
                      (sel ? " kn-a4-block--sel" : "") +
                      (isDragging ? " kn-a4-block--drag" : "")
                    }
                    onClick={interactive ? () => onSelectBlock?.(b.id) : undefined}
                    draggable={draggable || undefined}
                    onDragStart={draggable ? () => onBlockDragStart?.(di) : undefined}
                    onDragOver={draggable ? (e) => e.preventDefault() : undefined}
                    onDrop={
                      draggable
                        ? (e) => {
                            e.preventDefault();
                            onBlockDrop?.(di);
                          }
                        : undefined
                    }
                    onDragEnd={draggable ? () => onBlockDragEnd?.() : undefined}
                  >
                    {blockChrome?.(b, di)}
                    <BlockView block={b} firmLogo={firmLogo} />
                  </div>
                );
              })
            )}
          </div>
          <div className="kn-a4-foot">
            {pi + 1} / {pages.length}
          </div>
        </section>
      ))}
    </div>
  );
}
