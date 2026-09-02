# Kneecap — Session Handoff 2026-07-01

Written at close of the 7/1 marathon session so the next dedicated kneecap
session can pick up cleanly without re-reading the whole transcript.

Full spec of what's built: `ROADMAP.md §W7`.

## What's on which branch

| Branch | State | What's in it |
|---|---|---|
| `main` | W1–W5 shipped(PR #1 merged 7/1);合了 `feat(icon)` X-ray 那條(commit `e815795`)? **No** — the icon commit is only on W7. | Core desktop app (Quick Memo / IC Report / Templates / BYO+Local+VHS-hosted providers / Deals+SQLite / native-PDF / sign-notarize runbook). |
| `kneecap-w7-template-studio` | **5 commits ahead of main. PR #2 open. tsc + cargo check green. .dmg built + launches. NOT yet GUI-verified by Wei.** | All of W7: A4 multi-page Template Studio (drag via pointer events, "+ Add page", right-side inspector); Format Learning v2 with sample emission + hosted routing + BYO/Local/VHS chooser; white-paper A4 preview (#1); on-screen A4 final report (#2); beta badge; i18n infra (EN/繁中/日 store + hook + switcher) + chrome coverage (Sidebar + header + Settings titles); X-ray knee-joint app icon (all platform sizes regenerated). |

## Concrete artifacts on this Mac

- `.dmg` (8.2MB, arm64, unsigned, ad-hoc signed):
  `src-tauri/target/release/bundle/dmg/KN33C4P_0.1.0_aarch64.dmg`
- `.app`: `src-tauri/target/release/bundle/macos/KN33C4P.app`
- Icon source SVG: `src-tauri/icons/source/knc-icon.svg` (lateral X-ray;
  `npx tauri icon <that>` regenerates every platform variant)
- Info.plist: `CFBundleName=KN33C4P`, `CFBundleIdentifier=capital.vhs.kneecap`,
  `CFBundleShortVersionString=0.1.0`, `LSMinimumSystemVersion=11.0`, arm64.

## What's LIVE on prod (vhs.capital)

- `/tools` landing lists **KN33C4P** as an active card with a "Now in beta
  testing" badge; clicks through to `/tools/kneecap` (full landing).
- Main navigator (top + footer) has a **Tools** link.
- `/tools/kneecap` download button is currently in the **fallback state**
  ("Build not yet published — check back soon") because
  `NEXT_PUBLIC_KNEECAP_DMG_URL` is not set on Vercel yet.

## Blockers before beta ships

1. **GUI verification of `.dmg`** by Wei. Test surface:
   - Format Learning: BYO + Local + **VHS-hosted** provider paths; sample emitted per block; templates land in Templates list; multi-file batch.
   - A4 Template Studio: drag blocks (pointer events, not HTML5 — Tauri WKWebView swallows those); "+ Add page" inserts a `pageBreak`; right-side inspector edits prompt/style; blocks can be dragged across pages.
   - Generate a report using a paginated template → on-screen A4 preview matches designer → export PDF + DOCX → page breaks land in the exported files.
   - i18n switcher (Settings → Language) — sidebar/header/Settings titles switch between EN/中/日 live.
   - App icon: dock shows the X-ray, not the Tauri swoop.
2. **Sign + notarize** the .dmg — see `BUILD.md`. Needs Wei's Apple Developer cert + updater keypair; Claude cannot touch those.
3. **Host the .dmg + set env var** — Wei's step:
   - Upload to a public bucket (Supabase Storage public bucket recommended — new `downloads/` bucket, mark public-read).
   - Set `NEXT_PUBLIC_KNEECAP_DMG_URL=<public url>` on Vercel (Production).
   - Trigger a redeploy → `/tools/kneecap` download button flips live.
4. **Merge kneecap PR #2** (`kneecap-w7-template-studio` → main) — hold until 1 passes.

## i18n status — in-flight parallel workstream

- **Infra + chrome shipped on W7 branch**: `src/i18n/{messages,index,LangToggle}.tsx`; Sidebar / header / Settings titles + Language section all wired.
- **Audit CSV**: `i18n_todo.csv` at the kneecap root — **388 rows** covering every remaining user-visible string, grouped by 32 surfaces (TemplateStudio 38, Common 29, IcReport 26, Settings.BYO 23, DealView.Sources 23, FormatLearning 22, SaveToDeal 21, Starter.Blocks 20, DealView.NewVersion 19, Settings.Vhs 17, and so on).
- **Wei is filling the `zh` + `ja` columns externally** ("翻譯我另外正在運作"). He'll hand the completed CSV back when done.
- **What I do when CSV comes back**:
  1. Append the ~388 new keys to `src/i18n/messages.ts` (`en` + `zh` + `ja`).
  2. Convert the ~388 hardcoded strings in `App.tsx` / `deals/*.tsx` / `templates/*.tsx` / `starters.ts` to `t("...")` calls.
  3. tsc green (the `Record<MessageKey, string>` typing catches any missing translation).
  4. Wei GUI-verifies each locale.
- Ship notes:
  - `Common.*` surface (~29 rows) has the biggest reach — shared across all flows.
  - `Starter.*` (28 rows) covers built-in template names/descriptions/block labels — visible in sidebar + gallery.
  - Brand tokens (`KN33C4P` / `VHS` / `beta` / `Anthropic` / `OpenAI` / `Ollama`) intentionally NOT translated.

## Post-beta backlog (not blocking launch)

- **Encrypted PDF detection** — 7/1 B7 test found `春魚結算` was AES-256 encrypted; Anthropic rejects encrypted PDFs. Need a client-side detect + friendly error ("please remove encryption before upload"), and eventually an owner-password unlock flow. Currently the failure surfaces as a raw 502.
- **W6 Dealflow Cockpit** — planned in ROADMAP §W6, not built. Bring vhs.capital's dealflow browsing + IC-generate-on-a-company workflow into the desktop; hosted-subscriber gated; **no full-DB dump** (per adversarial review). 3 security must-fixes documented in ROADMAP.
- **VHS referral program** — plan LOCKED 2026-06-28, spec at `../VHS_REFERRAL_PLAN_2026-06-28.md`. Not a kneecap project itself, but affects hosted-subscriber growth which affects kneecap adoption.

## Discipline / gotchas learned this run

- **Never trust exit codes on tauri build alone** — the 7/1 rebuild had `bundle_dmg.sh` fail (silently produced a `rw.*.dmg` scratch file) even with cargo exit 0; the workaround is manual `hdiutil create ... -format UDZO`. See scratchpad or previous session transcript.
- **Tauri WKWebView swallows HTML5 `draggable`** — reorder had to be rewritten to pointer events + `elementFromPoint`. Don't reintroduce `draggable` attributes if adding new drag features.
- **Hosted 502 = check Anthropic credit FIRST**, not model/code. 7/1 outage lesson. `vhs-platform/app/api/kneecap/generate/route.ts` now classifies errors with a `reason` field (auth / rate_limited / insufficient_credit / bad_request / network / upstream / empty_response) — surface that to the user if needed.
- **Local `.env.local` Anthropic key ≠ prod key.** Local dev tests can't validate prod hosted path.

---

## 共通協定(Alfred Command Protocol v1)— 指向母目錄,不在此重複

本 project 的工作實際上都在 **`VH Site/` 這個 cwd** 底下的 session 進行(已查證:11 個 VH Site
session 的 cwd 全都是 `VH Site` 本身,沒有任何一個從這個子目錄啟動)。

因此共通協定**只維護一份**,在 `VH Site/SESSION_CONTEXT.md` 檔尾:身份邊界 / `_STATE.md`
狀態契約 / 執行紀律(before-during-after)/ 升級路徑。開工前讀那份。

**為什麼不在這裡複製一份**:兩份會 drift。協定改版時只有一處要更新,是刻意的設計
(見 `Alfred/config/session_protocol_template.md` 的版本管理備註)。

> 這份 handoff 檔的定位是**特定工作串的交接文件**(2026-07-01 marathon 的續接點),
> 不是 session governing 檔 —— governing 的角色在母目錄的 SESSION_CONTEXT.md。
