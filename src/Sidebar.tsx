import type { ReactNode } from "react";
import type { SavedReport } from "./reports/reportStore";
import type { Template } from "./templates/types";
import { isStarter } from "./templates/templateStore";

// Persistent left column (P1 keystone). Three stacked sections:
//   1. Primary nav  — the flows that were previously only reachable from Home
//   2. Saved reports — persisted to the Tauri fs; click opens the read-only
//      viewer, the × deletes the file
//   3. Templates    — starters (read-only badge) + custom forks
// Styled with the VHS editorial tokens (gold / teal / ink, Cormorant headers,
// JetBrains-mono eyebrows) to match the rest of the shell.

export type SidebarNav =
  | "home"
  | "templates"
  | "quickmemo"
  | "icreport"
  | "settings";

function timeAgo(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

const NAV_ITEMS: { id: SidebarNav; label: string; emoji: string }[] = [
  { id: "templates", label: "New report", emoji: "✎" },
  { id: "quickmemo", label: "Quick Memo", emoji: "⚡" },
  { id: "icreport", label: "Full IC Report", emoji: "📊" },
  { id: "templates", label: "Templates", emoji: "▦" },
  { id: "settings", label: "Settings", emoji: "⚙" },
];

export function Sidebar({
  activeNav,
  selectedReportId,
  reports,
  templates,
  onNavigate,
  onOpenReport,
  onDeleteReport,
  onGenerateTemplate,
  usageSlot,
}: {
  activeNav: SidebarNav | null;
  selectedReportId: string | null;
  reports: SavedReport[];
  templates: Template[];
  onNavigate: (nav: SidebarNav) => void;
  onOpenReport: (id: string) => void;
  onDeleteReport: (id: string) => void;
  onGenerateTemplate: (id: string) => void;
  // W5: hosted usage gauge (compact). Rendered by App so the gauge logic stays
  // in one place; null when VHS isn't linked.
  usageSlot?: ReactNode;
}) {
  return (
    <aside className="kn-sidebar">
      <button className="kn-sidebar-logo" onClick={() => onNavigate("home")} title="Home">
        KN33C4P
      </button>

      <nav className="kn-sidebar-nav">
        {NAV_ITEMS.map((item, i) => (
          <button
            key={`${item.id}-${i}`}
            className={`kn-sidebar-link ${
              activeNav === item.id && selectedReportId === null
                ? "kn-sidebar-link--active"
                : ""
            }`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="kn-sidebar-link-emoji">{item.emoji}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="kn-sidebar-section">
        <div className="kn-sidebar-heading">
          Saved reports
          <span className="kn-sidebar-count">{reports.length}</span>
        </div>
        {reports.length === 0 ? (
          <p className="kn-sidebar-empty">
            Nothing saved yet. Generate a report and hit “Save report”.
          </p>
        ) : (
          <ul className="kn-sidebar-list">
            {reports.map((r) => (
              <li
                key={r.id}
                className={`kn-sidebar-report ${
                  selectedReportId === r.id ? "kn-sidebar-report--active" : ""
                }`}
              >
                <button
                  className="kn-sidebar-report-main"
                  onClick={() => onOpenReport(r.id)}
                  title={r.title}
                >
                  <span className="kn-sidebar-report-title">{r.title || "Untitled"}</span>
                  <span className="kn-sidebar-report-meta">
                    {r.templateName || "report"}
                    {r.createdAt ? ` · ${timeAgo(r.createdAt)}` : ""}
                  </span>
                </button>
                <button
                  className="kn-sidebar-report-del"
                  onClick={() => onDeleteReport(r.id)}
                  title="Delete report"
                  aria-label="Delete report"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="kn-sidebar-section">
        <div className="kn-sidebar-heading">Templates</div>
        <ul className="kn-sidebar-list">
          {templates.map((t) => (
            <li key={t.id} className="kn-sidebar-tpl">
              <button
                className="kn-sidebar-tpl-main"
                onClick={() => onGenerateTemplate(t.id)}
                title={`Generate from ${t.name}`}
              >
                <span className="kn-sidebar-tpl-name">{t.name}</span>
                <span
                  className={`kn-sidebar-tpl-badge ${
                    isStarter(t.id) ? "kn-sidebar-tpl-badge--starter" : "kn-sidebar-tpl-badge--custom"
                  }`}
                >
                  {isStarter(t.id) ? "starter" : "custom"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {usageSlot && <div className="kn-sidebar-footer">{usageSlot}</div>}
    </aside>
  );
}
