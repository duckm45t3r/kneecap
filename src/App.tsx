import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// ─── Types ────────────────────────────────────────────────────────────

type View = "home" | "settings" | "quickmemo" | "icreport";
type Provider = "anthropic" | "openai" | "local";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; provider: Provider }
  | { kind: "error"; provider: Provider; message: string };

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local (Ollama)",
};

const PROVIDER_HINTS: Record<Exclude<Provider, "local">, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
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

// ─── App shell ────────────────────────────────────────────────────────

function App() {
  const [view, setView] = useState<View>("home");
  const [toast, setToast] = useState<string | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState<Provider[]>([]);

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
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const hasAnyKey = configuredProviders.length > 0;
  const headerSubtitle = useMemo(() => {
    const cloud = configuredProviders.filter((p) => p !== "local");
    const hasLocal = configuredProviders.includes("local");
    if (cloud.length === 0 && !hasLocal) return null;
    const parts = [
      ...cloud.map((p) => PROVIDER_LABELS[p]),
      ...(hasLocal ? [PROVIDER_LABELS.local] : []),
    ];
    return `${parts.join(" · ")} connected`;
  }, [configuredProviders]);

  return (
    <div className="kn-app">
      <header className="kn-header">
        <button className="kn-logo" onClick={() => setView("home")} title="Home">
          KN33C4P
        </button>
        <div className="kn-header-spacer" />
        <button
          className="kn-icon-btn"
          onClick={() => setView("settings")}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </header>

      <main className="kn-main">
        {view === "home" && (
          <Home
            hasAnyKey={hasAnyKey}
            onOpenSettings={() => setView("settings")}
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
            onBack={() => setView("home")}
            configuredProviders={configuredProviders}
            refresh={refreshProviders}
            showToast={showToast}
          />
        )}
        {view === "quickmemo" && (
          <QuickMemo
            onBack={() => setView("home")}
            configuredProviders={configuredProviders}
            showToast={showToast}
          />
        )}
        {view === "icreport" && (
          <IcReport
            onBack={() => setView("home")}
            configuredProviders={configuredProviders}
            showToast={showToast}
          />
        )}
      </main>

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
}: {
  hasAnyKey: boolean;
  onPick: (target: View) => void;
  onOpenSettings: () => void;
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

        <div className="kn-card kn-card--ghost" aria-disabled="true">
          <div className="kn-card-emoji" style={{ opacity: 0.4 }}>·</div>
          <div className="kn-card-title" style={{ opacity: 0.6 }}>
            More tools coming
          </div>
          <div className="kn-card-body" style={{ opacity: 0.55 }}>
            Format learning, voice training, batch screening.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────

function Settings({
  onBack,
  configuredProviders,
  refresh,
  showToast,
}: {
  onBack: () => void;
  configuredProviders: Provider[];
  refresh: () => Promise<void>;
  showToast: (m: string) => void;
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
          machine. All three are live except VHS-hosted billing.
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

        <VhsHostedOption />
      </section>

      <section className="kn-section">
        <h3 className="kn-section-title">Format Learning</h3>
        <p className="kn-section-body">
          Drop a few of your firm&apos;s past memos and KN33C4P picks up the
          house format. Wiring up in W2.6.
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
  const [provider, setProvider] = useState<Exclude<Provider, "local">>("anthropic");
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
    try {
      await invoke<string>("test_connection", { provider });
      setTest({ kind: "ok", provider });
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
                setProvider(e.target.value as Exclude<Provider, "local">);
                setTest({ kind: "idle" });
              }}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
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
            ✓ {PROVIDER_LABELS[test.provider]} responded
          </div>
        )}
        {test.kind === "error" && (
          <div className="kn-form-feedback kn-form-feedback--err">✗ {test.message}</div>
        )}
      </div>

      <div className="kn-key-list">
        {(["anthropic", "openai"] as const).map((p) => (
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
    try {
      await invoke<string>("test_local_connection");
      setTest({ kind: "ok", provider: "local" });
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
          <div className="kn-form-feedback kn-form-feedback--ok">✓ Ollama responded</div>
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

// ─── VHS-hosted option (C — server-side not deployed) ─────────────────

function VhsHostedOption() {
  return (
    <div className="kn-option kn-option--disabled">
      <div className="kn-option-title">
        <span className="kn-tag">C</span> VHS-hosted
        <span className="kn-pill">Billing endpoint W2.5</span>
      </div>
      <div className="kn-option-body">
        $2 per finished IC report. Stripe metered billing on your VHS account.
        Server-side metered billing not deployed yet — pick A or B for now.
      </div>
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
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [memo, setMemo] = useState<string | null>(null);
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    configuredProviders.length > 0 &&
    !running &&
    (mode === "url" ? url.trim().length > 0 : text.trim().length > 0);

  const handleRun = async () => {
    setRunning(true);
    setMemo(null);
    setExcerpt(null);
    setErr(null);
    try {
      const out = await invoke<{ memo: string; source_excerpt: string }>("quick_memo", {
        input: {
          provider,
          url: mode === "url" ? url.trim() : null,
          seed_text: mode === "text" ? text.trim() : null,
          note: note.trim() || null,
        },
      });
      setMemo(out.memo);
      setExcerpt(out.source_excerpt);
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

      <ProviderPicker
        provider={provider}
        setProvider={setProvider}
        configuredProviders={configuredProviders}
      />

      <SourceInput
        mode={mode}
        setMode={setMode}
        url={url}
        setUrl={setUrl}
        text={text}
        setText={setText}
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
          <h3 className="kn-result-title">Memo</h3>
          <textarea
            className="kn-prose kn-prose--editable"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            spellCheck={false}
          />
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
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
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

  const runSection = async (section: IcSection) => {
    setRunning(section);
    setErr(null);
    try {
      const prior: IcSectionResult[] = IC_SECTIONS.filter(
        (s) => s !== "compile" && s !== section && sections[s]
      ).map((s) => ({ section: s, content: sections[s]! }));

      const out = await invoke<{ section: string; content: string }>("ic_report_section", {
        input: {
          provider,
          section,
          url: mode === "url" ? url.trim() : null,
          seed_text: mode === "text" ? text.trim() : null,
          hints: hints[section] || null,
          prior_sections: prior,
        },
      });
      setSections((cur) => ({ ...cur, [section]: out.content }));
      const idx = IC_SECTIONS.indexOf(section);
      if (idx >= 0 && idx < IC_SECTIONS.length - 1) {
        setActiveSection(IC_SECTIONS[idx + 1]);
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
      return (["founder", "market", "traction", "terms"] as IcSection[]).every(
        (sec) => !!sections[sec]
      );
    }
    return mode === "url" ? url.trim().length > 0 : text.trim().length > 0;
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
        Five passes: Founder → Market → Traction → Terms → Compile. Each pass
        sees the prior ones. About 30 minutes total.
      </p>

      <ProviderPicker
        provider={provider}
        setProvider={setProvider}
        configuredProviders={configuredProviders}
      />

      <SourceInput
        mode={mode}
        setMode={setMode}
        url={url}
        setUrl={setUrl}
        text={text}
        setText={setText}
      />

      <div className="kn-stepper">
        {IC_SECTIONS.map((s) => (
          <button
            key={s}
            className={`kn-step ${activeSection === s ? "kn-step--active" : ""} ${
              sections[s] ? "kn-step--done" : ""
            }`}
            onClick={() => setActiveSection(s)}
          >
            <span className="kn-step-dot" />
            {IC_LABELS[s]}
          </button>
        ))}
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
            <h3 className="kn-result-title">{IC_LABELS[activeSection]}</h3>
            <textarea
              className="kn-prose kn-prose--editable"
              value={sections[activeSection] ?? ""}
              onChange={(e) =>
                setSections((cur) => ({ ...cur, [activeSection]: e.target.value }))
              }
              spellCheck={false}
            />
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
        {(["anthropic", "openai", "local"] as Provider[]).map((p) => {
          const ok = configuredProviders.includes(p);
          return (
            <option key={p} value={p} disabled={!ok}>
              {PROVIDER_LABELS[p]}
              {ok ? "" : " (not configured)"}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function SourceInput({
  mode,
  setMode,
  url,
  setUrl,
  text,
  setText,
}: {
  mode: "url" | "text";
  setMode: (m: "url" | "text") => void;
  url: string;
  setUrl: (v: string) => void;
  text: string;
  setText: (v: string) => void;
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
      </div>

      {mode === "url" ? (
        <input
          type="url"
          className="kn-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://acme.com or arxiv.org/abs/..."
          autoComplete="off"
          spellCheck={false}
        />
      ) : (
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
