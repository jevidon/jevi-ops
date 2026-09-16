# jevi-capture — `/capture` for the Hermes desktop app

A deterministic Hermes plugin: `/capture <text>` saves the text to Jevi Ops **before any model runs** and replies with the storage receipt. It never enters the model loop. What it saves is a *pending capture*: nothing classifies, routes or delegates it until the asynchronous consumer ships (Gate C). Until then it shows up in Jevi Ops under Inbox › Captures, where the owner can interpret or retry it.

It targets the owner's interactive Hermes install (`~/.hermes`, verified on Hermes 0.18.2 where the desktop gateway resolves plugin slash commands in-process before dispatch). It is **not** the pinned research runtime under `workers/hermes/runtime`, and it has no database access: it speaks to the API with a capture-only token.

## Honesty rules

| Result | Reply | Why |
|---|---|---|
| 2xx with a receipt for the same capture id | `Saved to Jevi Ops (capture …)` | derived from the transport result, not generated |
| 4xx | `Could not save: <code>` | the server refused it; nothing was stored |
| timeout / connection error / odd 2xx | `Save status unknown (…); ref <operation_id>` | the server may have committed; the envelope is kept |

Every envelope is written to `~/.hermes/jevi-capture/pending/<operation_id>.json` (0600) **before** the request. On the next `/capture`, each pending envelope is checked with `GET /api/operations/<id>`: a receipt means "saved earlier"; a 404 re-sends the identical envelope. The same operation id can never produce two captures, and you never have to retype after an outage. There is no long-running spool or daemon.

## Install

1. In Jevi Ops → Settings → API tokens, create a token with access **capture only** (`permission_profile: capture_client`). Copy it once.
2. Configure the plugin's private directory:

   ```sh
   mkdir -p -m 700 ~/.hermes/jevi-capture/pending
   printf '{ "api_url": "http://127.0.0.1:3001" }\n' > ~/.hermes/jevi-capture/config.json
   printf 'JEVI_CAPTURE_TOKEN=ops_…\n' > ~/.hermes/jevi-capture/.env
   chmod 600 ~/.hermes/jevi-capture/.env
   ```

   `api_url` must be `https://…` or plain `http://` on loopback only. Optional `"surface": "desktop-slash"` labels the client in receipts.
3. Link the plugin into Hermes and enable it (from the repository root):

   ```sh
   mkdir -p ~/.hermes/plugins
   ln -s "$PWD/workers/hermes-capture" ~/.hermes/plugins/jevi-capture
   ```

   Add to `~/.hermes/config.yaml`:

   ```yaml
   plugins:
     enabled:
       - jevi-capture
   ```

4. Restart `hermes desktop`. Type `/capture buy filters for the furnace`. Expect `Saved to Jevi Ops (capture …)` with the API running, and `Save status unknown (api_unavailable); ref …` with it stopped — then start the API and `/capture` again: the earlier text reconciles as "Saved earlier".

## Tests

```sh
python3 -m unittest discover -s workers/hermes-capture/tests -v
```

The tests run a loopback fake of the Jevi API and load the shared fixtures in `packages/shared/fixtures/durable-capture/`, so the Python envelope shape and ledger digest are checked against the same corpus the TypeScript side uses.

## Limits (Gate B)

- Text only. Audio/images from Hermes are not captured by this command.
- The plugin runs inside the desktop gateway process: standard library only, 10-second timeout, no retries in-line (reconciliation happens on the next invocation).
- No interpretation from Hermes; a saved capture waits in Jevi Ops. The Gate C consumer will claim it.
