import type { CSSProperties, ReactNode } from "react";
import type { Block, BlockAccent, BlockFont, BlockSize } from "./types";
import type { FirmLogo } from "./templateStore";

// Read-only renderer for one block. Used by the template gallery now, and by the
// final document view / editor canvas later. Generated blocks render their
// `sample` (representative copy) so a user can see the shape; with no sample we
// fall back to a muted line describing what the block will generate.

const FONT_VAR: Record<BlockFont, string> = {
  editorial: "var(--vhs-serif)",
  sans: "var(--vhs-sans)",
  mono: "var(--vhs-mono)",
};

const ACCENT_VAR: Record<BlockAccent, string> = {
  paper: "var(--vhs-paper)",
  gold: "var(--vhs-gold)",
  teal: "var(--vhs-teal)",
  crimson: "var(--vhs-crimson)",
};

const SIZE_PX: Record<BlockSize, number> = { sm: 13, md: 15, lg: 19, xl: 27 };

const EYEBROW_FOR = new Set([
  "paragraph",
  "bullets",
  "metrics",
  "chart",
  "table",
  "scoreBox",
]);

function headingStyle(block: Block): CSSProperties {
  const s = block.style ?? {};
  return {
    fontFamily: FONT_VAR[s.font ?? "editorial"],
    fontSize: SIZE_PX[s.size ?? "lg"],
    fontWeight: s.weight === "bold" ? 700 : s.weight === "regular" ? 400 : 500,
    textAlign: s.align ?? "left",
    color: ACCENT_VAR[s.accent ?? "paper"],
  };
}

function ghost(prompt: string) {
  return <p className="kn-tpl-ghost">AI-generated · {prompt}</p>;
}

export function BlockView({
  block,
  firmLogo,
}: {
  block: Block;
  firmLogo?: FirmLogo | null;
}) {
  const accent = block.style?.accent;
  const sample = block.sample;
  const prompt = block.content.mode === "generated" ? block.content.prompt : "";

  let body: ReactNode = null;

  switch (block.type) {
    case "logo":
      body = firmLogo ? (
        <img
          src={firmLogo.dataUrl}
          alt={firmLogo.name || "Firm logo"}
          className="kn-tpl-logo-img"
        />
      ) : (
        <div className="kn-tpl-logo">
          {block.content.mode === "static" ? block.content.text : "Firm logo"}
        </div>
      );
      break;

    case "divider":
      body = <hr className="kn-tpl-hr" />;
      break;

    case "cover":
      body = (
        <div className="kn-tpl-cover">
          <div className="kn-tpl-cover-title" style={headingStyle(block)}>
            {sample?.text ?? block.label}
          </div>
          {sample?.caption && <div className="kn-tpl-cover-sub">{sample.caption}</div>}
        </div>
      );
      break;

    case "heading":
      body = <div className="kn-tpl-h" style={headingStyle(block)}>{sample?.text ?? block.label}</div>;
      break;

    case "paragraph":
      body = sample?.text ? <p className="kn-tpl-p">{sample.text}</p> : ghost(prompt);
      break;

    case "bullets":
      body = sample?.bullets ? (
        <ul className={`kn-tpl-ul${accent ? ` kn-tpl-ul--${accent}` : ""}`}>
          {sample.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : (
        ghost(prompt)
      );
      break;

    case "metrics":
      body = sample?.metrics ? (
        <div className="kn-tpl-metrics">
          {sample.metrics.map((m, i) => (
            <div key={i} className="kn-tpl-metric">
              <div className="kn-tpl-metric-label">{m.label}</div>
              <div className="kn-tpl-metric-value">{m.value}</div>
            </div>
          ))}
        </div>
      ) : (
        ghost(prompt)
      );
      break;

    case "chart": {
      const data = sample?.chart;
      const max = data && data.length ? Math.max(...data.map((d) => d.value)) : 1;
      body = data ? (
        <div className="kn-tpl-chart">
          <div className="kn-tpl-bars">
            {data.map((d, i) => (
              <div key={i} className="kn-tpl-bar-col">
                <div className="kn-tpl-bar" style={{ height: `${Math.round((d.value / max) * 100)}%` }} />
                <div className="kn-tpl-bar-label">{d.label}</div>
              </div>
            ))}
          </div>
          {sample?.caption && <div className="kn-tpl-caption">{sample.caption}</div>}
        </div>
      ) : (
        ghost(prompt)
      );
      break;
    }

    case "table":
      body = sample?.rows ? (
        <table className="kn-tpl-table">
          <tbody>
            {sample.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) =>
                  ri === 0 ? <th key={ci}>{cell}</th> : <td key={ci}>{cell}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        ghost(prompt)
      );
      break;

    case "scoreBox":
      body = sample?.score ? (
        <div className="kn-tpl-score">
          <div className="kn-tpl-score-num">{sample.score.value}</div>
          <div className="kn-tpl-score-meta">
            <div className="kn-tpl-score-label">{sample.score.label}</div>
            {sample.caption && <div className="kn-tpl-score-cap">{sample.caption}</div>}
          </div>
        </div>
      ) : (
        ghost(prompt)
      );
      break;
  }

  const showEyebrow = EYEBROW_FOR.has(block.type);

  return (
    <div className={`kn-tpl-block kn-tpl-block--${block.width}`}>
      {showEyebrow && <div className="kn-tpl-eyebrow">{block.label}</div>}
      {body}
    </div>
  );
}
