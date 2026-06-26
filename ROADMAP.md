# KN33C4P Roadmap

KN33C4P is the desktop IC copilot for VHS — a Tauri 2 + React 19 + Rust app
that turns a URL / pasted text / PDF into a screening memo or a full IC report.
It runs against your own LLM key, a local Ollama model, or the VHS-hosted model.

This file is the single source of truth for what is built, what is on a branch,
and what is next. It uses one taxonomy: **W1 through W5**.

> ⚠️ **2026-06-26: the W3/W4/W5 sections below are partly superseded.** The
> 2026-06-25/26 work (deals + version history in local SQLite, per-report hosted
> billing with a $20 backend ceiling + no-dollars gauge, hosted multi-PDF via the
> presigned/Supabase path, Nvidia/Nemotron, Keychain lazy-load, Format Learning,
> PDF/DOCX export) is captured accurately in **[`STATE_2026-06-26.md`](STATE_2026-06-26.md)** —
> read that for the current truth. Notably the old "$42 / 20 reports / $2 overage"
> model and the "`/generate` is a stub" / "Format Learning not built" notes below
> are **out of date**.

---

## Why the wave numbers were a mess (and what we use now)

Three different naming systems grew up around this project. They all describe
the same work; they just disagree on the labels:

1. **The design doc** (`VHS_REVAMP_WAVE2_KNEECAP_DESIGN.md`) called the *entire
   app* "Wave 2" of the VHS platform revamp, then sliced it into calendar weeks
   **W1–W10** and lettered **Workstreams G / H / I / J / K** (G = shell,
   H = LLM connections, I = format learning, J = VHS platform integration,
   K = deal-flow sync).
2. **Git branches and the memory log** used "wave 3.1 / 3.2 / 3.3 / 4.1" — these
   were implementation sprints that don't line up 1:1 with the design doc weeks.
3. **The hosted-billing piece** got labelled three different ways over time:
   "W2.5" (in the old `lib.rs` stub and the locked Settings card), "H3" (in the
   design doc), and "W6 / Workstream J" (in the design doc's week plan).

None of that is wrong, it's just three maps of the same territory. **Going
forward, ignore all of the above and use the W1–W5 taxonomy below.** When you
see an old "W2.5" or "wave 3.3" reference in a commit message or comment, map it
here.

| Old label(s)                         | New |
|--------------------------------------|-----|
| Workstream G, "wave 1", "W1 main UI" | W1  |
| Workstream H (BYO + local), "wave 2" | W1·W2 |
| "wave 3.1 / 3.2 / 3.3", Workstream I | W3  |
| "W2.5", "H3", Workstream J, hosted billing | W4 |
| "W6", signing / notarize / update    | W5  |

---

## W1 · W2 — Core product — **DONE (on `main`)**

The shippable single-user product. Everything here is merged to `main` and
deployed in the private builds Wei runs.

- App shell: header, sidebar, four primary views (Home, Quick Memo, IC Report,
  Templates) + Settings + read-only Report viewer.
- **Bring-your-own key**, stored in the macOS Keychain (never a config file):
  Anthropic, OpenAI, Gemini. Real connection test (8-token hello) per provider.
- **Local model** via Ollama (localhost / private-LAN only, SSRF-gated).
- Source ingestion: URL fetch (4-layer SSRF defence + HTML strip + entity
  decode + prompt-injection neutralisation), pasted text, PDF text extract.
- Quick Memo (simple / full templates) and Full IC Report (founder → market →
  traction → terms → compile, section-by-section with prior-section threading).
- PDF export, security hardening, four built-in templates, prompt-override
  editor, auto charts (recharts from LLM-emitted ```chart blocks), and the IC
  augments A1–A8 (stage guidance, comparables, pre-mortem, conditional gates,
  PROBE next-steps, etc.).

---

## W3 — Workspace layer — **BUILT, awaiting Tauri verify**

On branches `kneecap-wave3-3-template-designer` and
`kneecap-p1-sidebar-persistence` (the latter is the tip of the current stack;
W4/W5 branch off it). Built and type-checks/compiles; not yet runtime-verified
in `cargo tauri dev`.

- Visual template designer (drag-drop blocks, per-block prompts).
- Firm-logo upload (PNG / SVG).
- Template-driven generation: walk a template's blocks, generate each, thread
  prior output for continuity (`gather_source` + `generate_block`).
- **P1 sidebar**: persistent left nav listing saved reports + templates.
- Report-save-to-filesystem (Tauri app-data dir, path-traversal-sanitised ids).

**Open in W3:**
- Template-save-to-filesystem ("Phase D" — templates still live in
  localStorage; migrate them to the fs like reports).
- Format Learning (upload 3–5 past memos → extract house voice → template). The
  Settings card is a stub; the pipeline is designed in the doc (Workstream I)
  but not built.

---

## W4 — Hosted API & billing — **THIS WORK (desktop side done on `kneecap-w4-w5`)**

The VHS-hosted model: the user pays VHS ($42/mo subscription, 20 hosted reports
included, $2/overage), and the desktop relays its built prompts through a VHS
server endpoint that calls Anthropic with VHS's key. **No user API key is needed
for hosted mode.**

**Server side — BUILT (parallel agent, `vhs-platform` repo):**
- `POST /api/kneecap/auth/device-code` — start OAuth device-code flow.
- `POST /api/kneecap/auth/poll` — poll until approved; returns `kc_` bearer
  token (180-day TTL).
- `POST /api/kneecap/auth/verify` — browser-side approval after login +
  subscription gate (`/kneecap/verify` page).
- `POST /api/kneecap/generate` — Bearer-authed hosted LLM proxy + quota check.
  Currently a **stub** that returns `{ status: "not_implemented", quota }`; the
  Anthropic relay + Stripe metered $2-overage are the remaining server TODO.

**Desktop side — BUILT (this branch):**
- Device-bind: `vhs_request_device_code` (mints a per-bind client secret, opens
  the browser to the verify URL) + `vhs_poll_device` (polls, stores the bearer
  token in the Keychain on approval). Settings card shows the 6-char user code,
  the bind flow, and a "Linked" state with Unlink.
- Hosted generate: `vhs_hosted_memo` / `vhs_hosted_ic_section` build the
  **identical** memo / IC prompt the BYO path builds (`build_memo_prompt` /
  `ic_section_prompt` are shared) and POST to `/api/kneecap/generate` with the
  bearer token. Quota tail surfaced as a toast.
- "VHS-hosted" is a selectable provider in Quick Memo and IC Report alongside
  BYO + Local. BYO + Local are unchanged.

**Open in W4 (server-side, not desktop):**
- Land the real Anthropic streaming proxy behind `/api/kneecap/generate` (it
  returns a `text` field — the desktop already parses for it).
- Stripe metered billing for the $2 overage at month end.
- Model is **Sonnet 4.6**, bundled in the $42 subscription, 20 free reports/mo.
- Template-driven generation (W3) does not yet route through hosted — only Quick
  Memo + IC Report do. A `vhs_generate_block` command would close that gap.

---

## W5 — Distribution & onboarding — **CONFIG PREPPED (this branch); signing = Wei**

Make KN33C4P installable + self-updating outside the dev machine.

**Prepped here (config only — see `BUILD.md` for the runbook):**
- `tauri.conf.json`: macOS bundle config (`bundle.macOS` with
  `minimumSystemVersion`, `entitlements`, `signingIdentity` placeholder) +
  `createUpdaterArtifacts: true`.
- `tauri-plugin-updater` wired (Cargo dep + desktop registration +
  `plugins.updater` block + `updater:default` capability), pointing at a GitHub
  Releases `latest.json` endpoint.
- `Entitlements.plist` for the hardened runtime (notarization requires it).
- **Placeholders Wei must fill** (all clearly marked):
  - `plugins.updater.pubkey` — a throwaway minisign key. Wei runs
    `tauri signer generate` and pastes his real public key here; the matching
    private key signs releases.
  - `bundle.macOS.signingIdentity` — `null` (unsigned local build). Wei sets his
    `Developer ID Application: …` identity (or the `APPLE_SIGNING_IDENTITY` env
    var) for distribution.
  - GitHub Releases URL — currently `duckm45t3r/kneecap`; confirm the release
    repo/owner.

**Not built (onboarding):**
- First-launch tutorial.
- Sample-data demo case so a new user can try a flow before connecting an LLM.

---

## W6 — Dealflow cockpit (PLANNED — queued after current verify)

Decided 2026-06-26. Bring VHS's **dealflow + pipeline** features into the kneecap
desktop GUI so the app becomes the VC's desktop cockpit: browse the (controlled)
screened dealflow → **one-click generate an IC memo on a company** → all in one app.
This closes the loop between screening (VHS web) and analysis (kneecap IC gen).

**How:** reuse the existing device bearer (`kc_…`) + the VHS backend
(Company / WeeklyBatch / UserDecision / deal-room) + new `/api/kneecap/*`
endpoints (reusing the existing gate + queries) + desktop UI. Same backend,
second client.

**Controlled-access red line (explicitly NOT a full DB dump):**
- Server-authoritative, on-demand paginated fetch. **No "download full DB" / no
  full local cache. No bulk export.** Rate-limited.
- Show only what the user **already has web access to** (their batches / pipeline),
  not the entire historical database.
- Verdicts shown softly (internal opinion, not a published claim); raw VHS
  verdicts may stay server-side / not be pushed to the client at all.

**Why "expose the full screened+verdicted US/TW database" was REJECTED:** core
IP / moat (a paying subscriber could scrape it and churn), legal exposure
(distributing verdicts on named private companies → defamation / data-licensing /
privacy across two jurisdictions), business-model (full export → cancel), founder/
ecosystem trust, and a desktop client is harder to protect against bulk capture
than the web. So: build the **features** under controlled access; do **not** ship
the full database.

**On start:** produce a phased design first (which features migrate first /
controlled-access design / verdict-presentation tiers).

## Branch map (as of this work)

| Branch                              | Contains            | State                |
|-------------------------------------|---------------------|----------------------|
| `main`                              | W1·W2 core          | shipped              |
| `kneecap-wave3-3-template-designer` | W3 designer + logo  | awaiting Tauri verify|
| `kneecap-p1-sidebar-persistence`    | W3 sidebar + save (tip of stack) | awaiting Tauri verify |
| `kneecap-w4-w5`                     | **W4 desktop + W5 config (this work)** | awaiting Tauri verify |

`kneecap-w4-w5` branches off `kneecap-p1-sidebar-persistence`, so it carries the
full W1→W4 product. Verify it in `cargo tauri dev` before merging the stack.
