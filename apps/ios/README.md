# jevi-ops iOS companion

WKWebView shell around the web app, plus native share-sheet capture and quick
actions. Talks to the Fastify API directly with a revocable `ops_` device
token (minted on first run via `POST /api/auth/tokens`, stored in the
Keychain, shared with the extension through the App Group).

## One-time machine setup

1. Install Xcode from the App Store, then:

   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   xcodebuild -downloadPlatform iOS
   ```

2. `brew install xcodegen` (already done if `which xcodegen` answers).
3. For device/TestFlight builds only: sign into Xcode → Settings → Accounts
   with the paid Apple ID, and put your Team ID (developer.apple.com →
   Membership) in `Signing.xcconfig`:

   ```bash
   cp Signing.xcconfig.example Signing.xcconfig  # then edit
   ```

   Simulator builds don't need any of that.

## Build & run (simulator)

```bash
make generate   # XcodeGen → JeviOps.xcodeproj (gitignored, regenerate freely)
make build      # unsigned simulator build
make run        # boot simulator, install, launch
make screenshot
```

Against local dev servers: `scripts/devctl.sh start` at the repo root, then
onboard with web URL `http://127.0.0.1:3000` (API auto-derives to `:3001`).
The simulator shares the Mac's loopback; ATS allows it via
`NSAllowsLocalNetworking`.

Against the real server: onboard with the ts.net web URL — the API derives to
`:8443` (tailscale serve). The device/simulator's host must be on the tailnet.

## Layout

- `project.yml` — XcodeGen spec; the `.xcodeproj` is generated, never edited.
- `JeviOps/` — app target: web shell (`Web/`), onboarding, settings.
- `ShareExtension/` — share-sheet target (URL/text → task).
- `Shared/` — compiled into both targets: config (App Group), Keychain,
  API client, models, reference cache, pending queue, compose UI.

## Auth model

Two independent credentials, both revocable from the web app's settings:

- The **web view** signs in at `/sign-in`; the Next server sets its HttpOnly
  `ops_session` cookie, persisted by WKWebsiteDataStore.
- **Native code** (share extension, quick actions) uses the `ops_` device
  token from onboarding. Revoking it in web Settings → API tokens unlinks the
  device; re-link from the app's Settings (shake to open).
