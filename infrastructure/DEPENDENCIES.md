# jevi-ops — dependent systems setup guide

The compose stack (`infrastructure/docker/`) bundles only what it owns:
Postgres, the API, the web app, and a nightly backup sidecar. Everything
with its own lifecycle runs **outside** the stack and is pointed at by
configuration. This guide covers standing each one up and wiring it in.

The Settings page (`/settings`) has **Test connection** buttons for the LLM
and STT entries — use them after each step so setup is verified, not
assumed. `/settings/integrations` shows the full configured/missing
inventory.

| System | Required? | Configured via |
|---|---|---|
| [Tailscale on TrueNAS](#1-tailscale-ingress) | Yes — it is the only ingress | host `tailscale serve` |
| [LLM server](#2-llm-server) | For voice capture + chat | Settings → AI (or `LLM_*` env) |
| [STT server](#3-stt-server) | For audio voice memos | Settings → AI (or `STT_*` env) |
| [Immich](#4-immich) | Optional — journal photo suggestions | Settings → AI |
| [Google OAuth](#5-google-oauth-calendar) | Optional — calendar sync | env |
| [Pushover](#6-pushover) | Optional — reminders/summary pushes | env |

---

## 1. Tailscale (ingress)

Tailscale already runs on the TrueNAS host. The stack publishes the web and
API containers to **host loopback only** (`127.0.0.1:3000` / `127.0.0.1:3001`
by default), so `tailscale serve` is the sole way in — nothing is exposed to
the LAN or internet.

```bash
# On the TrueNAS host (adjust ports if you changed WEB_BIND_PORT/API_BIND_PORT):
tailscale serve --bg --https=443  http://127.0.0.1:3000   # web
tailscale serve --bg --https=8443 http://127.0.0.1:3001   # api
tailscale serve status                                     # confirm both mappings
```

Requirements:

- **MagicDNS + HTTPS certificates** enabled for the tailnet
  (Tailscale admin console → DNS). `tailscale serve` then terminates TLS
  with a valid `*.ts.net` certificate — which Google accepts as an OAuth
  redirect host.
- Your **phone runs Tailscale** — that's what makes the PWA, voice capture,
  and the Scriptable widget work away from home.
- Note your hostname: `tailscale status` → e.g. `nas.tail1234.ts.net`. That
  gives the two public origins used everywhere else:
  - `WEB_APP_URL=https://nas.tail1234.ts.net`
  - `API_PUBLIC_URL=https://nas.tail1234.ts.net:8443`

Verify: from the phone (wifi off, Tailscale on) open
`https://<nas>.<tailnet>.ts.net` → the sign-in page should render with a
valid certificate.

## 2. LLM server

Drives the voice-transcript parser and the `/chat` tool loop. Anything that
speaks the **OpenAI Chat Completions API** works; it just needs to be
reachable from the NAS (same tailnet is fine).

**llama.cpp** (the current setup, on a separate machine):

```bash
# --jinja enables tool/function calling — required for /chat.
llama-server --jinja -m <model.gguf> --host 0.0.0.0 --port 8080
```

- Model guidance: the chat loop presents 8 tools — pick a tool-calling-capable
  model (Qwen3 32B class or Llama 3.3 70B class recommended; smaller works
  for the parser but tool selection quality drops).
- Point jevi-ops at it: Settings → AI → Base URL
  `http://<llm-host>:8080/v1`, Model = the served model name.
- Alternatives, all drop-in: **MLX** (`mlx_lm.server`), **Ollama**
  (`http://host:11434/v1`), **vLLM**, **LM Studio** — same base-URL config.
- **Cloud escape hatch**: set Provider to *Anthropic* and put
  `ANTHROPIC_API_KEY` in the API env. Useful for A/B-ing parse quality
  against the local model.

Verify: Settings → AI → **Test connection** (does a 1-token completion and
reports latency). Then hold-to-talk a capture: "add a task to test the
local model" → a task should land in the Inbox.

## 3. STT server

Transcribes MediaRecorder audio from the mic FAB / chat voice input.
Deliberately **its own app** (reusable by other projects). Anything with an
OpenAI-compatible `/v1/audio/transcriptions` endpoint works.

**speaches** (recommended; formerly faster-whisper-server) as a TrueNAS
custom app or on any tailnet host:

```yaml
services:
  speaches:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
    restart: unless-stopped
    ports: ["8000:8000"]
    volumes:
      - /mnt/tank/apps/speaches/models:/home/ubuntu/.cache/huggingface
```

- Point jevi-ops at it: Settings → AI → STT Base URL
  `http://<stt-host>:8000/v1`, Model e.g. `Systran/faster-whisper-small`
  (small is fast and fine for dictation; go `medium`/`large-v3` for accuracy).
- whisper.cpp's server on the llama machine also works
  (`--host 0.0.0.0 --port 8081` → base URL `http://<host>:8081/v1`).
- Cloud fallback: leave STT base URL blank and set `STT_API_KEY` (OpenAI).

Verify: Settings → AI → **Test connection**, then record a voice memo from
the chat page mic and confirm the transcript fills in.

## 4. Immich

Lets journal entries surface the photos you took that day (opt-in attach).
Immich stays a separate TrueNAS app — jevi-ops calls its HTTP API.

1. Immich → Account Settings → **API Keys** → New API Key (read access is
   sufficient).
2. jevi-ops Settings → AI → Immich: Base URL (e.g. `http://<nas-lan-or-ts-ip>:2283`)
   + the key. The API talks to Immich server-side, so a LAN address is fine
   even though your browser is on the tailnet.

Verify: open a journal entry → the "Photos from this day" strip appears
when Immich has photos for that date.

## 5. Google OAuth (calendar)

Same setup as ever, one change after the NAS move: the **redirect URI**.

1. https://console.cloud.google.com/apis/credentials → your OAuth client →
   add authorized redirect URI:
   `https://<nas>.<tailnet>.ts.net:8443/api/auth/google/callback`
2. Put `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` in the stack
   env. (`GOOGLE_OAUTH_REDIRECT_URI` is derived from `API_PUBLIC_URL` by the
   compose file.)
3. Settings → Google Calendar → Connect. Existing refresh tokens migrated
   from the old deployment keep working — the redirect URI change only
   affects *new* consent flows.

## 6. Pushover

Unchanged from the hosted era — outbound HTTPS only, works from anywhere.
`PUSHOVER_USER_KEY` (your user key) + `PUSHOVER_API_TOKEN` (an application
token from pushover.net) in the stack env. Without them, every notification
job soft-skips.
