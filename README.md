# KN33C4P

> A desktop IC report copilot. Reads your old reports, learns your firm's
> format, writes new ones in your voice. So you can say you wrote it with
> your knee.

Read: **kneecap**.

Wave 2 of [vhs.capital](https://vhs.capital). Free, closed-source binary;
BYO API key, local model, or VHS hosted (bundled with the VHS subscription).

## Status

In active development. See [VHS_REVAMP_WAVE2_KNEECAP_DESIGN.md](https://github.com/duckm45t3r/vhs-platform/blob/main/VHS_REVAMP_WAVE2_KNEECAP_DESIGN.md) for the full design.

## Stack

- Tauri 2.x (Rust shell + WebView)
- React 19 + Vite + TypeScript
- Tailwind 4
- Anthropic SDK (BYO key / VHS hosted) + Ollama (local model)
- Voyage AI embeddings (Wave 1.6 link suggestion)

## License

MIT.
