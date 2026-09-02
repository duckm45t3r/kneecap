# KN33C4P

> A desktop IC report copilot. Reads your old reports, learns your firm's
> format, writes new ones in your voice. So you can say you wrote it with
> your knee.

Read: **kneecap**.

Built as Wave 2 of [vhs.capital](https://vhs.capital), now released as an
open-source desktop app. Everything runs on your machine: your documents,
your API key, your reports.

## Status: frozen, open source

KN33C4P is **feature-frozen** as of September 2026 and released under MIT.
It works, it is no longer under active development, and there is no roadmap.
The source is here so that anyone who finds it useful can build it, fork it,
or take it somewhere new.

Two things changed at the freeze:

- **The VHS-hosted model backend has been retired.** Earlier builds could
  route generation through vhs.capital for subscribers. That endpoint is
  gone. Use your own API key or a local model — both paths are unchanged
  and are what the app was mostly used with anyway. Because the app is
  frozen exactly as it shipped, *VHS-hosted* is still listed in the
  provider picker; selecting it now fails. Pick any of the others.
- **Builds are unsigned.** The macOS bundle is ad-hoc signed, so a
  downloaded `.dmg` opens via right-click → Open rather than a double
  click; Windows shows a SmartScreen warning. See [BUILD.md](BUILD.md) §7
  for why, and for the Developer-ID path if you want to sign your own.

## What it does

- **Format Learning** — point it at reports your firm already writes; it
  infers the structure and turns it into a reusable template.
- **Template Studio** — an A4 multi-page WYSIWYG designer for those
  templates, with page breaks and a live paged preview.
- **Quick Memo / Full IC Report** — a URL, pasted text, or a PDF in;
  a screening memo or a sectioned IC report out.
- **Deals** — every report saved as a versioned deal with its sources,
  in a local SQLite database.
- **Export** — PDF or DOCX, matching the on-screen A4 layout.
- **Trilingual UI** — English, 繁體中文, 日本語.

## Bring your own model

Pick whichever you prefer in Settings; keys are stored in the OS keychain
(macOS Keychain / Windows Credential Manager), never in a config file:

| Provider | Notes |
|---|---|
| Anthropic | Native PDF reading |
| OpenAI | |
| Google Gemini | |
| Nvidia NIM | Self-healing weekly model probe |
| Ollama | Fully local, no key, no network egress. Point it at your own server (default `http://localhost:11434`). |

PDFs are extracted locally for providers that cannot read them natively.

## Build it

```bash
npm install
npm run tauri dev      # develop
npm run tauri build    # produce a bundle
```

Prerequisites and the full signing/notarization runbook are in
[BUILD.md](BUILD.md). Rust toolchain plus the Tauri 2 prerequisites for
your platform are all you need to get a local build running.

## Stack

- Tauri 2 (Rust shell + system WebView)
- React 19 + Vite + TypeScript
- SQLite for deals, versions and custom templates
- Keychain-backed credential storage, four-layer SSRF guard on URL fetches

## License

MIT — see [LICENSE](LICENSE). Do what you like with it.
