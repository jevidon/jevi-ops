# jevi-ops iOS companion

WKWebView shell around the web app, plus native share-sheet capture and quick
actions. Talks to the Fastify API directly with a revocable `ops_` device
token (minted on first run via `POST /api/auth/tokens`, stored in the
Keychain, shared with the extension through the App Group).

Native offline capture is the next delivery, described in the
[product scope](../../docs/capture-program/02-offline-phone-capture.md) and
[implementation plan](../../docs/capture-program/03-native-ios-implementation-plan.md).
The existing app does not yet provide that capture store, recording flow,
local transcription, or offline library.

## One-time machine setup

1. Open Xcode and complete its licence and first-launch component setup.
   Select the full Xcode toolchain for the current terminal session:

   ```bash
   export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
   xcodebuild -checkFirstLaunchStatus
   xcodebuild -showsdks
   xcrun simctl list devices available
   ```

   Install an iOS simulator runtime through Xcode if the list is empty.
   `DEVELOPER_DIR` avoids changing the computer's global `xcode-select`
   setting, which may still point at Command Line Tools.

2. `brew install xcodegen` (already done if `which xcodegen` answers).
3. For device/TestFlight builds only: sign into Xcode → Settings → Accounts
   with the paid Apple ID, and put your Team ID (developer.apple.com →
   Membership) in `Signing.xcconfig`:

   ```bash
   cp Signing.xcconfig.example Signing.xcconfig  # then edit
   ```

   Simulator builds do not need a development team or provisioning profile,
   but must retain ad-hoc signing and the App Group entitlements for the
   shared Keychain to work. Do not set `CODE_SIGNING_ALLOWED=NO`.

## Build & run (simulator)

```bash
make generate   # XcodeGen → JeviOps.xcodeproj (gitignored, regenerate freely)
make build      # simulator build; see explicit ad-hoc build below
make run        # boot simulator, install, launch
make screenshot
```

For a simulator build independent of local team settings, use an installed
device/runtime from `simctl list` (this combination was verified locally):

```bash
xcodebuild -project JeviOps.xcodeproj -scheme JeviOps \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath build/DerivedData DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- build
```

The existing `make test` uses a live test account and mints a device token.
Run it only against an isolated test environment. The offline capture
foundation will add native storage/queue tests and fixture-based UI tests
that can run without the owner's API or Hermes.

Against local dev servers: `scripts/devctl.sh start` at the repo root, then
onboard with web URL `http://127.0.0.1:3000` (API auto-derives to `:3001`).
The simulator shares the Mac's loopback; ATS allows it via
`NSAllowsLocalNetworking`.

Against the real server: onboard with the ts.net web URL — the API derives to
`:8443` (tailscale serve). The device/simulator's host must be on the tailnet.

## Connection troubleshooting

- Open the API URL plus `/healthz` in Safari. Expect JSON containing
  `"status":"ok"`. An HTML sign-in page means the API URL or proxy is reaching
  the web service. The default proxy targets are web → `127.0.0.1:3000` and
  API → `127.0.0.1:3001`.
- A login 401 means the server rejected the email/password combination;
  it does not mean a device token was revoked. Compare the normalized email
  and backend with a successful web/controlled login. The API's `login failed`
  log covers both an unknown email and a password mismatch.
- Request byte counts alone cannot identify a changed password. JSON escaping
  and differences in the email can change body length. Preserve passwords
  exactly; do not trim them or log request bodies, passwords, or tokens.
- Linking-session, device-token, transport, and response-format failures have
  separate messages. Response-format errors identify the endpoint without
  displaying authentication response contents.
- After correcting the Web URL in native Settings, tap **Reload page** to
  load that saved address. If you see `{"name":"jevi-ops/api",…}`, the web
  view is reaching the API service; verify the Web URL and proxy mapping.

## Isolated native tests

These hostless tests use an in-memory URL protocol for API requests and a
recording web view for navigation. They do not start the app, contact a server,
read stored credentials, or mint device tokens. The existing
`JeviOps` UI-test scheme still needs a live test server.

```bash
make generate
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project JeviOps.xcodeproj -scheme APIClientTests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath build/UnitTests DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- test
```

Choose a simulator installed on your Mac if that model/runtime is unavailable.

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
