import { useState, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type {
  Block,
  BlockAccent,
  BlockFont,
  BlockSize,
  BlockType,
  Template,
} from "./types";
import { MAX_TEMPLATE_BLOCKS } from "./types";
import {
  BLOCK_TYPE_META,
  newBlock,
  getFirmLogo,
  setFirmLogo,
  clearFirmLogo,
  readLogoFile,
  LOGO_ACCEPT,
  type FirmLogo,
} from "./templateStore";
import { PagedView } from "./PagedView";
import { useT } from "../i18n";

const PALETTE: BlockType[] = [
  "heading",
  "paragraph",
  "bullets",
  "metrics",
  "chart",
  "table",
  "scoreBox",
  "cover",
  "logo",
  "divider",
];

const FONTS: BlockFont[] = ["editorial", "sans", "mono"];
const SIZES: BlockSize[] = ["sm", "md", "lg", "xl"];
const WEIGHTS = ["regular", "medium", "bold"] as const;
const ACCENTS: BlockAccent[] = ["paper", "gold", "teal", "crimson"];

export function TemplateDesigner({
  initial,
  onSave,
  onClose,
}: {
  initial: Template;
  onSave: (t: Template) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<Template>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.blocks[0]?.id ?? null
  );
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [firmLogo, setFirmLogoState] = useState<FirmLogo | null>(() => getFirmLogo());
  const [logoMsg, setLogoMsg] = useState<string | null>(null);

  const selected = draft.blocks.find((b) => b.id === selectedId) ?? null;

  const onLogoFile = async (file: File | null) => {
    if (!file) return;
    setLogoMsg(null);
    try {
      const logo = await readLogoFile(file);
      setFirmLogo(logo);
      setFirmLogoState(logo);
    } catch (e) {
      setLogoMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const removeLogo = () => {
    clearFirmLogo();
    setFirmLogoState(null);
  };

  const mutate = (next: Template) => {
    setDraft(next);
    setDirty(true);
  };

  const updateBlock = (id: string, patch: Partial<Block>) =>
    mutate({
      ...draft,
      blocks: draft.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });

  const updateStyle = (id: string, patch: Partial<Block["style"]>) => {
    const b = draft.blocks.find((x) => x.id === id);
    if (!b) return;
    updateBlock(id, { style: { ...b.style, ...patch } });
  };

  // The cap bounds GENERATED content blocks (= LLM calls per report); pageBreaks
  // are layout markers and don't count toward it.
  const contentBlockCount = draft.blocks.filter((b) => b.type !== "pageBreak").length;
  const atBlockCap = contentBlockCount >= MAX_TEMPLATE_BLOCKS;

  const addBlock = (type: BlockType) => {
    // Guard the cap here too — a stray call can't push past the ceiling even if
    // the disabled palette button is somehow triggered.
    if (contentBlockCount >= MAX_TEMPLATE_BLOCKS) return;
    const b = newBlock(type);
    mutate({ ...draft, blocks: [...draft.blocks, b] });
    setSelectedId(b.id);
  };

  // "＋ Add page" — appends a pageBreak (a new blank A4 sheet at the end). The
  // user then adds/drags blocks onto it. Manual pagination = WYSIWYG.
  const addPageBreak = () => {
    const b = newBlock("pageBreak");
    mutate({ ...draft, blocks: [...draft.blocks, b] });
  };

  const removeBlock = (id: string) => {
    const idx = draft.blocks.findIndex((b) => b.id === id);
    const blocks = draft.blocks.filter((b) => b.id !== id);
    mutate({ ...draft, blocks });
    if (selectedId === id) {
      setSelectedId(blocks[Math.max(0, idx - 1)]?.id ?? null);
    }
  };

  const moveBlock = (from: number, to: number) => {
    if (from === to) return;
    const blocks = [...draft.blocks];
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    mutate({ ...draft, blocks });
  };

  // ── Pointer-based block drag ──────────────────────────────────────────
  // HTML5 `draggable` is swallowed by Tauri's WKWebView drag-drop handler, so
  // reordering uses raw pointer events (unaffected by Tauri) + elementFromPoint
  // to find the block under the cursor. dragIndex = block being dragged (dimmed);
  // dropIndex = current target (highlighted). Works across pages — it's one list.
  const dragFrom = useRef<number | null>(null);
  const dragTo = useRef<number | null>(null);

  const startBlockDrag = (from: number, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragFrom.current = from;
    dragTo.current = from;
    setDragIndex(from);
    setDropIndex(from);

    const onMove = (ev: globalThis.PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const blockEl = (el as Element | null)?.closest?.(
        "[data-doc-index]",
      ) as HTMLElement | null;
      if (!blockEl) return;
      const idx = Number(blockEl.getAttribute("data-doc-index"));
      if (!Number.isNaN(idx)) {
        dragTo.current = idx;
        setDropIndex(idx);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const from2 = dragFrom.current;
      const to2 = dragTo.current;
      dragFrom.current = null;
      dragTo.current = null;
      setDragIndex(null);
      setDropIndex(null);
      if (from2 !== null && to2 !== null && to2 !== from2) moveBlock(from2, to2);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleSave = () => {
    onSave(draft);
    setDirty(false);
  };

  return (
    <div className="kn-flow kn-ed">
      <div className="kn-ed-top">
        <button className="kn-back" onClick={onClose}>
          ← Back
        </button>
        <div className="kn-ed-top-actions">
          {dirty && <span className="kn-ed-dirty">{t("studio.unsaved")}</span>}
          <button className="kn-btn kn-btn--primary" onClick={handleSave}>
            {t("studio.saveTemplate")}
          </button>
        </div>
      </div>

      <div className="kn-ed-grid">
        {/* ── Left: name + palette + page style ── */}
        <aside className="kn-ed-side">
          <label className="kn-label kn-label--grow">
            {t("studio.templateName")}
            <input
              type="text"
              className="kn-input"
              value={draft.nameKey ? t(draft.nameKey) : draft.name}
              onChange={(e) => mutate({ ...draft, name: e.target.value, nameKey: undefined })}
            />
          </label>

          <div className="kn-ed-side-label">
            {t("studio.addBlock")}
            <span className="kn-ed-block-count">
              {contentBlockCount}/{MAX_TEMPLATE_BLOCKS}
            </span>
          </div>
          <div className="kn-ed-palette">
            {PALETTE.map((blockType) => (
              <button
                key={blockType}
                className="kn-ed-palette-btn"
                onClick={() => addBlock(blockType)}
                disabled={atBlockCap}
                title={atBlockCap ? t("studio.maxBlocksTooltip", { max: MAX_TEMPLATE_BLOCKS }) : ""}
              >
                <span className="kn-ed-palette-icon">{BLOCK_TYPE_META[blockType].icon}</span>
                {t(BLOCK_TYPE_META[blockType].labelKey)}
              </button>
            ))}
          </div>
          {atBlockCap && (
            <div className="kn-ed-block-cap-note">{t("studio.maxBlocksNote", { max: MAX_TEMPLATE_BLOCKS })}</div>
          )}

          <button
            className="kn-ed-addpage"
            onClick={addPageBreak}
            title={t("studio.addPageTooltip")}
          >
            <span className="kn-ed-palette-icon">⤓</span> {t("studio.addPage")}
          </button>

          <div className="kn-ed-side-label">{t("studio.pageStyle")}</div>
          <label className="kn-ed-field">
            {t("studio.font")}
            <select
              className="kn-input kn-input--select"
              value={draft.page.font}
              onChange={(e) =>
                mutate({ ...draft, page: { ...draft.page, font: e.target.value as BlockFont } })
              }
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="kn-ed-field">
            {t("studio.accent")}
            <select
              className="kn-input kn-input--select"
              value={draft.page.accent}
              onChange={(e) =>
                mutate({ ...draft, page: { ...draft.page, accent: e.target.value as BlockAccent } })
              }
            >
              {ACCENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <div className="kn-ed-side-label">{t("studio.firmLogo")}</div>
          {firmLogo && (
            <div className="kn-ed-logo-row">
              <img src={firmLogo.dataUrl} alt="" className="kn-ed-logo-thumb" />
              <span className="kn-ed-logo-name">{firmLogo.name}</span>
              <button className="kn-link-btn" onClick={removeLogo}>
                {t("studio.logoRemove")}
              </button>
            </div>
          )}
          <label className="kn-btn kn-ed-logo-upload">
            <input
              type="file"
              accept={LOGO_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => onLogoFile(e.target.files?.[0] ?? null)}
            />
            {firmLogo ? t("studio.replaceLogo") : t("studio.uploadLogo")}
          </label>
          {logoMsg && <div className="kn-ed-logo-msg">{logoMsg}</div>}

          <label className="kn-ed-check">
            <input
              type="checkbox"
              checked={draft.page.showLogo}
              onChange={(e) =>
                mutate({ ...draft, page: { ...draft.page, showLogo: e.target.checked } })
              }
            />
            {t("studio.showLogo")}
          </label>
        </aside>

        {/* ── Center: A4 paged canvas (W7) — the live preview IS the output ── */}
        <div className="kn-ed-canvas kn-ed-canvas--a4">
          {draft.blocks.length === 0 && (
            <div className="kn-ed-empty">{t("studio.emptyCanvas")}</div>
          )}
          <PagedView
            blocks={draft.blocks}
            page={draft.page}
            firmLogo={firmLogo}
            keepEmptyPages
            selectedId={selectedId}
            onSelectBlock={setSelectedId}
            dragDocIndex={dragIndex}
            dropDocIndex={dropIndex}
            blockChrome={(b, di) => (
              <div className="kn-a4-chrome">
                <span
                  className="kn-a4-grip"
                  title={t("studio.dragToMove")}
                  onPointerDown={(e) => startBlockDrag(di, e)}
                >
                  ⋮⋮
                </span>
                <button
                  className="kn-a4-del"
                  title={t("studio.deleteBlock")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBlock(b.id);
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          />
        </div>

        {/* ── Right: inspector ── */}
        <aside className="kn-ed-inspector">
          {!selected ? (
            <div className="kn-ed-inspector-empty">{t("studio.inspectorEmpty")}</div>
          ) : (
            <>
              <div className="kn-ed-side-label">
                {t(BLOCK_TYPE_META[selected.type].labelKey)}
              </div>

              <label className="kn-ed-field">
                {t("studio.blockLabel")}
                <input
                  type="text"
                  className="kn-input"
                  value={selected.labelKey ? t(selected.labelKey) : selected.label}
                  onChange={(e) =>
                    updateBlock(selected.id, { label: e.target.value, labelKey: undefined })
                  }
                />
              </label>

              <div className="kn-ed-field-label">{t("studio.content")}</div>
              <div className="kn-ed-seg">
                <button
                  className={`kn-ed-seg-btn ${
                    selected.content.mode === "generated" ? "kn-ed-seg-btn--on" : ""
                  }`}
                  onClick={() =>
                    updateBlock(selected.id, {
                      content:
                        selected.content.mode === "generated"
                          ? selected.content
                          : { mode: "generated", prompt: "" },
                    })
                  }
                >
                  {t("studio.contentGenerated")}
                </button>
                <button
                  className={`kn-ed-seg-btn ${
                    selected.content.mode === "static" ? "kn-ed-seg-btn--on" : ""
                  }`}
                  onClick={() =>
                    updateBlock(selected.id, {
                      content:
                        selected.content.mode === "static"
                          ? selected.content
                          : { mode: "static", text: "" },
                    })
                  }
                >
                  {t("studio.contentStatic")}
                </button>
              </div>

              {selected.content.mode === "generated" ? (
                <label className="kn-ed-field">
                  {t("studio.promptLabel")}
                  <textarea
                    className="kn-input kn-input--textarea"
                    rows={6}
                    value={selected.content.prompt}
                    onChange={(e) =>
                      updateBlock(selected.id, {
                        content: { mode: "generated", prompt: e.target.value },
                      })
                    }
                    placeholder={t("studio.promptPlaceholder")}
                  />
                </label>
              ) : (
                <label className="kn-ed-field">
                  {t("studio.fixedTextLabel")}
                  <textarea
                    className="kn-input kn-input--textarea"
                    rows={4}
                    value={selected.content.textKey ? t(selected.content.textKey) : selected.content.text}
                    onChange={(e) =>
                      updateBlock(selected.id, {
                        content: { mode: "static", text: e.target.value },
                      })
                    }
                  />
                </label>
              )}

              <div className="kn-ed-field-label">{t("studio.style")}</div>
              <div className="kn-ed-style-grid">
                <label className="kn-ed-field">
                  {t("studio.font")}
                  <select
                    className="kn-input kn-input--select"
                    value={selected.style?.font ?? "editorial"}
                    onChange={(e) => updateStyle(selected.id, { font: e.target.value as BlockFont })}
                  >
                    {FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kn-ed-field">
                  {t("studio.size")}
                  <select
                    className="kn-input kn-input--select"
                    value={selected.style?.size ?? "md"}
                    onChange={(e) => updateStyle(selected.id, { size: e.target.value as BlockSize })}
                  >
                    {SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kn-ed-field">
                  {t("studio.weight")}
                  <select
                    className="kn-input kn-input--select"
                    value={selected.style?.weight ?? "medium"}
                    onChange={(e) =>
                      updateStyle(selected.id, {
                        weight: e.target.value as (typeof WEIGHTS)[number],
                      })
                    }
                  >
                    {WEIGHTS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kn-ed-field">
                  {t("studio.accent")}
                  <select
                    className="kn-input kn-input--select"
                    value={selected.style?.accent ?? "paper"}
                    onChange={(e) =>
                      updateStyle(selected.id, { accent: e.target.value as BlockAccent })
                    }
                  >
                    {ACCENTS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kn-ed-field">
                  {t("studio.align")}
                  <select
                    className="kn-input kn-input--select"
                    value={selected.style?.align ?? "left"}
                    onChange={(e) =>
                      updateStyle(selected.id, { align: e.target.value as "left" | "center" })
                    }
                  >
                    <option value="left">{t("studio.alignLeft")}</option>
                    <option value="center">{t("studio.alignCenter")}</option>
                  </select>
                </label>
                <label className="kn-ed-field">
                  {t("studio.width")}
                  <select
                    className="kn-input kn-input--select"
                    value={selected.width}
                    onChange={(e) =>
                      updateBlock(selected.id, { width: e.target.value as "full" | "half" })
                    }
                  >
                    <option value="full">{t("studio.widthFull")}</option>
                    <option value="half">{t("studio.widthHalf")}</option>
                  </select>
                </label>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
