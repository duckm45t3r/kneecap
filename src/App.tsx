import { useState } from "react";
import "./App.css";

type View = "home" | "settings";

function App() {
  const [view, setView] = useState<View>("home");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  return (
    <div className="kn-app">
      <header className="kn-header">
        <button
          className="kn-logo"
          onClick={() => setView("home")}
          title="Home"
        >
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
          <Home onPick={(t) => showToast(`${t} — wiring up in W2`)} />
        ) : (
          <Settings onBack={() => setView("home")} />
        )}
      </main>

      <footer className="kn-footer">
        <span className="kn-footer-text">
          made with my knees · <a href="https://vhs.capital" target="_blank" rel="noreferrer">vhs.capital</a>
        </span>
        <span className="kn-status">
          <span className="kn-status-dot kn-status-dot--off" />
          no LLM connected
        </span>
      </footer>

      {toast && <div className="kn-toast">{toast}</div>}
    </div>
  );
}

function Home({ onPick }: { onPick: (which: string) => void }) {
  return (
    <div className="kn-home">
      <h1 className="kn-hero-title">Desktop IC copilot for VHS</h1>
      <p className="kn-hero-sub">
        Pick a flow. Connect an LLM in Settings to start.
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

function Settings({ onBack }: { onBack: () => void }) {
  return (
    <div className="kn-settings">
      <button className="kn-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="kn-settings-title">Settings</h2>

      <section className="kn-section">
        <h3 className="kn-section-title">LLM Connection</h3>
        <p className="kn-section-body">
          Pick how KN33C4P talks to a model. Wiring up in W2.
        </p>

        <div className="kn-option">
          <div className="kn-option-title">
            <span className="kn-tag">A</span> Bring your own key
          </div>
          <div className="kn-option-body">
            Anthropic / OpenAI API key stays local. Costs metered to your account.
          </div>
        </div>

        <div className="kn-option">
          <div className="kn-option-title">
            <span className="kn-tag">B</span> Local model
          </div>
          <div className="kn-option-body">
            llama.cpp / Ollama on your machine. Zero outbound. Slower.
          </div>
        </div>

        <div className="kn-option">
          <div className="kn-option-title">
            <span className="kn-tag">C</span> VHS-hosted
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
