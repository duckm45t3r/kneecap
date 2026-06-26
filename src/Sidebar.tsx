import type { ReactNode } from "react";
import type { DealListRow } from "./deals/dealStore";
import type { Template } from "./templates/types";
import { isStarter } from "./templates/templateStore";

// Persistent left column (P1 keystone). Three stacked sections:
//   1. Primary nav — the flows that were previously only reachable from Home
//   2. Deals       — a saved report is now a DEAL that evolves (v1…vN, plus its
//      accumulated sources); persisted in SQLite. Click opens the deal view.
//   3. Templates   — starters (read-only badge) + custom forks
// Styled with the VHS editorial tokens (gold / teal / ink, Cormorant headers,
// JetBrains-mono eyebrows) to match the rest of the shell.

export type SidebarNav =
  | "home"
  | "templates"
  | "quickmemo"
  | "icreport"
  | "settings";

function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
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
  selectedDealId,
  deals,
  templates,
  onNavigate,
  onOpenDeal,
  onGenerateTemplate,
  usageSlot,
  themeSlot,
}: {
  activeNav: SidebarNav | null;
  selectedDealId: string | null;
  deals: DealListRow[];
  templates: Template[];
  onNavigate: (nav: SidebarNav) => void;
  onOpenDeal: (id: string) => void;
  onGenerateTemplate: (id: string) => void;
  // W5: hosted usage gauge (compact). Rendered by App so the gauge logic stays
  // in one place; null when VHS isn't linked.
  usageSlot?: ReactNode;
  // Compact ink/paper theme toggle, rendered in the footer. Always present.
  themeSlot?: ReactNode;
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
              activeNav === item.id && selectedDealId === null
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
          Reports
          <span className="kn-sidebar-count">{deals.length}</span>
        </div>
        {deals.length === 0 ? (
          <p className="kn-sidebar-empty">
            No reports yet. Generate one and hit “Save to report”.
          </p>
        ) : (
          <ul className="kn-sidebar-list">
            {deals.map((d) => (
              <li
                key={d.deal.id}
                className={`kn-sidebar-report ${
                  selectedDealId === d.deal.id ? "kn-sidebar-report--active" : ""
                }`}
              >
                <button
                  className="kn-sidebar-report-main"
                  onClick={() => onOpenDeal(d.deal.id)}
                  title={d.deal.name}
                >
                  <span className="kn-sidebar-report-title">
                    {d.deal.name || "Untitled report"}
                  </span>
                  <span className="kn-sidebar-report-meta">
                    {d.latest_seq > 0 ? `v${d.latest_seq}` : "no versions"}
                    {d.source_count > 0
                      ? ` · ${d.source_count} source${d.source_count === 1 ? "" : "s"}`
                      : ""}
                    {d.updated_at ? ` · ${timeAgo(d.updated_at)}` : ""}
                  </span>
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

      {(usageSlot || themeSlot) && (
        <div className="kn-sidebar-footer">
          {usageSlot}
          {themeSlot && (
            <div className="kn-sidebar-theme">
              <span className="kn-sidebar-theme-label">Theme</span>
              {themeSlot}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
