import { useState } from "react";
import type {
  Block,
  BlockAccent,
  BlockFont,
  BlockSize,
  BlockType,
  Template,
} from "./types";
import { BLOCK_TYPE_META, newBlock } from "./templateStore";
import { BlockView } from "./BlockView";

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
  const [draft, setDraft] = useState<Template>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.blocks[0]?.id ?? null
  );
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const selected = draft.blocks.find((b) => b.id === selectedId) ?? null;

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

  const addBlock = (type: BlockType) => {
    const b = newBlock(type);
    mutate({ ...draft, blocks: [...draft.blocks, b] });
    setSelectedId(b.id);
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
          {dirty && <span className="kn-ed-dirty">Unsaved</span>}
          <button className="kn-btn kn-btn--primary" onClick={handleSave}>
            Save template
          </button>
        </div>
      </div>

      <div className="kn-ed-grid">
        {/* ── Left: name + palette + page style ── */}
        <aside className="kn-ed-side">
          <label className="kn-label kn-label--grow">
            Template name
            <input
              type="text"
              className="kn-input"
              value={draft.name}
              onChange={(e) => mutate({ ...draft, name: e.target.value })}
            />
          </label>

          <div className="kn-ed-side-label">Add a block</div>
          <div className="kn-ed-palette">
            {PALETTE.map((t) => (
              <button key={t} className="kn-ed-palette-btn" onClick={() => addBlock(t)}>
                <span className="kn-ed-palette-icon">{BLOCK_TYPE_META[t].icon}</span>
                {BLOCK_TYPE_META[t].label}
              </button>
            ))}
          </div>

          <div className="kn-ed-side-label">Page style</div>
          <label className="kn-ed-field">
            Font
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
            Accent
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
          <label className="kn-ed-check">
            <input
              type="checkbox"
              checked={draft.page.showLogo}
              onChange={(e) =>
                mutate({ ...draft, page: { ...draft.page, showLogo: e.target.checked } })
              }
            />
            Show firm logo
          </label>
        </aside>

        {/* ── Center: block canvas ── */}
        <div className="kn-ed-canvas">
          {draft.blocks.length === 0 && (
            <div className="kn-ed-empty">Add a block from the left to start.</div>
          )}
          {draft.blocks.map((b, i) => (
            <div
              key={b.id}
              className={`kn-ed-block ${b.id === selectedId ? "kn-ed-block--sel" : ""} ${
                dragIndex === i ? "kn-ed-block--drag" : ""
              }`}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) moveBlock(dragIndex, i);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              onClick={() => setSelectedId(b.id)}
            >
              <div className="kn-ed-block-bar">
                <span className="kn-ed-grip" title="Drag to reorder">
                  ⋮⋮
                </span>
                <span className="kn-ed-block-type">
                  {BLOCK_TYPE_META[b.type].icon} {b.type}
                </span>
                <button
                  className="kn-ed-del"
                  title="Delete block"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBlock(b.id);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="kn-ed-block-body">
                <BlockView block={b} />
              </div>
            </div>
          ))}
        </div>

        {/* ── Right: inspector ── */}
        <aside className="kn-ed-inspector">
          {!selected ? (
            <div className="kn-ed-inspector-empty">Select a block to edit it.</div>
          ) : (
            <>
              <div className="kn-ed-side-label">
                {BLOCK_TYPE_META[selected.type].label}
              </div>

              <label className="kn-ed-field">
                Label
                <input
                  type="text"
                  className="kn-input"
                  value={selected.label}
                  onChange={(e) => updateBlock(selected.id, { label: e.target.value })}
                />
              </label>

              <div className="kn-ed-field-label">Content</div>
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
                  Generated
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
                  Static
                </button>
              </div>

              {selected.content.mode === "generated" ? (
                <label className="kn-ed-field">
                  Prompt for this block
                  <textarea
                    className="kn-input kn-input--textarea"
                    rows={6}
                    value={selected.content.prompt}
                    onChange={(e) =>
                      updateBlock(selected.id, {
                        content: { mode: "generated", prompt: e.target.value },
                      })
                    }
                    placeholder="What should this block say? e.g. Summarize the founding team, lead with prior exits."
                  />
                </label>
              ) : (
                <label className="kn-ed-field">
                  Fixed text
                  <textarea
                    className="kn-input kn-input--textarea"
                    rows={4}
                    value={selected.content.text}
                    onChange={(e) =>
                      updateBlock(selected.id, {
                        content: { mode: "static", text: e.target.value },
                      })
                    }
                  />
                </label>
              )}

              <div className="kn-ed-field-label">Style</div>
              <div className="kn-ed-style-grid">
                <label className="kn-ed-field">
                  Font
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
                  Size
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
                  Weight
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
                  Accent
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
                  Align
                  <select
                    className="kn-input kn-input--select"
                    value={selected.style?.align ?? "left"}
                    onChange={(e) =>
                      updateStyle(selected.id, { align: e.target.value as "left" | "center" })
                    }
                  >
                    <option value="left">left</option>
                    <option value="center">center</option>
                  </select>
                </label>
                <label className="kn-ed-field">
                  Width
                  <select
                    className="kn-input kn-input--select"
                    value={selected.width}
                    onChange={(e) =>
                      updateBlock(selected.id, { width: e.target.value as "full" | "half" })
                    }
                  >
                    <option value="full">full</option>
                    <option value="half">half</option>
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
