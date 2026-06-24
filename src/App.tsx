import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChartRenderer, type ChartSpec } from "./ChartRenderer";
import { BlockView } from "./templates/BlockView";
import { TemplateDesigner } from "./templates/TemplateDesigner";
import {
  getAllTemplates,
  isStarter,
  duplicateTemplate,
  saveCustomTemplate,
  deleteCustomTemplate,
  getFirmLogo,
} from "./templates/templateStore";
import type { Template } from "./templates/types";
import { Sidebar, type SidebarNav } from "./Sidebar";
import {
  listReports,
  getReport,
  saveReport,
  deleteReport,
  newReportId,
  type SavedReport,
} from "./reports/reportStore";
import "./App.css";

/**
 * Shared markdown renderer with custom handling for fenced `chart` blocks
 * (W3.2 R5). The LLM emits ```chart\n{...}\n``` and we swap it for the
 * recharts-based <ChartRenderer/>. Used by both Quick Memo + IC Report.
 */
function MarkdownView({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const isChart =
            typeof className === "string" && className.includes("language-chart");
          if (isChart) {
            try {
              const spec = JSON.parse(String(children).trim()) as ChartSpec;
              return <ChartRenderer spec={spec} />;
            } catch {
              return <pre className="kn-chart-err">{String(children)}</pre>;
            }
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

// ─── Types ────────────────────────────────────────────────────────────

type View =
  | "home"
  | "settings"
  | "quickmemo"
  | "icreport"
  | "template-editor"
  | "templates"
  | "report";
// "vhs" = VHS-hosted (W4): the desktop relays the built prompt through the
// VHS server proxy using a device bearer token; no user API key needed.
type Provider = "anthropic" | "openai" | "gemini" | "local" | "vhs";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; provider: Provider; latencyMs: number }
  | { kind: "error"; provider: Provider; message: string };

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  local: "Local (Ollama)",
  vhs: "VHS-hosted",
};

// Providers that take a bring-your-own API key (matches the Rust
// SUPPORTED_PROVIDERS). "local" and "vhs" are configured differently.
type ByoProvider = "anthropic" | "openai" | "gemini";

const PROVIDER_HINTS: Record<ByoProvider, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  gemini: "AIza...",
};

const IC_SECTIONS = ["founder", "market", "traction", "terms", "compile"] as const;
type IcSection = (typeof IC_SECTIONS)[number];

const IC_LABELS: Record<IcSection, string> = {
  founder: "Founder & Team",
  market: "Market",
  traction: "Product & Traction",
  terms: "Round & Terms",
  compile: "Compiled Memo",
};

type IcSectionResult = { section: IcSection; content: string };

// ─── Templates (W3 R6) ───────────────────────────────────────────────

type MemoTemplate = "simple-memo" | "full-memo";
type IcTemplate = "simple-ic" | "full-ic";

const MEMO_TEMPLATE_LABELS: Record<MemoTemplate, string> = {
  "simple-memo": "Simple memo (1-pager bullets)",
  "full-memo": "Full memo (2-page structured)",
};

const IC_TEMPLATE_LABELS: Record<IcTemplate, string> = {
  "simple-ic": "Simple IC (3 sections)",
  "full-ic": "Full IC (5 sections + sub-blocks)",
};

const IC_SECTIONS_BY_TEMPLATE: Record<IcTemplate, IcSection[]> = {
  "simple-ic": ["founder", "market", "compile"],
  "full-ic": ["founder", "market", "traction", "terms", "compile"],
};

// ─── Stage (W3.2 A7) ─────────────────────────────────────────────────
// Optional stage selector — when set, prepends stage-specific guidance to
// every section prompt so the LLM emphasises the right metrics for that
// round shape (e.g. pre-seed: team thesis; growth: exit math).
type Stage = "" | "pre-seed" | "seed" | "series-a" | "series-b" | "growth";
const STAGE_LABELS: Record<Stage, string> = {
  "": "(any stage)",
  "pre-seed": "Pre-seed (team + thesis)",
  seed: "Seed (early PMF)",
  "series-a": "Series A (PMF + GTM)",
  "series-b": "Series B+ (scale econ)",
  growth: "Growth (exit math)",
};

/**
 * W3.2 R7 — custom prompt persistence. User-edited prompts override the
 * built-in template body in the backend. Stored per (template, section)
 * pair so a user can customise simple-ic founder + full-memo + etc
 * independently. Leaving the textarea blank removes the override.
 */
function customPromptKey(template: string, section: string): string {
  return `kneecap_prompt_${template}_${section}`;
}
function getCustomPrompt(template: string, section: string): string {
  if (typeof window === "undefined" || !window.localStorage) return "";
  return window.localStorage.getItem(customPromptKey(template, section)) ?? "";
}
function setCustomPrompt(template: string, section: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const trimmed = value.trim();
  if (!trimmed) {
    window.localStorage.removeItem(customPromptKey(template, section));
  } else {
    window.localStorage.setItem(customPromptKey(template, section), trimmed);
  }
}

/**
 * Read a File as base64 (without the "data:...;base64," prefix). The Rust
 * backend pdf-extract takes the raw base64 string. Used by Quick Memo + IC
 * Report PDF upload paths (W3 R1).
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// W4: turn the hosted /generate quota tail into a short toast line.
type HostedQuota = { used: number; limit: number; overage: boolean };
function formatQuota(q: HostedQuota): string {
  if (q.overage) {
    return `VHS-hosted · ${q.used}/${q.limit} used · overage billed $2 this report`;
  }
  if (q.limit > 0) {
    return `VHS-hosted · ${q.used}/${q.limit} reports used this month`;
  }
  return "VHS-hosted report generated";
}

// ─── App shell ────────────────────────────────────────────────────────

function App() {
  const [view, setView] = useState<View>("home");
  const [toast, setToast] = useState<string | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState<Provider[]>([]);
  // W4: VHS-hosted link state, tracked separately from configuredProviders
  // (which comes from list_configured_providers — only BYO key providers).
  // When linked, "vhs" is merged into the available providers below.
  const [vhsLinked, setVhsLinked] = useState(false);

  // P1: saved reports + templates lifted to the App root so the persistent
  // sidebar reflects them everywhere, mirroring the existing refreshProviders
  // pattern. Reports live on the Tauri fs; templates still come from
  // templateStore (localStorage — Phase D migration deferred).
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [templates, setTemplates] = useState<Template[]>(() => getAllTemplates());
  // The saved report currently open in the read-only viewer.
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  // Template the gallery should jump straight to "generate" on (set when the
  // sidebar Templates list is clicked). null = land on browse.
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const refreshProviders = useCallback(async () => {
    try {
      const list = (await invoke<string[]>("list_configured_providers")) ?? [];
      setConfiguredProviders(list as Provider[]);
    } catch (e) {
      console.error("list_configured_providers failed", e);
      setConfiguredProviders([]);
    }
    // VHS link state is a separate Keychain entry — refresh it alongside.
    try {
      const status = await invoke<string>("vhs_hosted_status");
      setVhsLinked(status === "linked");
    } catch (e) {
      console.error("vhs_hosted_status failed", e);
      setVhsLinked(false);
    }
  }, []);

  const refreshReports = useCallback(async () => {
    try {
      setReports(await listReports());
    } catch (e) {
      console.error("list_reports failed", e);
      setReports([]);
    }
  }, []);

  const refreshTemplates = useCallback(() => {
    setTemplates(getAllTemplates());
  }, []);

  useEffect(() => {
    refreshProviders();
    refreshReports();
  }, [refreshProviders, refreshReports]);

  const goHome = useCallback(() => {
    setSelectedReportId(null);
    setView("home");
  }, []);

  const handleNavigate = useCallback(
    (nav: SidebarNav) => {
      setSelectedReportId(null);
      setPendingTemplateId(null);
      setView(nav);
    },
    [],
  );

  const handleOpenReport = useCallback((id: string) => {
    setSelectedReportId(id);
    setView("report");
  }, []);

  const handleDeleteReport = useCallback(
    async (id: string) => {
      try {
        await deleteReport(id);
        await refreshReports();
        if (selectedReportId === id) {
          setSelectedReportId(null);
          setView("home");
        }
        showToast("Report deleted");
      } catch (e) {
        showToast(`Delete failed: ${String(e)}`);
      }
    },
    [refreshReports, selectedReportId, showToast],
  );

  const handleGenerateTemplate = useCallback((id: string) => {
    setSelectedReportId(null);
    setPendingTemplateId(id);
    setView("templates");
  }, []);

  // The full set of providers a flow can run with: BYO keys + Local (from the
  // Keychain scan) plus VHS-hosted when the device is linked. This is what the
  // flows and ProviderPicker receive so "vhs" shows up as selectable.
  const availableProviders = useMemo<Provider[]>(
    () => (vhsLinked ? [...configuredProviders, "vhs"] : configuredProviders),
    [configuredProviders, vhsLinked],
  );

  const hasAnyKey = availableProviders.length > 0;
  const headerSubtitle = useMemo(() => {
    const n = availableProviders.length;
    if (n === 0) return null;
    if (n === 1) return `${PROVIDER_LABELS[availableProviders[0]]} connected`;
    return `${n} providers connected`;
  }, [availableProviders]);

  // Which primary-nav entry the sidebar should highlight for the current view.
  const activeNav: SidebarNav | null =
    view === "home"
      ? "home"
      : view === "settings"
        ? "settings"
        : view === "quickmemo"
          ? "quickmemo"
          : view === "icreport"
            ? "icreport"
            : view === "templates" || view === "template-editor"
              ? "templates"
              : null;

  return (
    <div className="kn-app">
      <header className="kn-header">
        <button className="kn-logo" onClick={goHome} title="Home">
          KN33C4P
        </button>
        <div className="kn-header-spacer" />
        <button
          className="kn-icon-btn"
          onClick={() => handleNavigate("settings")}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </header>

      <div className="kn-body">
        <Sidebar
          activeNav={activeNav}
          selectedReportId={selectedReportId}
          reports={reports}
          templates={templates}
          onNavigate={handleNavigate}
          onOpenReport={handleOpenReport}
          onDeleteReport={handleDeleteReport}
          onGenerateTemplate={handleGenerateTemplate}
        />

        <main className="kn-main">
          {view === "home" && (
            <Home
              hasAnyKey={hasAnyKey}
              onOpenSettings={() => handleNavigate("settings")}
              onOpenTemplates={() => handleNavigate("templates")}
              onPick={(target) => {
                if (!hasAnyKey) {
                  showToast("Connect an LLM in Settings first");
                  return;
                }
                setView(target);
              }}
            />
          )}
          {view === "settings" && (
            <Settings
              onBack={goHome}
              configuredProviders={configuredProviders}
              vhsLinked={vhsLinked}
              refresh={refreshProviders}
              showToast={showToast}
              onOpenTemplateEditor={() => setView("template-editor")}
            />
          )}
          {view === "quickmemo" && (
            <QuickMemo
              onBack={goHome}
              configuredProviders={availableProviders}
              showToast={showToast}
            />
          )}
          {view === "icreport" && (
            <IcReport
              onBack={goHome}
              configuredProviders={availableProviders}
              showToast={showToast}
            />
          )}
          {view === "template-editor" && (
            <TemplateEditor onBack={() => setView("settings")} showToast={showToast} />
          )}
          {view === "templates" && (
            <TemplateGallery
              onBack={goHome}
              configuredProviders={configuredProviders}
              showToast={showToast}
              initialTemplateId={pendingTemplateId}
              clearInitialTemplate={() => setPendingTemplateId(null)}
              refreshTemplates={refreshTemplates}
              refreshReports={refreshReports}
              onSavedReport={handleOpenReport}
            />
          )}
          {view === "report" && (
            <ReportViewer
              reportId={selectedReportId}
              onBack={goHome}
              onDelete={handleDeleteReport}
              showToast={showToast}
            />
          )}
        </main>
      </div>

      <footer className="kn-footer">
        <span className="kn-footer-text">
          made with my knees ·{" "}
          <a href="https://vhs.capital" target="_blank" rel="noreferrer">
            vhs.capital
          </a>
        </span>
        <span className="kn-status">
          <span
            className={`kn-status-dot ${hasAnyKey ? "kn-status-dot--on" : "kn-status-dot--off"}`}
          />
          {headerSubtitle ?? "no LLM connected"}
        </span>
      </footer>

      {toast && <div className="kn-toast">{toast}</div>}
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────

function Home({
  hasAnyKey,
  onPick,
  onOpenSettings,
  onOpenTemplates,
}: {
  hasAnyKey: boolean;
  onPick: (target: View) => void;
  onOpenSettings: () => void;
  onOpenTemplates: () => void;
}) {
  return (
    <div className="kn-home">
      <h1 className="kn-hero-title">Desktop IC copilot for VHS</h1>
      <p className="kn-hero-sub">
        {hasAnyKey ? (
          "Pick a flow."
        ) : (
          <>
            Connect an LLM in{" "}
            <button className="kn-inline-link" onClick={onOpenSettings}>
              Settings
            </button>{" "}
            to start.
          </>
        )}
      </p>

      <div className="kn-card-grid">
        <button className="kn-card kn-card--gold" onClick={() => onPick("quickmemo")}>
          <div className="kn-card-emoji">⚡</div>
          <div className="kn-card-title">Quick Memo</div>
          <div className="kn-card-body">
            Drop a URL or company name. Out comes a 2-page memo in your firm&apos;s voice.
            ~5 min.
          </div>
        </button>

        <button className="kn-card kn-card--teal" onClick={() => onPick("icreport")}>
          <div className="kn-card-emoji">📊</div>
          <div className="kn-card-title">Full IC Report</div>
          <div className="kn-card-body">
            Multi-step deep dive. Founder, market, traction, terms. Iterate
            section-by-section. ~30 min.
          </div>
        </button>

        <button className="kn-card kn-card--wide" onClick={onOpenTemplates}>
          <div className="kn-card-emoji">▦</div>
          <div className="kn-card-title">Report templates</div>
          <div className="kn-card-body">
            Browse the simple and full layouts your reports are built from. Each
            is a stack of blocks — soon drag-and-drop editable.
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────

function Settings({
  onBack,
  configuredProviders,
  vhsLinked,
  refresh,
  showToast,
  onOpenTemplateEditor,
}: {
  onBack: () => void;
  configuredProviders: Provider[];
  vhsLinked: boolean;
  refresh: () => Promise<void>;
  showToast: (m: string) => void;
  onOpenTemplateEditor: () => void;
}) {
  return (
    <div className="kn-settings">
      <button className="kn-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="kn-settings-title">Settings</h2>

      <section className="kn-section">
        <h3 className="kn-section-title">LLM Connection</h3>
        <p className="kn-section-body">
          Pick how KN33C4P talks to a model. Costs metered to your account or
          machine. Bring your own key, run a local model, or link your VHS
          account to use the bundled hosted model.
        </p>

        <ByoKeyOption
          configuredProviders={configuredProviders}
          refresh={refresh}
          showToast={showToast}
        />

        <LocalModelOption
          isConfigured={configuredProviders.includes("local")}
          refresh={refresh}
          showToast={showToast}
        />

        <VhsHostedOption linked={vhsLinked} refresh={refresh} showToast={showToast} />
      </section>

      <section className="kn-section">
        <h3 className="kn-section-title">Template Editor (W3.2 R7)</h3>
        <p className="kn-section-body">
          Override the built-in prompt for any template / section combination.
          Your customisations stay on this Mac (localStorage); empty fields
          fall back to the default. Visual layout designer (logo / fonts /
          drag-drop blocks per R3) lands in wave 3.3.
        </p>
        <button className="kn-btn kn-btn--primary" onClick={onOpenTemplateEditor}>
          Open template editor →
        </button>
      </section>

      <section className="kn-section">
        <h3 className="kn-section-title">Format Learning</h3>
        <p className="kn-section-body">
          Drop a few of your firm&apos;s past memos and KN33C4P picks up the
          house format. Wiring up in W3.3 alongside the layout designer.
        </p>
      </section>

      <section className="kn-section">
        <h3 className="kn-section-title">About</h3>
        <p className="kn-section-body">
          KN33C4P · desktop IC copilot · built by{" "}
          <a href="https://vhs.capital" target="_blank" rel="noreferrer">
            vhs.capital
          </a>
          <br />
          Repo: github.com/duckm45t3r/kneecap (private)
        </p>
      </section>
    </div>
  );
}

// ─── BYO key option (A) ───────────────────────────────────────────────

function ByoKeyOption({
  configuredProviders,
  refresh,
  showToast,
}: {
  configuredProviders: Provider[];
  refresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const [provider, setProvider] = useState<ByoProvider>("anthropic");
  const [draft, setDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [pendingRemove, setPendingRemove] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await invoke("save_api_key", { provider, key: trimmed });
      setDraft("");
      setTest({ kind: "idle" });
      await refresh();
      showToast(`${PROVIDER_LABELS[provider]} key saved`);
    } catch (e) {
      showToast(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTest({ kind: "testing" });
    const start = Date.now();
    try {
      await invoke<string>("test_connection", { provider });
      setTest({ kind: "ok", provider, latencyMs: Date.now() - start });
    } catch (e) {
      setTest({ kind: "error", provider, message: String(e) });
    }
  };

  const handleRemove = async (p: Provider) => {
    if (pendingRemove === p) {
      try {
        await invoke("delete_api_key", { provider: p });
        await refresh();
        setTest({ kind: "idle" });
        showToast(`${PROVIDER_LABELS[p]} key removed`);
      } catch (e) {
        showToast(`Remove failed: ${String(e)}`);
      }
      setPendingRemove(null);
    } else {
      setPendingRemove(p);
      setTimeout(() => setPendingRemove((cur) => (cur === p ? null : cur)), 3000);
    }
  };

  return (
    <div className="kn-option">
      <div className="kn-option-title">
        <span className="kn-tag">A</span> Bring your own key
      </div>
      <div className="kn-option-body">
        Anthropic / OpenAI API key stays on this Mac (macOS Keychain). Costs
        metered to your account.
      </div>

      <div className="kn-form">
        <div className="kn-form-row">
          <label className="kn-label">
            Provider
            <select
              className="kn-input kn-input--select"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as ByoProvider);
                setTest({ kind: "idle" });
              }}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>

          <label className="kn-label kn-label--grow">
            API key
            <div className="kn-input-wrap">
              <input
                type={showKey ? "text" : "password"}
                className="kn-input kn-input--mono"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={PROVIDER_HINTS[provider]}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="kn-eye-btn"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        </div>

        <div className="kn-form-actions">
          <button
            className="kn-btn kn-btn--primary"
            onClick={handleSave}
            disabled={!draft.trim() || saving}
          >
            {saving ? "Saving…" : "Save key"}
          </button>
          <button
            className="kn-btn"
            onClick={handleTest}
            disabled={!configuredProviders.includes(provider) || test.kind === "testing"}
            title={!configuredProviders.includes(provider) ? "Save a key first" : ""}
          >
            {test.kind === "testing" ? "Testing…" : "Test connection"}
          </button>
        </div>

        {test.kind === "ok" && (
          <div className="kn-form-feedback kn-form-feedback--ok">
            ✓ {PROVIDER_LABELS[test.provider]} API authenticated · {test.latencyMs} ms
          </div>
        )}
        {test.kind === "error" && (
          <div className="kn-form-feedback kn-form-feedback--err">✗ {test.message}</div>
        )}
      </div>

      <div className="kn-key-list">
        {(["anthropic", "openai", "gemini"] as const).map((p) => (
          <div key={p} className="kn-key-row">
            <span className="kn-key-name">{PROVIDER_LABELS[p]}</span>
            {configuredProviders.includes(p) ? (
              <>
                <span className="kn-key-status kn-key-status--on">connected</span>
                <button
                  className={`kn-link-btn ${
                    pendingRemove === p ? "kn-link-btn--danger" : ""
                  }`}
                  onClick={() => handleRemove(p)}
                >
                  {pendingRemove === p ? "Confirm remove?" : "Remove"}
                </button>
              </>
            ) : (
              <span className="kn-key-status kn-key-status--off">not configured</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Local model option (B — Ollama) ──────────────────────────────────

function LocalModelOption({
  isConfigured,
  refresh,
  showToast,
}: {
  isConfigured: boolean;
  refresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [model, setModel] = useState("llama3.2");
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("save_local_config", {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      });
      await refresh();
      showToast("Local config saved");
    } catch (e) {
      showToast(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTest({ kind: "testing" });
    const start = Date.now();
    try {
      await invoke<string>("test_local_connection");
      setTest({ kind: "ok", provider: "local", latencyMs: Date.now() - start });
    } catch (e) {
      setTest({ kind: "error", provider: "local", message: String(e) });
    }
  };

  return (
    <div className="kn-option">
      <div className="kn-option-title">
        <span className="kn-tag">B</span> Local model (Ollama)
      </div>
      <div className="kn-option-body">
        Point KN33C4P at your local Ollama server. Zero outbound; slower than
        cloud Sonnet but free.
      </div>

      <div className="kn-form">
        <div className="kn-form-row">
          <label className="kn-label kn-label--grow">
            Base URL
            <input
              type="text"
              className="kn-input kn-input--mono"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="kn-label">
            Model
            <input
              type="text"
              className="kn-input kn-input--mono"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="llama3.2"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="kn-form-actions">
          <button
            className="kn-btn kn-btn--primary"
            onClick={handleSave}
            disabled={!baseUrl.trim() || !model.trim() || saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="kn-btn"
            onClick={handleTest}
            disabled={test.kind === "testing"}
          >
            {test.kind === "testing" ? "Pinging…" : "Test ping"}
          </button>
        </div>

        {test.kind === "ok" && (
          <div className="kn-form-feedback kn-form-feedback--ok">
            ✓ Ollama reachable · {test.latencyMs} ms
          </div>
        )}
        {test.kind === "error" && (
          <div className="kn-form-feedback kn-form-feedback--err">✗ {test.message}</div>
        )}
      </div>

      <div className="kn-key-list">
        <div className="kn-key-row">
          <span className="kn-key-name">{PROVIDER_LABELS.local}</span>
          <span className={`kn-key-status ${isConfigured ? "kn-key-status--on" : "kn-key-status--off"}`}>
            {isConfigured ? "configured" : "not configured"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── VHS-hosted option (C — W4 device bind + hosted proxy) ────────────
//
// OAuth device-code flow. "Connect" → backend requests a code + opens the
// browser → we show the 6-char user code + poll until the server approves
// (after the user logs in to VHS and the subscription gate passes) → token is
// stored in the Keychain and "vhs" becomes a selectable provider everywhere.

type BindStart = {
  device_code: string;
  user_code: string;
  verification_url: string;
  client_secret: string;
  poll_interval_seconds: number;
  expires_in_seconds: number;
};

type BindPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; start: BindStart }
  | { kind: "error"; message: string };

function VhsHostedOption({
  linked,
  refresh,
  showToast,
}: {
  linked: boolean;
  refresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const [phase, setPhase] = useState<BindPhase>({ kind: "idle" });

  // Poll loop: while waiting, hit vhs_poll_device on the server's cadence
  // until approved / denied / expired. Cleaned up on unmount or phase change.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    let cancelled = false;
    const { device_code, client_secret, poll_interval_seconds, expires_in_seconds } =
      phase.start;
    const deadline = Date.now() + expires_in_seconds * 1000;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        setPhase({ kind: "error", message: "Code expired — start the connect again" });
        return;
      }
      try {
        const status = await invoke<string>("vhs_poll_device", {
          deviceCode: device_code,
          clientSecret: client_secret,
        });
        if (cancelled) return;
        if (status.startsWith("approved")) {
          const who = status.slice("approved:".length);
          setPhase({ kind: "idle" });
          await refresh();
          showToast(`VHS-hosted linked${who ? ` · ${who}` : ""}`);
          return;
        }
        // "pending" → schedule the next poll.
        timer = window.setTimeout(tick, poll_interval_seconds * 1000);
      } catch (e) {
        if (cancelled) return;
        setPhase({ kind: "error", message: String(e) });
      }
    };

    let timer = window.setTimeout(tick, poll_interval_seconds * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, refresh, showToast]);

  const handleConnect = async () => {
    setPhase({ kind: "starting" });
    try {
      const start = await invoke<BindStart>("vhs_request_device_code");
      setPhase({ kind: "waiting", start });
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  };

  const handleUnlink = async () => {
    try {
      await invoke("vhs_unlink");
      await refresh();
      setPhase({ kind: "idle" });
      showToast("VHS-hosted unlinked");
    } catch (e) {
      showToast(`Unlink failed: ${String(e)}`);
    }
  };

  return (
    <div className="kn-option">
      <div className="kn-option-title">
        <span className="kn-tag">C</span> VHS-hosted
        {linked ? (
          <span className="kn-pill kn-pill--ok">Linked</span>
        ) : (
          <span className="kn-pill">No API key needed</span>
        )}
      </div>
      <div className="kn-option-body">
        Link your VHS account and KN33C4P uses the bundled hosted model — no
        API key on this Mac. Your $42/mo subscription includes 20 reports; extra
        reports bill $2 each via Stripe metered billing.
      </div>

      {linked ? (
        <div className="kn-key-list">
          <div className="kn-key-row">
            <span className="kn-key-name">{PROVIDER_LABELS.vhs}</span>
            <span className="kn-key-status kn-key-status--on">linked</span>
            <button className="kn-link-btn" onClick={handleUnlink}>
              Unlink
            </button>
          </div>
        </div>
      ) : (
        <div className="kn-form">
          {phase.kind === "waiting" ? (
            <>
              <div className="kn-form-feedback">
                1. A browser window opened to{" "}
                <a href={phase.start.verification_url} target="_blank" rel="noreferrer">
                  {phase.start.verification_url}
                </a>
                . Sign in to VHS if asked.
                <br />
                2. Enter this code in the browser:
              </div>
              <div className="kn-device-code">{phase.start.user_code}</div>
              <div className="kn-form-feedback kn-form-feedback--muted">
                Waiting for you to approve in the browser…
              </div>
              <div className="kn-form-actions">
                <button className="kn-btn" onClick={() => setPhase({ kind: "idle" })}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="kn-form-actions">
                <button
                  className="kn-btn kn-btn--primary"
                  onClick={handleConnect}
                  disabled={phase.kind === "starting"}
                >
                  {phase.kind === "starting" ? "Starting…" : "Connect to VHS"}
                </button>
              </div>
              {phase.kind === "error" && (
                <div className="kn-form-feedback kn-form-feedback--err">
                  ✗ {phase.message}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Quick Memo (W2.2) ────────────────────────────────────────────────

function QuickMemo({
  onBack,
  configuredProviders,
  showToast,
}: {
  onBack: () => void;
  configuredProviders: Provider[];
  showToast: (m: string) => void;
}) {
  const cloudFirst = configuredProviders.find((p) => p !== "local") ?? configuredProviders[0];
  const [provider, setProvider] = useState<Provider>(cloudFirst ?? "anthropic");
  const [template, setTemplate] = useState<MemoTemplate>("simple-memo");
  const [mode, setMode] = useState<SourceMode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [memo, setMemo] = useState<string | null>(null);
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    configuredProviders.length > 0 &&
    !running &&
    (mode === "url"
      ? url.trim().length > 0
      : mode === "text"
        ? text.trim().length > 0
        : pdfFile !== null);

  const handleRun = async () => {
    setRunning(true);
    setMemo(null);
    setExcerpt(null);
    setErr(null);
    try {
      let pdfB64: string | null = null;
      if (mode === "pdf" && pdfFile) {
        pdfB64 = await fileToBase64(pdfFile);
      }
      const override = getCustomPrompt(template, "memo");
      const memoInput = {
        provider,
        url: mode === "url" ? url.trim() : null,
        seed_text: mode === "text" ? text.trim() : null,
        pdf_base64: pdfB64,
        note: note.trim() || null,
        template,
        prompt_override: override || null,
      };
      // W4: route to the hosted proxy when provider is VHS-hosted, otherwise
      // the BYO/local path. Both build the same prompt server/desktop-side.
      if (provider === "vhs") {
        const out = await invoke<{
          memo: string;
          source_excerpt: string;
          quota: { used: number; limit: number; overage: boolean };
        }>("vhs_hosted_memo", { input: memoInput });
        setMemo(out.memo);
        setExcerpt(out.source_excerpt);
        showToast(formatQuota(out.quota));
      } else {
        const out = await invoke<{ memo: string; source_excerpt: string }>("quick_memo", {
          input: memoInput,
        });
        setMemo(out.memo);
        setExcerpt(out.source_excerpt);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = () => {
    if (!memo) return;
    navigator.clipboard.writeText(memo);
    showToast("Memo copied");
  };

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="kn-flow-title">Quick Memo</h2>
      <p className="kn-flow-sub">
        URL or pasted text → one ~2-page memo. About 5 minutes including the
        round-trip.
      </p>

      <div className="kn-disclaimer">
        ⚠ Draft only — verify against the source before sharing or acting on it.
        LLM output can be subtly wrong or steered by hostile pages.
      </div>

      <div className="kn-flow-row">
        <ProviderPicker
          provider={provider}
          setProvider={setProvider}
          configuredProviders={configuredProviders}
        />
        <label className="kn-label">
          Template
          <select
            className="kn-input kn-input--select"
            value={template}
            onChange={(e) => setTemplate(e.target.value as MemoTemplate)}
          >
            {(Object.keys(MEMO_TEMPLATE_LABELS) as MemoTemplate[]).map((t) => (
              <option key={t} value={t}>
                {MEMO_TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <SourceInput
        mode={mode}
        setMode={setMode}
        url={url}
        setUrl={setUrl}
        text={text}
        setText={setText}
        pdfFile={pdfFile}
        setPdfFile={setPdfFile}
      />

      <label className="kn-label kn-label--grow">
        Note for the reader (optional)
        <input
          type="text"
          className="kn-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. founder is Stanford ME PhD; we already passed on similar at $20M"
        />
      </label>

      <div className="kn-form-actions" style={{ marginTop: 18 }}>
        <button
          className="kn-btn kn-btn--primary"
          onClick={handleRun}
          disabled={!canSubmit}
        >
          {running ? "Drafting…" : "Draft memo"}
        </button>
        {memo && (
          <button className="kn-btn" onClick={handleCopy}>
            Copy memo
          </button>
        )}
      </div>

      {err && <div className="kn-form-feedback kn-form-feedback--err">✗ {err}</div>}

      {excerpt && (
        <details className="kn-collapse">
          <summary>Source excerpt</summary>
          <pre className="kn-prose kn-prose--muted">{excerpt}…</pre>
        </details>
      )}

      {memo && (
        <div className="kn-result">
          <h3 className="kn-result-title">Memo · raw</h3>
          <textarea
            className="kn-prose kn-prose--editable"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            spellCheck={false}
          />
          <h3 className="kn-result-title kn-result-title--secondary">Preview</h3>
          <div className="kn-markdown">
            <MarkdownView source={memo} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Full IC Report (W2.3) ────────────────────────────────────────────

function IcReport({
  onBack,
  configuredProviders,
  showToast,
}: {
  onBack: () => void;
  configuredProviders: Provider[];
  showToast: (m: string) => void;
}) {
  const cloudFirst = configuredProviders.find((p) => p !== "local") ?? configuredProviders[0];
  const [provider, setProvider] = useState<Provider>(cloudFirst ?? "anthropic");
  const [template, setTemplate] = useState<IcTemplate>("simple-ic");
  const [stage, setStage] = useState<Stage>("");
  const [mode, setMode] = useState<SourceMode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [hints, setHints] = useState<Record<IcSection, string>>({
    founder: "",
    market: "",
    traction: "",
    terms: "",
    compile: "",
  });
  const [sections, setSections] = useState<Partial<Record<IcSection, string>>>({});
  const [running, setRunning] = useState<IcSection | null>(null);
  const [activeSection, setActiveSection] = useState<IcSection>("founder");
  const [err, setErr] = useState<string | null>(null);

  // Sections exposed in this template's stepper. Switching templates resets
  // activeSection if it's no longer in scope (e.g. simple-ic drops traction).
  const activeSections = IC_SECTIONS_BY_TEMPLATE[template];
  useEffect(() => {
    if (!activeSections.includes(activeSection)) {
      setActiveSection(activeSections[0]);
    }
  }, [activeSections, activeSection]);

  const runSection = async (section: IcSection) => {
    setRunning(section);
    setErr(null);
    try {
      const prior: IcSectionResult[] = IC_SECTIONS.filter(
        (s) => s !== "compile" && s !== section && sections[s]
      ).map((s) => ({ section: s, content: sections[s]! }));

      let pdfB64: string | null = null;
      if (mode === "pdf" && pdfFile) {
        pdfB64 = await fileToBase64(pdfFile);
      }

      const override = getCustomPrompt(template, section);
      const icInput = {
        provider,
        section,
        url: mode === "url" ? url.trim() : null,
        seed_text: mode === "text" ? text.trim() : null,
        pdf_base64: pdfB64,
        hints: hints[section] || null,
        prior_sections: prior,
        template,
        stage: stage || null,
        prompt_override: override || null,
      };
      // W4: hosted vs BYO/local routing — both build the identical section prompt.
      let content: string;
      if (provider === "vhs") {
        const out = await invoke<{
          section: string;
          content: string;
          quota: { used: number; limit: number; overage: boolean };
        }>("vhs_hosted_ic_section", { input: icInput });
        content = out.content;
        // Only surface the quota toast on the compile pass so a 5-section run
        // doesn't fire 5 toasts (each section counts server-side regardless).
        if (section === "compile") showToast(formatQuota(out.quota));
      } else {
        const out = await invoke<{ section: string; content: string }>("ic_report_section", {
          input: icInput,
        });
        content = out.content;
      }
      setSections((cur) => ({ ...cur, [section]: content }));
      const idx = activeSections.indexOf(section);
      if (idx >= 0 && idx < activeSections.length - 1) {
        setActiveSection(activeSections[idx + 1]);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(null);
    }
  };

  const canRunSection = (s: IcSection) => {
    if (running) return false;
    if (configuredProviders.length === 0) return false;
    if (s === "compile") {
      // Compile requires all NON-compile sections in the current template to
      // have content. simple-ic only needs founder+market; full-ic needs all 4.
      return activeSections
        .filter((sec) => sec !== "compile")
        .every((sec) => !!sections[sec]);
    }
    if (mode === "url") return url.trim().length > 0;
    if (mode === "text") return text.trim().length > 0;
    return pdfFile !== null;
  };

  const handleCopyCompile = () => {
    if (!sections.compile) return;
    navigator.clipboard.writeText(sections.compile);
    showToast("Memo copied");
  };

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="kn-flow-title">Full IC Report</h2>
      <p className="kn-flow-sub">
        {template === "simple-ic"
          ? "3 passes: Founder → Market → Compile. ~10 minutes."
          : "5 passes: Founder → Market → Traction → Terms → Compile. ~30 minutes."}
      </p>

      <div className="kn-disclaimer">
        ⚠ Draft only — verify against the source before sharing or acting on it.
        LLM output can be subtly wrong or steered by hostile pages.
      </div>

      <div className="kn-flow-row">
        <ProviderPicker
          provider={provider}
          setProvider={setProvider}
          configuredProviders={configuredProviders}
        />
        <label className="kn-label">
          Template
          <select
            className="kn-input kn-input--select"
            value={template}
            onChange={(e) => setTemplate(e.target.value as IcTemplate)}
          >
            {(Object.keys(IC_TEMPLATE_LABELS) as IcTemplate[]).map((t) => (
              <option key={t} value={t}>
                {IC_TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="kn-label">
          Stage
          <select
            className="kn-input kn-input--select"
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
          >
            {(Object.keys(STAGE_LABELS) as Stage[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <SourceInput
        mode={mode}
        setMode={setMode}
        url={url}
        setUrl={setUrl}
        text={text}
        setText={setText}
        pdfFile={pdfFile}
        setPdfFile={setPdfFile}
      />

      <div className="kn-stepper">
        {activeSections.map((s, idx) => {
          const isDone = !!sections[s];
          const isActive = activeSection === s;
          const prevDone = idx > 0 && !!sections[activeSections[idx - 1]];
          return (
            <span key={s} className="kn-step-wrap">
              {idx > 0 && (
                <span
                  className={`kn-step-connector ${
                    prevDone ? "kn-step-connector--done" : ""
                  }`}
                />
              )}
              <button
                className={`kn-step ${isActive ? "kn-step--active" : ""} ${
                  isDone ? "kn-step--done" : ""
                }`}
                onClick={() => setActiveSection(s)}
              >
                <span className="kn-step-num">{isDone ? "✓" : idx + 1}</span>
                <span className="kn-step-label">{IC_LABELS[s]}</span>
              </button>
            </span>
          );
        })}
      </div>

      <div className="kn-section-edit">
        <label className="kn-label kn-label--grow">
          Hints for {IC_LABELS[activeSection]} (optional)
          <input
            type="text"
            className="kn-input"
            value={hints[activeSection]}
            onChange={(e) =>
              setHints((cur) => ({ ...cur, [activeSection]: e.target.value }))
            }
            placeholder={
              activeSection === "founder"
                ? "things the source doesn't say (e.g. previous co. exited)"
                : activeSection === "market"
                  ? "specific incumbents to mention"
                  : activeSection === "traction"
                    ? "what you want spelled out (pipeline, LOIs)"
                    : activeSection === "terms"
                      ? "the asked-for check size"
                      : "tone, voice, length"
            }
          />
        </label>

        <div className="kn-form-actions" style={{ marginTop: 12 }}>
          <button
            className="kn-btn kn-btn--primary"
            onClick={() => runSection(activeSection)}
            disabled={!canRunSection(activeSection)}
          >
            {running === activeSection ? "Drafting…" : sections[activeSection] ? "Re-draft" : "Draft section"}
          </button>
          {activeSection === "compile" && sections.compile && (
            <button className="kn-btn" onClick={handleCopyCompile}>
              Copy memo
            </button>
          )}
        </div>

        {err && running === null && (
          <div className="kn-form-feedback kn-form-feedback--err">✗ {err}</div>
        )}

        {sections[activeSection] !== undefined && (
          <div className="kn-result">
            <h3 className="kn-result-title">{IC_LABELS[activeSection]} · raw</h3>
            <textarea
              className="kn-prose kn-prose--editable"
              value={sections[activeSection] ?? ""}
              onChange={(e) =>
                setSections((cur) => ({ ...cur, [activeSection]: e.target.value }))
              }
              spellCheck={false}
            />
            <h3 className="kn-result-title kn-result-title--secondary">Preview</h3>
            <div className="kn-markdown">
              <MarkdownView source={sections[activeSection] ?? ""} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared form pieces ───────────────────────────────────────────────

function ProviderPicker({
  provider,
  setProvider,
  configuredProviders,
}: {
  provider: Provider;
  setProvider: (p: Provider) => void;
  configuredProviders: Provider[];
}) {
  return (
    <label className="kn-label">
      Run with
      <select
        className="kn-input kn-input--select"
        value={provider}
        onChange={(e) => setProvider(e.target.value as Provider)}
      >
        {(["anthropic", "openai", "gemini", "local", "vhs"] as Provider[]).map((p) => {
          const ok = configuredProviders.includes(p);
          // "vhs" reads "not linked" instead of "not configured" when absent.
          const offLabel = p === "vhs" ? " (not linked)" : " (not configured)";
          return (
            <option key={p} value={p} disabled={!ok}>
              {PROVIDER_LABELS[p]}
              {ok ? "" : offLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export type SourceMode = "url" | "text" | "pdf";

function SourceInput({
  mode,
  setMode,
  url,
  setUrl,
  text,
  setText,
  pdfFile,
  setPdfFile,
}: {
  mode: SourceMode;
  setMode: (m: SourceMode) => void;
  url: string;
  setUrl: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  pdfFile: File | null;
  setPdfFile: (f: File | null) => void;
}) {
  return (
    <div className="kn-source">
      <div className="kn-tabs">
        <button
          className={`kn-tab ${mode === "url" ? "kn-tab--active" : ""}`}
          onClick={() => setMode("url")}
        >
          From URL
        </button>
        <button
          className={`kn-tab ${mode === "text" ? "kn-tab--active" : ""}`}
          onClick={() => setMode("text")}
        >
          From pasted text
        </button>
        <button
          className={`kn-tab ${mode === "pdf" ? "kn-tab--active" : ""}`}
          onClick={() => setMode("pdf")}
        >
          From PDF
        </button>
      </div>

      {mode === "url" && (
        <input
          type="url"
          className="kn-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://acme.com or arxiv.org/abs/..."
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {mode === "pdf" && (
        <div className="kn-pdf-picker">
          <label className="kn-pdf-picker-label">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
            <span className="kn-btn kn-btn--ghost">
              {pdfFile ? "Choose another PDF" : "Choose PDF file…"}
            </span>
          </label>
          {pdfFile && (
            <span className="kn-pdf-filename">
              {pdfFile.name} · {Math.round(pdfFile.size / 1024)} KB
            </span>
          )}
          {!pdfFile && (
            <span className="kn-pdf-hint">
              Pitch deck, white paper, founder one-pager. Text-based PDFs only —
              scanned / image-only PDFs need OCR (not supported yet).
            </span>
          )}
        </div>
      )}
      {mode === "text" && (
        <textarea
          className="kn-input kn-input--textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste website copy, founder bio, deck text…"
          rows={6}
          spellCheck={false}
        />
      )}
    </div>
  );
}

// ─── Settings icon ────────────────────────────────────────────────────

// ─── Template Editor (W3.2 R7) ─────────────────────────────────────────

type EditableTemplate = MemoTemplate | IcTemplate;
type EditableSection = "memo" | IcSection;

const TEMPLATE_SECTIONS: Record<EditableTemplate, EditableSection[]> = {
  "simple-memo": ["memo"],
  "full-memo": ["memo"],
  "simple-ic": ["founder", "market", "compile"],
  "full-ic": ["founder", "market", "traction", "terms", "compile"],
};

const ALL_TEMPLATE_LABELS: Record<EditableTemplate, string> = {
  ...MEMO_TEMPLATE_LABELS,
  ...IC_TEMPLATE_LABELS,
};

const SECTION_LABELS: Record<EditableSection, string> = {
  memo: "Memo body",
  founder: "Founder & Team",
  market: "Market",
  traction: "Product & Traction",
  terms: "Round & Terms",
  compile: "Compiled Memo",
};

function TemplateEditor({
  onBack,
  showToast,
}: {
  onBack: () => void;
  showToast: (m: string) => void;
}) {
  const [template, setTemplate] = useState<EditableTemplate>("simple-memo");
  const [section, setSection] = useState<EditableSection>("memo");
  const [draft, setDraft] = useState(() => getCustomPrompt("simple-memo", "memo"));

  // Sync draft when template / section changes.
  useEffect(() => {
    setDraft(getCustomPrompt(template, section));
  }, [template, section]);

  // Reset section to first available when template changes.
  useEffect(() => {
    const sections = TEMPLATE_SECTIONS[template];
    if (!sections.includes(section)) {
      setSection(sections[0]);
    }
  }, [template, section]);

  const sections = TEMPLATE_SECTIONS[template];
  const hasOverride = getCustomPrompt(template, section).length > 0;

  const handleSave = () => {
    setCustomPrompt(template, section, draft);
    showToast(
      draft.trim() ? `Saved override for ${template} / ${section}` : `Cleared override for ${template} / ${section}`,
    );
  };

  const handleReset = () => {
    setCustomPrompt(template, section, "");
    setDraft("");
    showToast(`Reset ${template} / ${section} to default`);
  };

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onBack}>
        ← Back to Settings
      </button>
      <h2 className="kn-flow-title">Template Editor</h2>
      <p className="kn-flow-sub">
        Override the built-in prompt for any template / section combination.
        Leave blank to use the default. The override replaces the structure
        block; source / hints / prior_sections wiring stays intact.
      </p>

      <div className="kn-flow-row">
        <label className="kn-label">
          Template
          <select
            className="kn-input kn-input--select"
            value={template}
            onChange={(e) => setTemplate(e.target.value as EditableTemplate)}
          >
            {(Object.keys(ALL_TEMPLATE_LABELS) as EditableTemplate[]).map((t) => (
              <option key={t} value={t}>
                {ALL_TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="kn-label">
          Section
          <select
            className="kn-input kn-input--select"
            value={section}
            onChange={(e) => setSection(e.target.value as EditableSection)}
          >
            {sections.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="kn-label kn-label--grow">
        Custom prompt {hasOverride && <span className="kn-pill">override active</span>}
        <textarea
          className="kn-input kn-input--textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave blank to use the built-in template prompt. When non-empty, this REPLACES the section body — the source, prior sections, hints, security warning, and stage guidance still wrap automatically."
          rows={14}
          spellCheck={false}
        />
      </label>

      <div className="kn-form-actions" style={{ marginTop: 14 }}>
        <button className="kn-btn kn-btn--primary" onClick={handleSave}>
          Save override
        </button>
        {hasOverride && (
          <button className="kn-btn" onClick={handleReset}>
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Templates hub (wave 3.3 — browse / edit / generate) ──────────────

function TemplateGallery({
  onBack,
  configuredProviders,
  showToast,
  initialTemplateId,
  clearInitialTemplate,
  refreshTemplates,
  refreshReports,
  onSavedReport,
}: {
  onBack: () => void;
  configuredProviders: Provider[];
  showToast: (m: string) => void;
  // When the sidebar Templates list is clicked, the gallery jumps straight to
  // the generate flow for that template id. Cleared once consumed.
  initialTemplateId?: string | null;
  clearInitialTemplate?: () => void;
  // Keep the App-root template + report lists (and the sidebar) in sync.
  refreshTemplates?: () => void;
  refreshReports?: () => Promise<void>;
  onSavedReport?: (id: string) => void;
}) {
  const [mode, setMode] = useState<"browse" | "edit" | "generate">("browse");
  const [templates, setTemplates] = useState<Template[]>(() => getAllTemplates());
  const [selectedId, setSelectedId] = useState<string>(
    initialTemplateId ?? templates[0]?.id ?? "",
  );
  const [editDraft, setEditDraft] = useState<Template | null>(null);

  const refresh = useCallback(() => {
    setTemplates(getAllTemplates());
    refreshTemplates?.();
  }, [refreshTemplates]);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];
  const firmLogo = getFirmLogo();

  // Sidebar deep-link: open straight into the generate flow for the requested
  // template, then clear the pending id so a later browse doesn't re-trigger.
  useEffect(() => {
    if (initialTemplateId) {
      setSelectedId(initialTemplateId);
      setMode("generate");
      clearInitialTemplate?.();
    }
  }, [initialTemplateId, clearInitialTemplate]);

  if (mode === "edit" && editDraft) {
    return (
      <TemplateDesigner
        initial={editDraft}
        onSave={(t) => {
          saveCustomTemplate(t);
          refresh();
          setSelectedId(t.id);
          showToast("Template saved");
        }}
        onClose={() => {
          setMode("browse");
          refresh();
        }}
      />
    );
  }

  if (mode === "generate" && selected) {
    return (
      <GenerateFromTemplate
        template={selected}
        configuredProviders={configuredProviders}
        showToast={showToast}
        onClose={() => setMode("browse")}
        refreshReports={refreshReports}
        onSavedReport={onSavedReport}
      />
    );
  }

  const openEdit = () => {
    if (!selected) return;
    setEditDraft(isStarter(selected.id) ? duplicateTemplate(selected) : selected);
    setMode("edit");
  };

  const handleDelete = () => {
    if (!selected) return;
    deleteCustomTemplate(selected.id);
    const next = getAllTemplates();
    setTemplates(next);
    setSelectedId(next[0]?.id ?? "");
    refreshTemplates?.();
    showToast("Template deleted");
  };

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="kn-flow-title">Report templates</h2>
      <p className="kn-flow-sub">
        Every report is built from blocks — each block holds its own layout,
        style, and the prompt that fills it. Browse a layout, edit it, or
        generate a report from it.
      </p>

      <div className="kn-tpl-tabs">
        {templates.map((t) => (
          <button
            key={t.id}
            className={`kn-tpl-tab ${t.id === selectedId ? "kn-tpl-tab--active" : ""}`}
            onClick={() => setSelectedId(t.id)}
          >
            <span className="kn-tpl-tab-name">{t.name}</span>
            <span className="kn-tpl-tab-meta">
              {isStarter(t.id) ? "starter" : "custom"} · {t.blocks.length} blocks
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="kn-tpl-actionbar">
            <span className="kn-tpl-desc">{selected.description}</span>
            <div className="kn-tpl-actions">
              <button className="kn-btn kn-btn--primary" onClick={() => setMode("generate")}>
                Generate a report
              </button>
              <button className="kn-btn" onClick={openEdit}>
                {isStarter(selected.id) ? "Duplicate & edit" : "Edit"}
              </button>
              {!isStarter(selected.id) && (
                <button className="kn-btn" onClick={handleDelete}>
                  Delete
                </button>
              )}
            </div>
          </div>

          <div className="kn-tpl-page">
            {selected.blocks.map((b) => (
              <BlockView key={b.id} block={b} firmLogo={firmLogo} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Generate a report from a template (walks the blocks) ─────────────

function GenerateFromTemplate({
  template,
  configuredProviders,
  showToast,
  onClose,
  refreshReports,
  onSavedReport,
}: {
  template: Template;
  configuredProviders: Provider[];
  showToast: (m: string) => void;
  onClose: () => void;
  // P1: after a save, refresh the App-root report list (sidebar) and
  // optionally open the freshly-saved report in the read-only viewer.
  refreshReports?: () => Promise<void>;
  onSavedReport?: (id: string) => void;
}) {
  const cloudFirst = configuredProviders.find((p) => p !== "local") ?? configuredProviders[0];
  const [provider, setProvider] = useState<Provider>(cloudFirst ?? "anthropic");
  const [mode, setMode] = useState<SourceMode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [compiled, setCompiled] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // P1 save state: idle → saving → saved. Resets to idle on every fresh run
  // so a re-generate offers a fresh save.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const genBlocks = template.blocks.filter((b) => b.content.mode === "generated");
  const firmLogo = getFirmLogo();
  const hasLogoBlock = template.blocks.some((b) => b.type === "logo");

  const canRun =
    configuredProviders.length > 0 &&
    !running &&
    (mode === "url"
      ? url.trim().length > 0
      : mode === "text"
        ? text.trim().length > 0
        : pdfFile !== null);

  const compile = (resById: Record<string, string>): string =>
    template.blocks
      .map((b) => {
        if (b.content.mode === "static") {
          if (b.type === "divider") return "---";
          if (b.type === "logo") return "";
          return b.content.text;
        }
        const c = (resById[b.id] ?? "").trim();
        if (!c) return "";
        if (b.type === "heading" || b.type === "cover") return `# ${c}`;
        return `## ${b.label}\n\n${c}`;
      })
      .filter((s) => s.trim().length > 0)
      .join("\n\n");

  const handleRun = async () => {
    setRunning(true);
    setErr(null);
    setResults({});
    setCompiled(null);
    setSaveState("idle");
    try {
      let pdfB64: string | null = null;
      if (mode === "pdf" && pdfFile) pdfB64 = await fileToBase64(pdfFile);
      const sourceText = await invoke<string>("gather_source", {
        url: mode === "url" ? url.trim() : null,
        seedText: mode === "text" ? text.trim() : null,
        pdfBase64: pdfB64,
      });

      const acc: Record<string, string> = {};
      let prior = "";
      for (const b of genBlocks) {
        if (b.content.mode !== "generated") continue;
        setRunningId(b.id);
        const content = await invoke<string>("generate_block", {
          input: {
            provider,
            source_text: sourceText,
            prompt: b.content.prompt,
            prior_context: prior || null,
            note: note.trim() || null,
          },
        });
        acc[b.id] = content;
        setResults({ ...acc });
        prior += `## ${b.label}\n${content.slice(0, 300)}\n\n`;
      }
      setRunningId(null);
      setCompiled(compile(acc));
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
      setRunningId(null);
    }
  };

  const handleCopy = () => {
    if (!compiled) return;
    navigator.clipboard.writeText(compiled);
    showToast("Report copied");
  };

  // Derive a human title from the first markdown heading, else the template
  // name + date. Keeps the sidebar list scannable without asking the user.
  const deriveTitle = (md: string): string => {
    const heading = md
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^#{1,3}\s+\S/.test(l));
    if (heading) return heading.replace(/^#{1,3}\s+/, "").slice(0, 80);
    return `${template.name} · ${new Date().toLocaleDateString()}`;
  };

  const handleSave = async () => {
    if (!compiled) return;
    setSaveState("saving");
    try {
      const id = newReportId();
      await saveReport({
        id,
        title: deriveTitle(compiled),
        templateId: template.id,
        templateName: template.name,
        provider,
        createdAt: Date.now(),
        markdown: compiled,
        blocks: results,
      });
      await refreshReports?.();
      setSaveState("saved");
      showToast("Report saved");
      onSavedReport?.(id);
    } catch (e) {
      setSaveState("idle");
      showToast(`Save failed: ${String(e)}`);
    }
  };

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onClose}>
        ← Back to templates
      </button>
      <h2 className="kn-flow-title">Generate · {template.name}</h2>
      <p className="kn-flow-sub">
        {genBlocks.length} sections will be written from your source, one block
        at a time.
      </p>

      <div className="kn-disclaimer">
        ⚠ Draft only — verify against the source before sharing or acting on it.
        LLM output can be subtly wrong or steered by hostile pages.
      </div>

      <div className="kn-flow-row">
        <ProviderPicker
          provider={provider}
          setProvider={setProvider}
          configuredProviders={configuredProviders}
        />
      </div>

      <SourceInput
        mode={mode}
        setMode={setMode}
        url={url}
        setUrl={setUrl}
        text={text}
        setText={setText}
        pdfFile={pdfFile}
        setPdfFile={setPdfFile}
      />

      <label className="kn-label kn-label--grow">
        Note for the reader (optional)
        <input
          type="text"
          className="kn-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="things the source doesn't say"
        />
      </label>

      <div className="kn-form-actions" style={{ marginTop: 18 }}>
        <button className="kn-btn kn-btn--primary" onClick={handleRun} disabled={!canRun}>
          {running ? "Generating…" : "Generate report"}
        </button>
        {compiled && (
          <>
            <button
              className="kn-btn"
              onClick={handleSave}
              disabled={saveState === "saving"}
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "✓ Saved"
                  : "Save report"}
            </button>
            <button className="kn-btn" onClick={handleCopy}>
              Copy report
            </button>
          </>
        )}
      </div>

      {err && <div className="kn-form-feedback kn-form-feedback--err">✗ {err}</div>}

      {(running || Object.keys(results).length > 0) && (
        <div className="kn-gen-progress">
          {genBlocks.map((b) => {
            const state =
              results[b.id] !== undefined
                ? "done"
                : runningId === b.id
                  ? "run"
                  : "wait";
            return (
              <div key={b.id} className={`kn-gen-step kn-gen-step--${state}`}>
                <span className="kn-gen-dot" />
                {b.label}
                {state === "run" && <span className="kn-gen-run"> · drafting…</span>}
              </div>
            );
          })}
        </div>
      )}

      {compiled && (
        <div className="kn-result">
          <h3 className="kn-result-title">{template.name}</h3>
          <div className="kn-markdown">
            {firmLogo && hasLogoBlock && (
              <img
                src={firmLogo.dataUrl}
                alt=""
                className="kn-tpl-logo-img"
                style={{ marginBottom: 16 }}
              />
            )}
            <MarkdownView source={compiled} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Read-only report viewer (P1 keystone) ────────────────────────────
//
// Loads a saved report from the Tauri fs by id and renders its compiled
// markdown read-only, reusing MarkdownView + the firm-logo render path from
// GenerateFromTemplate. This is what makes saved reports a durable workspace
// artefact rather than transient component state.

function ReportViewer({
  reportId,
  onBack,
  onDelete,
  showToast,
}: {
  reportId: string | null;
  onBack: () => void;
  onDelete: (id: string) => void;
  showToast: (m: string) => void;
}) {
  const [report, setReport] = useState<SavedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const firmLogo = getFirmLogo();

  useEffect(() => {
    let cancelled = false;
    if (!reportId) {
      setReport(null);
      setLoading(false);
      setNotFound(true);
      return;
    }
    setLoading(true);
    setNotFound(false);
    getReport(reportId)
      .then((r) => {
        if (cancelled) return;
        if (r) setReport(r);
        else setNotFound(true);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const handleCopy = () => {
    if (!report) return;
    navigator.clipboard.writeText(report.markdown);
    showToast("Report copied");
  };

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onBack}>
        ← Back
      </button>

      {loading && <p className="kn-flow-sub">Loading report…</p>}

      {!loading && notFound && (
        <div className="kn-form-feedback kn-form-feedback--err">
          ✗ This report could not be found — it may have been deleted.
        </div>
      )}

      {!loading && report && (
        <>
          <h2 className="kn-flow-title">{report.title}</h2>
          <p className="kn-flow-sub">
            {report.templateName || "report"}
            {report.provider ? ` · ${PROVIDER_LABELS[report.provider as Provider] ?? report.provider}` : ""}
            {report.createdAt ? ` · ${new Date(report.createdAt).toLocaleString()}` : ""}
          </p>

          <div className="kn-form-actions" style={{ marginBottom: 8 }}>
            <button className="kn-btn" onClick={handleCopy}>
              Copy report
            </button>
            <button className="kn-btn" onClick={() => onDelete(report.id)}>
              Delete
            </button>
          </div>

          <div className="kn-result" style={{ borderTop: "none", paddingTop: 0 }}>
            <div className="kn-markdown">
              {firmLogo && (
                <img
                  src={firmLogo.dataUrl}
                  alt=""
                  className="kn-tpl-logo-img"
                  style={{ marginBottom: 16 }}
                />
              )}
              <MarkdownView source={report.markdown} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default App;
