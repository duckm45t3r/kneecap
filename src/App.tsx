import { useState } from "react";
import "./App.css";

type View = "home" | "settings";
type Provider = "anthropic" | "openai";

type ApiKeys = Partial<Record<Provider, string>>;

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; provider: Provider }
  | { kind: "error"; provider: Provider; message: string };

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const PROVIDER_HINTS: Record<Provider, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
};

function App() {
  const [view, setView] = useState<View>("home");
  const [toast, setToast] = useState<string | null>(null);
  // W2.1: in-memory only. W2.2 swaps this for macOS Keychain via Tauri.
  const [keys, setKeys] = useState<ApiKeys>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const saveKey = (provider: Provider, value: string) => {
    setKeys((k) => ({ ...k, [provider]: value }));
    showToast(`${PROVIDER_LABELS[provider]} key saved`);
  };

  const removeKey = (provider: Provider) => {
    setKeys(({ [provider]: _drop, ...rest }) => rest);
    showToast(`${PROVIDER_LABELS[provider]} key removed`);
  };

  const connectedProviders = (Object.keys(keys) as Provider[]).filter((p) => keys[p]);
  const hasAnyKey = connectedProviders.length > 0;

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
        {view === "home" ? (
          <Home
            onPick={(t) =>
              hasAnyKey
                ? showToast(`${t} — wiring up in W2`)
                : showToast("Connect an LLM in Settings first")
            }
            hasAnyKey={hasAnyKey}
            onOpenSettings={() => setView("settings")}
          />
        ) : (
          <Settings
            onBack={() => setView("home")}
            keys={keys}
            onSaveKey={saveKey}
            onRemoveKey={removeKey}
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
          {hasAnyKey
            ? `${connectedProviders.map((p) => PROVIDER_LABELS[p]).join(" · ")} connected`
            : "no LLM connected"}
        </span>
      </footer>

      {toast && <div className="kn-toast">{toast}</div>}
    </div>
  );
}

function Home({
  onPick,
  hasAnyKey,
  onOpenSettings,
}: {
  onPick: (which: string) => void;
  hasAnyKey: boolean;
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
        <button
          className="kn-card kn-card--gold"
          onClick={() => onPick("Quick Memo")}
        >
          <div className="kn-card-emoji">⚡</div>
          <div className="kn-card-title">Quick Memo</div>
          <div className="kn-card-body">
            Drop a URL or company name. Out comes a 2-page memo in your firm&apos;s
            voice. ~5 min.
          </div>
        </button>

        <button
          className="kn-card kn-card--teal"
          onClick={() => onPick("Full IC Report")}
        >
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

function Settings({
  onBack,
  keys,
  onSaveKey,
  onRemoveKey,
}: {
  onBack: () => void;
  keys: ApiKeys;
  onSaveKey: (p: Provider, value: string) => void;
  onRemoveKey: (p: Provider) => void;
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
          Pick how KN33C4P talks to a model. Only path A is wired so far.
        </p>

        <ByoKeyOption keys={keys} onSaveKey={onSaveKey} onRemoveKey={onRemoveKey} />

        <div className="kn-option kn-option--disabled">
          <div className="kn-option-title">
            <span className="kn-tag">B</span> Local model
            <span className="kn-pill">Coming W2.3</span>
          </div>
          <div className="kn-option-body">
            llama.cpp / Ollama on your machine. Zero outbound. Slower.
          </div>
        </div>

        <div className="kn-option kn-option--disabled">
          <div className="kn-option-title">
            <span className="kn-tag">C</span> VHS-hosted
            <span className="kn-pill">Coming W2.4</span>
          </div>
          <div className="kn-option-body">
            $2 per finished IC report. Stripe metered billing.
          </div>
        </div>
      </section>

      <section className="kn-section">
        <h3 className="kn-section-title">Format Learning</h3>
        <p className="kn-section-body">
          Drop a few of your firm&apos;s past memos and KN33C4P picks up the
          house format. Wiring up in W2.
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

function ByoKeyOption({
  keys,
  onSaveKey,
  onRemoveKey,
}: {
  keys: ApiKeys;
  onSaveKey: (p: Provider, v: string) => void;
  onRemoveKey: (p: Provider) => void;
}) {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [draft, setDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [pendingRemove, setPendingRemove] = useState<Provider | null>(null);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSaveKey(provider, trimmed);
    setDraft("");
    setTest({ kind: "idle" });
  };

  const handleTest = async () => {
    const k = keys[provider];
    if (!k) return;
    setTest({ kind: "testing" });
    // W2.1 stub: pretend a 600ms latency + always-OK. W2.2 swaps with real
    // Anthropic /v1/messages or OpenAI hello-world call via Tauri.
    await new Promise((r) => setTimeout(r, 600));
    setTest({ kind: "ok", provider });
  };

  const handleRemove = (p: Provider) => {
    if (pendingRemove === p) {
      onRemoveKey(p);
      setPendingRemove(null);
      setTest({ kind: "idle" });
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
        Anthropic / OpenAI API key stays on this Mac (W2.2: macOS Keychain).
        Costs metered to your account.
      </div>

      {/* Form: provider + input + actions */}
      <div className="kn-form">
        <div className="kn-form-row">
          <label className="kn-label">
            Provider
            <select
              className="kn-input kn-input--select"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as Provider);
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
            disabled={!draft.trim()}
          >
            Save key
          </button>
          <button
            className="kn-btn"
            onClick={handleTest}
            disabled={!keys[provider] || test.kind === "testing"}
            title={!keys[provider] ? "Save a key first" : ""}
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
          <div className="kn-form-feedback kn-form-feedback--err">
            ✗ {test.message}
          </div>
        )}
      </div>

      {/* Status: connected providers */}
      <div className="kn-key-list">
        {(["anthropic", "openai"] as Provider[]).map((p) => (
          <div key={p} className="kn-key-row">
            <span className="kn-key-name">{PROVIDER_LABELS[p]}</span>
            {keys[p] ? (
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
