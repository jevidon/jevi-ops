# Almanac for iOS (jevi-ops companion)

A native SwiftUI app that mirrors the mobile web experience of jevi-ops: the
same five-position chrome (Agenda · Domains · ✦ Capture · Search · More), the
same Almanac design language (linen and Umber themes, Newsreader / Geist /
Geist Mono, the Record Rose mark, status pills, the engraved domain art), and
the same screens — rebuilt natively where the phone gains something from it,
and rendered by the web app inside an in-app shell where it does not (yet).

| Tab | What renders it | Works offline |
| --- | --- | --- |
| Agenda | Native: masthead, focus line and every briefing panel (frame, weather, domain pulse, silent clients, attention, reflection, latest quote, pinned, timeline, doing, health, routines) in the order configured on the web, from one `GET /api/briefing/bundle` | Yes — the last briefing, with inline actions needing the server |
| Domains | Native: the Work board, domain and project pages, task pages and editor, from the last synced snapshot | Yes |
| ✦ Capture | Native portal: create-anything grid, free text, voice; saved on the phone first, delivered later | Yes |
| Search | Native over the synced snapshot and saved captures; the server's library search joins when reachable | Yes (local results) |
| More | The web's route list (Library, Content, People, …) opened inside a persistent WKWebView (signed-in cookie session, its own tab bar hidden), plus native Settings and saved captures | Web items need the server |
| Settings | Native: appearance (light / system / dark, mirrored into the web's theme cookie), device link, server addresses, share-sheet cache; server-side settings open on the web | Yes |

Native code talks to the Fastify API with a revocable `ops_` device token
(minted on first run via `POST /api/auth/tokens`, stored in the Keychain,
shared with the extension through the App Group). One request,
`GET /api/local-workspace`, brings down a consistent snapshot: every domain
(with its engraving), project, workflow definition, the computed Domains
board, and the tasks the phone can act on (done tasks bounded to the last 30
days). Edits queue offline with durable operation ids and replay safely; see
[offline behaviour and validation](offline.md).

The broader [product scope](../../docs/capture-program/02-offline-phone-capture.md)
and [implementation plan](../../docs/capture-program/03-native-ios-implementation-plan.md)
cover functionality not delivered here: on-device transcription, mixed
attachments, durable capture from the Share Extension, and background uploads.

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
- `JeviOps/Design/` — the design system: `Theme` (colour tokens for linen and
  Umber, typography, the domain colour hash), `SVG` (a small SVG renderer for
  the web's inline icons, mark and engravings), `Icons`, `Components`
  (ScreenHeader, Pill, DetailHeader, StatStrip, buttons, due labels).
- `JeviOps/Shell/` — `AppShell` (tabs, sheets, routing), `TabBar`, `MoreSheet`.
- `JeviOps/Agenda/` — the native Agenda (`AgendaView` panels, `AgendaModel`,
  `AgendaBundle` mirrors of `/api/briefing/bundle`) and `WebTabView`, the
  in-app web shell for More destinations with its offline card.
- `JeviOps/Domains/`, `Tasks/`, `Capture/`, `Search/` — the native screens.
- `JeviOps/Offline/` — `OfflineStore` (App Group files), `OfflineModel`
  (sync, queue, recording), `WorkModels`, and the debug-only `Fixture`.
- `JeviOps/Web/` — the WKWebView shell used by the Agenda tab.
- `JeviOps/Resources/Fonts/` — Newsreader, Geist and Geist Mono (SIL OFL).
- `ShareExtension/` — share-sheet target (URL/text → task).
- `Shared/` — compiled into both targets: config (App Group), Keychain,
  API client, models, reference cache, pending queue, compose UI.

## Design review without a server

`-offline-ui-fixture` launches the app on a bundled sample workspace (three
domains, projects, an asset, content, tasks in every state) with networking
off, so every native screen can be inspected or screenshotted in the
simulator. `-offline-ui-reset` wipes it first. The `OfflineUITests` scheme
drives this fixture through Domains → task edit → capture → search → relaunch
and attaches a screenshot of each screen to the result bundle.

## Auth model

Two independent credentials, both revocable from the web app's settings:

- The **web view** signs in at `/sign-in`; the Next server sets its HttpOnly
  `ops_session` cookie, persisted by WKWebsiteDataStore.
- **Native code** (share extension, quick actions) uses the `ops_` device
  token from onboarding. Revoking it in web Settings → API tokens unlinks the
  device; re-link from the app's Settings (shake to open).
