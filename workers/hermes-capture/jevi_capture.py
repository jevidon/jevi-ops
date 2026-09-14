"""Deterministic capture client for the ``/capture`` Hermes slash command.

Contract (packages/shared/src/schemas/durable-capture.ts, fixtures in
packages/shared/fixtures/durable-capture/):

* Every save is a ``capture.create`` envelope with client-generated
  ``operation_id`` / ``capture_id``. The envelope is written to a 0600
  pending file BEFORE the request, and deleted only once the outcome is
  known. A timeout is therefore "status unknown", never "not saved": the
  next invocation asks ``GET /api/operations/<id>`` and either reports the
  earlier receipt or re-POSTs the identical envelope. Retyping is never
  required to recover, and a retry can never create a second capture.
* The reply is derived from the transport result. ``Saved to Jevi Ops`` is
  shown only for a 2xx whose receipt carries the same ``capture_id`` and
  ``receipt_kind == "server_saved"``.
* Never raises (the gateway would print a traceback), never logs the text
  or the token. Standard library only — this runs in the gateway process.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

PLUGIN_VERSION = "0.1.0"
PROTOCOL_VERSION = 1
TIMEOUT_SECONDS = 10.0
MAX_TEXT_CHARS = 20_000
MAX_RESPONSE_BYTES = 256_000
SECRET_KEY = "JEVI_CAPTURE_TOKEN"


class CaptureError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.detail = detail


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


# ─── configuration ────────────────────────────────────────────────────────

def home() -> Path:
    override = os.environ.get("JEVI_CAPTURE_HOME")
    return Path(override).expanduser() if override else Path.home() / ".hermes" / "jevi-capture"


def endpoint(value: str) -> str:
    """https anywhere, or plain http on loopback only."""
    try:
        p = urlsplit(value)
        if p.username or p.password or p.query or p.fragment or not p.hostname:
            raise ValueError()
        if p.scheme != "https" and not (p.scheme == "http" and p.hostname in ("localhost", "127.0.0.1", "::1")):
            raise ValueError()
        return value.rstrip("/")
    except ValueError:
        raise CaptureError("invalid_endpoint") from None


def read_secret(path: Path) -> str:
    if path.stat().st_mode & 0o077:
        raise CaptureError("secret_file_permissions_require_0600")
    token = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or key.strip() != SECRET_KEY:
            raise CaptureError("invalid_secret_file")
        token = value.strip().strip('"').strip("'")
    if not token:
        raise CaptureError("capture_token_missing")
    return token


def load_settings(base: Path | None = None) -> dict:
    base = base or home()
    config_path = base / "config.json"
    secret_path = base / ".env"
    if not config_path.exists() or not secret_path.exists():
        raise CaptureError("not_configured")
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except ValueError:
        raise CaptureError("invalid_config") from None
    if not isinstance(config, dict) or not isinstance(config.get("api_url"), str):
        raise CaptureError("invalid_config")
    return {
        "api_url": endpoint(config["api_url"]),
        "token": read_secret(secret_path),
        "surface": str(config.get("surface") or "desktop-slash"),
        "pending": base / "pending",
    }


# ─── envelope + digest (must match apps/api/src/lib/capture/digest.ts) ──────

def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def envelope_digest(envelope: dict) -> str:
    rest = {k: v for k, v in envelope.items() if k != "operation_id"}
    return hashlib.sha256(canonical_json(rest).encode("utf-8")).hexdigest()


def local_timestamp(now: float | None = None) -> tuple[str, str | None]:
    """ISO-8601 with the local UTC offset, plus the zone name when known."""
    stamp = _dt.datetime.fromtimestamp(now if now is not None else time.time()).astimezone()
    tz = stamp.tzinfo.tzname(stamp) if stamp.tzinfo else None
    return stamp.isoformat(timespec="seconds"), tz


def build_envelope(text: str, surface: str = "desktop-slash", now: float | None = None) -> dict:
    captured_at, tz = local_timestamp(now)
    payload = {
        "capture_id": str(uuid.uuid4()),
        "kind": "text",
        "intent": "capture_only",
        "modality": "typed",
        "text": text,
        "captured_at": captured_at,
        "client": {"name": "hermes", "version": PLUGIN_VERSION, "surface": surface},
        "tags": [],
        "attachments": [],
    }
    if tz:
        payload["time_zone"] = tz
    return {
        "protocol_version": PROTOCOL_VERSION,
        "operation_id": str(uuid.uuid4()),
        "command": "capture.create",
        "payload": payload,
    }


# ─── pending envelopes ────────────────────────────────────────────────────

def write_pending(pending_dir: Path, envelope: dict) -> Path:
    pending_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = pending_dir / f"{envelope['operation_id']}.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(canonical_json(envelope))
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


def list_pending(pending_dir: Path) -> list[Path]:
    if not pending_dir.exists():
        return []
    return sorted(p for p in pending_dir.iterdir() if p.suffix == ".json" and p.is_file())


# ─── transport ────────────────────────────────────────────────────────────

class Api:
    def __init__(self, base: str, token: str, timeout: float = TIMEOUT_SECONDS):
        self.base = base
        self.token = token
        self.timeout = timeout
        self.opener = build_opener(_NoRedirect(), ProxyHandler({}))

    def _request(self, method: str, path: str, body: dict | None = None):
        data = canonical_json(body).encode("utf-8") if body is not None else None
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise CaptureError("api_response_too_large")
                return response.status, (json.loads(raw) if raw else {})
        except HTTPError as error:
            with error:
                try:
                    detail = json.loads(error.read(MAX_RESPONSE_BYTES) or b"{}").get("error", "")
                except ValueError:
                    detail = ""
            return error.code, {"error": detail}
        except (OSError, URLError, ValueError, TimeoutError):
            raise CaptureError("api_unavailable") from None

    def create(self, envelope: dict) -> tuple[int, dict]:
        return self._request("POST", "/api/captures", envelope)

    def operation(self, operation_id: str) -> tuple[int, dict]:
        return self._request("GET", f"/api/operations/{operation_id}")


# ─── outcomes ─────────────────────────────────────────────────────────────

def classify_create(envelope: dict, status: int, body: dict) -> tuple[str, str]:
    """('saved', capture_id) | ('rejected', code) | ('unknown', reason)."""
    if 200 <= status < 300:
        receipt = body.get("receipt") if isinstance(body, dict) else None
        if isinstance(receipt, dict) and receipt.get("capture_id") == envelope["payload"]["capture_id"] and receipt.get("receipt_kind") == "server_saved":
            return "saved", receipt["capture_id"]
        return "unknown", "unexpected_response"
    if 400 <= status < 500:
        return "rejected", str((body or {}).get("error") or f"api_http_{status}")
    return "unknown", f"api_http_{status}"


def _submit(api: Api, envelope: dict) -> tuple[str, str]:
    try:
        status, body = api.create(envelope)
    except CaptureError as error:
        return "unknown", error.code
    return classify_create(envelope, status, body)


def reconcile_pending(api: Api, pending_dir: Path) -> list[str]:
    """Settle earlier envelopes whose outcome was unknown. Returns messages."""
    messages: list[str] = []
    for path in list_pending(pending_dir):
        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            messages.append(f"Pending file {path.name} is unreadable; left in place.")
            continue
        capture_id = envelope.get("payload", {}).get("capture_id", "?")
        try:
            status, body = api.operation(envelope["operation_id"])
        except CaptureError:
            messages.append(f"Save status still unknown for an earlier capture (ref {envelope['operation_id']}); Jevi Ops is unreachable.")
            continue
        if status == 200 and (body.get("operation") or {}).get("disposition") == "applied":
            path.unlink(missing_ok=True)
            messages.append(f"Saved earlier to Jevi Ops (capture {capture_id}).")
            continue
        if status == 404:
            outcome, detail = _submit(api, envelope)
            if outcome == "saved":
                path.unlink(missing_ok=True)
                messages.append(f"Saved to Jevi Ops on retry (capture {detail}).")
            elif outcome == "rejected":
                path.unlink(missing_ok=True)
                messages.append(f"Earlier capture could not be saved: {detail} (ref {envelope['operation_id']}).")
            else:
                messages.append(f"Save status still unknown for an earlier capture (ref {envelope['operation_id']}): {detail}.")
            continue
        messages.append(f"Save status still unknown for an earlier capture (ref {envelope['operation_id']}): api_http_{status}.")
    return messages


def capture_text(text: str, settings: dict, api: Api | None = None) -> str:
    api = api or Api(settings["api_url"], settings["token"])
    notes = reconcile_pending(api, settings["pending"])
    envelope = build_envelope(text, settings["surface"])
    try:
        path = write_pending(settings["pending"], envelope)
    except OSError as error:
        return _join(notes, f"Could not save: local_spool_unwritable ({error.__class__.__name__}). Nothing was sent.")
    outcome, detail = _submit(api, envelope)
    if outcome == "saved":
        path.unlink(missing_ok=True)
        return _join(notes, f"Saved to Jevi Ops (capture {detail}).")
    if outcome == "rejected":
        path.unlink(missing_ok=True)
        return _join(notes, f"Could not save: {detail}.")
    return _join(notes, f"Save status unknown ({detail}); ref {envelope['operation_id']}. The envelope is kept and will be reconciled on the next /capture.")


def _join(notes: list[str], last: str) -> str:
    return "\n".join([*notes, last])


def capture_command(raw_args: str) -> str:
    """Slash-command handler. Always returns a string; never raises."""
    try:
        text = (raw_args or "").strip()
        if not text:
            return "Usage: /capture <text> — saves the text to Jevi Ops without running the model."
        if len(text) > MAX_TEXT_CHARS:
            return f"Could not save: text is longer than {MAX_TEXT_CHARS} characters. Nothing was sent."
        try:
            settings = load_settings()
        except CaptureError as error:
            return f"Could not save: {error.code}. See workers/hermes-capture/README.md to configure ~/.hermes/jevi-capture."
        return capture_text(text, settings)
    except Exception as error:  # noqa: BLE001 — the gateway must never see a traceback
        return f"Could not save: unexpected_error ({error.__class__.__name__})."
