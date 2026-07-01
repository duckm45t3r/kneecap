# KN33C4P — macOS build, sign, notarize, and auto-update runbook

This is the concrete command list to turn the source into a signed, notarized,
auto-updating `.app` / `.dmg` that you can put on GitHub Releases. It assumes
macOS on Apple Silicon and the repo checked out.

Everything in `tauri.conf.json` under signing + updater is a **placeholder**
right now. The build compiles and runs unsigned without touching any of it; you
only need the steps below when you want to **distribute**.

---

## 0. One-time setup

You provide these once and reuse them:

| Secret / identity | Where it comes from | Used for |
|---|---|---|
| Apple Developer ID Application cert | Apple Developer account → Certificates → "Developer ID Application". Install into your login Keychain. | Code-signing the `.app` |
| `APPLE_ID` | Your Apple Developer account email | Notarization |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com → Sign-In and Security → App-Specific Passwords | Notarization (NOT your real password) |
| `APPLE_TEAM_ID` | Apple Developer → Membership → Team ID (10 chars) | Notarization |
| Updater private key + password | `tauri signer generate` (step 2) | Signing update artifacts |

> Apple alternative: instead of `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`
> you can use an App Store Connect API key
> (`APPLE_API_ISSUER` + `APPLE_API_KEY` + `APPLE_API_KEY_PATH`). Either works;
> the Apple-ID trio is simpler for a one-person release.

---

## 1. Find your signing identity string

```bash
security find-identity -v -p codesigning
```

Copy the full name, e.g. `Developer ID Application: Wei Name (AB12CD34EF)`.

Put it in `src-tauri/tauri.conf.json` → `bundle.macOS.signingIdentity`
(replacing the `null` placeholder), **or** export it at build time:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Wei Name (AB12CD34EF)"
```

---

## 2. Generate the real updater keypair (replaces the placeholder pubkey)

The repo ships a **throwaway** placeholder public key in
`tauri.conf.json` → `plugins.updater.pubkey`. It is valid-format so the project
compiles, but its private key is gone — it cannot sign your releases. Generate
your own:

```bash
# Writes the private key to ~/.tauri/kneecap.key and the public key to
# ~/.tauri/kneecap.key.pub. You'll be prompted for a password — set one.
npx tauri signer generate -w ~/.tauri/kneecap.key
```

Then:

1. Copy the **public** key (contents of `~/.tauri/kneecap.key.pub`) into
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, replacing the
   placeholder.
2. Keep the **private** key secret. It signs every release. If you lose it, you
   can never push another auto-update — clients pinned to the old pubkey will
   reject anything signed by a new key.

Export the private key + password for the build:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/kneecap.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="the-password-you-set"
```

(`.env` files are NOT read by the build — export in the shell or set in CI.)

---

## 3. Build + sign + notarize in one shot

With the env vars from steps 0–2 exported, this single command builds, signs,
notarizes, staples, and produces the updater artifacts:

```bash
cd src-tauri        # or run from repo root; tauri finds src-tauri
npx tauri build
```

What it does when the env vars are present:
- Builds the universal frontend (`npm run build`) and the Rust binary.
- Signs the `.app` with your Developer ID identity + the `Entitlements.plist`
  (hardened runtime).
- Submits to Apple notarization via `notarytool` and **staples** the ticket —
  no separate `xcrun` step needed. (Notarization takes a few minutes; the build
  blocks until Apple responds.)
- Because `bundle.createUpdaterArtifacts` is `true`, it emits the signed update
  artifacts (`*.app.tar.gz` + `*.app.tar.gz.sig`) next to the `.dmg`.

Output lands in:

```
src-tauri/target/release/bundle/
  dmg/KN33C4P_0.1.0_aarch64.dmg
  macos/KN33C4P.app
  macos/KN33C4P.app.tar.gz          # updater payload
  macos/KN33C4P.app.tar.gz.sig      # updater signature (needs your private key)
```

### Manual fallback (only if the integrated notarization fails)

If you ever need to drive notarization by hand:

```bash
# 1. Sign (if not already)
codesign --force --deep --options runtime \
  --entitlements src-tauri/Entitlements.plist \
  --sign "Developer ID Application: Wei Name (AB12CD34EF)" \
  "src-tauri/target/release/bundle/macos/KN33C4P.app"

# 2. Notarize (zip the .app first)
ditto -c -k --keepParent \
  "src-tauri/target/release/bundle/macos/KN33C4P.app" /tmp/KN33C4P.zip
xcrun notarytool submit /tmp/KN33C4P.zip \
  --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait

# 3. Staple the ticket onto the .app
xcrun stapler staple "src-tauri/target/release/bundle/macos/KN33C4P.app"
```

---

## 4. GitHub Releases auto-update wiring

The updater endpoint is configured in
`tauri.conf.json` → `plugins.updater.endpoints`:

```
https://github.com/duckm45t3r/kneecap/releases/latest/download/latest.json
```

> CONFIRM the repo owner/name. It is set to `duckm45t3r/kneecap`. If the release
> repo is different, fix the endpoint before the first signed release.

To cut a release:

1. Bump `version` in **both** `tauri.conf.json` and `package.json` (e.g. 0.1.1).
2. `npx tauri build` (steps 2–3 env exported) so the artifacts are signed.
3. Create a GitHub Release tagged `v0.1.1` and upload:
   - `KN33C4P_0.1.1_aarch64.dmg` (the human download)
   - `KN33C4P.app.tar.gz` + `KN33C4P.app.tar.gz.sig` (the updater payload)
   - `latest.json` — the update manifest. Shape:

```json
{
  "version": "0.1.1",
  "notes": "What changed.",
  "pub_date": "2026-06-25T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of KN33C4P.app.tar.gz.sig>",
      "url": "https://github.com/duckm45t3r/kneecap/releases/download/v0.1.1/KN33C4P.app.tar.gz"
    }
  }
}
```

The `signature` field is the literal text inside the `.sig` file. The desktop
verifies it against the `pubkey` in `tauri.conf.json` before installing — this
is why the pubkey/private-key pair from step 2 must be **yours**, not the
placeholder.

> Tip: `tauri-action` (the official GitHub Action) automates steps 2–3 and the
> `latest.json` upload if you'd rather run releases from CI. It reads the same
> `TAURI_SIGNING_PRIVATE_KEY` + Apple env vars as secrets.

The app's update-check itself (calling `check()` / `downloadAndInstall()` from
the frontend, or prompting the user) is **not yet wired into the UI** — the
plugin is registered and permitted, so adding a "Check for updates" button in
Settings is a small follow-up.

---

## 5. Placeholder checklist (what you must replace before distributing)

- [ ] `plugins.updater.pubkey` — replace throwaway key with your real
      `tauri signer generate` public key (step 2).
- [ ] `bundle.macOS.signingIdentity` — set your Developer ID, or export
      `APPLE_SIGNING_IDENTITY` (step 1). Currently `null` = unsigned.
- [ ] `plugins.updater.endpoints` — confirm the GitHub repo owner/name.
- [ ] Export Apple notarization secrets (`APPLE_ID` / `APPLE_PASSWORD` /
      `APPLE_TEAM_ID`) before `npx tauri build`.
- [ ] Keep `~/.tauri/kneecap.key` (private updater key) backed up + secret.

---

## 6. Windows build (beta, unsigned)

Windows uses a different path: builds run in **GitHub Actions**
(`.github/workflows/release-windows.yml`) on `windows-latest`, driven by tag
pushes. Mac stays manual on your laptop; the two do not share signing state.

### 6.1 Trigger a Windows release

```bash
# From the branch you want to ship (e.g. kneecap-w7-template-studio):
git tag v0.1.0-beta.win        # any tag matching v* triggers the workflow
git push origin v0.1.0-beta.win
```

Watch the run at `https://github.com/duckm45t3r/kneecap/actions`. On success
(~10-15 min) a **pre-release** appears at
`https://github.com/duckm45t3r/kneecap/releases/tag/v0.1.0-beta.win` with
`KN33C4P_0.1.0_x64-setup.exe` attached.

### 6.2 Local Windows build (fallback)

If Actions is down or you want to iterate locally on a Windows machine:

```powershell
# One-time toolchain
winget install --id Microsoft.VisualStudio.2022.BuildTools     # C++ build tools
winget install --id Rustlang.Rustup
winget install --id OpenJS.NodeJS.LTS
rustup target add x86_64-pc-windows-msvc

# Build
git clone https://github.com/duckm45t3r/kneecap
cd kneecap
npm ci
npx tauri build
# Output: src-tauri\target\release\bundle\nsis\KN33C4P_0.1.0_x64-setup.exe
```

WebView2 runtime is bundled via `webviewInstallMode: downloadBootstrapper` —
first-launch users without WebView2 get a silent MS bootstrapper install.

### 6.3 SmartScreen (unsigned .exe caveat)

Beta builds are unsigned. On download + first run, Windows shows:

> **Microsoft Defender SmartScreen prevented an unrecognized app from starting.**

The `/tools/kneecap` landing page tells users:
`More info → Run anyway`. This is documented on the download page so it's not a
surprise.

### 6.4 Upgrading to signed later

Two options when we're ready to remove the SmartScreen warning:

- **EV code-signing cert** (~$300-500/yr, hardware token). Store the cert as a
  base64 GitHub secret `WINDOWS_CERTIFICATE` + password `WINDOWS_CERTIFICATE_PASSWORD`.
  tauri-action picks them up automatically.
- **Azure Trusted Signing** (monthly, no hardware token). Requires an Azure
  tenant + `AzureSignTool` step in the workflow.

Neither is wired up right now.

### 6.5 Windows updater

Currently disabled for Windows — the updater `latest.json` only carries a
`darwin-aarch64` entry when Mac ships it. To enable Windows auto-update later:

1. Add `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as
   repo secrets (same minisign keypair Mac uses).
2. In the release's `latest.json`, add:
   ```json
   "windows-x86_64": {
     "signature": "<contents of KN33C4P_0.1.0_x64-setup.nsis.zip.sig>",
     "url": "https://github.com/duckm45t3r/kneecap/releases/download/v0.1.0/KN33C4P_0.1.0_x64-setup.nsis.zip"
   }
   ```
3. tauri-action will emit `.nsis.zip` + `.nsis.zip.sig` when the private key is
   present.
