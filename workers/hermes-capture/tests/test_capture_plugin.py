import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))
import jevi_capture as jc  # noqa: E402

FIXTURES = REPO / "packages" / "shared" / "fixtures" / "durable-capture"


class FakeJevi(BaseHTTPRequestHandler):
    """Loopback Jevi API: records envelopes, replays like the real ledger."""

    state = {"captures": {}, "operations": {}, "posts": [], "mode": "ok", "delay": 0.0}

    def log_message(self, *_args):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/operations/"):
            op = self.path.rsplit("/", 1)[1]
            record = self.state["operations"].get(op)
            if record:
                self._send(200, {"operation": {"operation_id": op, "disposition": "applied", "status": 201, "command": "capture.create"}})
            else:
                self._send(404, {"error": "operation_not_found"})
            return
        self._send(404, {"error": "not_found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length))
        self.state["posts"].append((self.headers.get("Authorization"), body))
        mode = self.state["mode"]
        if self.state["delay"]:
            time.sleep(self.state["delay"])
        if mode == "commit_then_drop":
            # The server commits, then the response is lost.
            self.state["operations"][body["operation_id"]] = body
            self.connection.close()
            return
        if mode == "reject":
            self._send(400, {"error": "invalid_payload"})
            return
        if mode == "mismatch":
            self._send(201, {"receipt": {"capture_id": "00000000-0000-4000-8000-000000000000", "receipt_kind": "server_saved"}, "replayed": False})
            return
        prior = self.state["operations"].get(body["operation_id"])
        if prior and jc.envelope_digest(prior) != jc.envelope_digest(body):
            self._send(409, {"error": "operation_id_reused"})
            return
        replayed = prior is not None
        self.state["operations"][body["operation_id"]] = body
        self.state["captures"][body["payload"]["capture_id"]] = body
        self._send(200 if replayed else 201, {"receipt": {"capture_id": body["payload"]["capture_id"], "operation_id": body["operation_id"], "receipt_kind": "server_saved", "storage_state": "complete", "processing_state": "queued", "uploads": []}, "replayed": replayed})


class CapturePluginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeJevi)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FakeJevi.state = {"captures": {}, "operations": {}, "posts": [], "mode": "ok", "delay": 0.0}
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home / "config.json").write_text(json.dumps({"api_url": self.base}))
        secret = self.home / ".env"
        secret.write_text("JEVI_CAPTURE_TOKEN=ops_test_capture_token\n")
        os.chmod(secret, 0o600)
        os.environ["JEVI_CAPTURE_HOME"] = str(self.home)

    def tearDown(self):
        os.environ.pop("JEVI_CAPTURE_HOME", None)
        self.tmp.cleanup()

    def pending(self):
        return jc.list_pending(self.home / "pending")

    # ── contract ──
    def test_envelope_matches_the_shared_fixture_shape_and_digest_rule(self):
        fixture = json.loads((FIXTURES / "create-text.json").read_text())
        envelope = jc.build_envelope("compare the underbody protection options", now=1_757_800_000)
        self.assertEqual(set(envelope), set(fixture))
        self.assertEqual(envelope["command"], "capture.create")
        self.assertEqual(envelope["protocol_version"], 1)
        self.assertTrue(set(envelope["payload"]) <= set(fixture["payload"]) | {"time_zone"})
        self.assertEqual(envelope["payload"]["client"]["name"], "hermes")
        digest = json.loads((FIXTURES / "digest.json").read_text())
        self.assertEqual(jc.canonical_json({k: v for k, v in fixture.items() if k != "operation_id"}), digest["canonical"])
        self.assertEqual(jc.envelope_digest(fixture), digest["sha256"])

    def test_saves_with_bearer_header_and_reports_the_receipt(self):
        reply = jc.capture_command("buy filters for the furnace")
        self.assertRegex(reply, r"^Saved to Jevi Ops \(capture [0-9a-f-]{36}\)\.$")
        auth, body = FakeJevi.state["posts"][0]
        self.assertEqual(auth, "Bearer ops_test_capture_token")
        self.assertEqual(body["payload"]["text"], "buy filters for the furnace")
        self.assertEqual(self.pending(), [])

    def test_two_identical_texts_are_two_captures(self):
        jc.capture_command("same thing")
        jc.capture_command("same thing")
        ids = {p["payload"]["capture_id"] for _a, p in FakeJevi.state["posts"]}
        self.assertEqual(len(ids), 2)

    # ── configuration safety ──
    def test_secret_file_must_be_0600(self):
        os.chmod(self.home / ".env", 0o644)
        self.assertIn("secret_file_permissions_require_0600", jc.capture_command("x"))
        self.assertEqual(FakeJevi.state["posts"], [])

    def test_plain_http_off_loopback_is_refused(self):
        (self.home / "config.json").write_text(json.dumps({"api_url": "http://10.0.0.5:3001"}))
        self.assertIn("invalid_endpoint", jc.capture_command("x"))
        self.assertEqual(FakeJevi.state["posts"], [])

    def test_missing_configuration_is_reported_not_raised(self):
        os.environ["JEVI_CAPTURE_HOME"] = str(self.home / "nope")
        reply = jc.capture_command("x")
        self.assertIn("not_configured", reply)
        self.assertIn("README", reply)

    def test_empty_and_oversized_input(self):
        self.assertTrue(jc.capture_command("   ").startswith("Usage:"))
        self.assertIn("longer than", jc.capture_command("x" * 20_001))
        self.assertEqual(FakeJevi.state["posts"], [])

    # ── uncertain outcomes (CAP-03 for Hermes) ──
    def test_lost_response_keeps_the_envelope_and_reconciles_to_one_capture(self):
        FakeJevi.state["mode"] = "commit_then_drop"
        first = jc.capture_command("call the plumber")
        self.assertIn("Save status unknown", first)
        self.assertEqual(len(self.pending()), 1)
        kept = json.loads(self.pending()[0].read_text())
        self.assertIn(kept["operation_id"], first)

        FakeJevi.state["mode"] = "ok"
        second = jc.capture_command("another note")
        self.assertIn(f"Saved earlier to Jevi Ops (capture {kept['payload']['capture_id']})", second)
        self.assertIn("Saved to Jevi Ops (capture", second.splitlines()[-1])
        self.assertEqual(self.pending(), [])
        # Exactly one POST carried the first text; it was never re-sent.
        first_posts = [p for _a, p in FakeJevi.state["posts"] if p["payload"]["text"] == "call the plumber"]
        self.assertEqual(len(first_posts), 1)

    def test_unknown_then_not_found_resends_the_identical_envelope(self):
        FakeJevi.state["delay"] = 0.5
        original = jc.TIMEOUT_SECONDS
        jc.TIMEOUT_SECONDS = 0.1
        try:
            api = jc.Api(self.base, "ops_test_capture_token", timeout=0.1)
            reply = jc.capture_text("slow save", jc.load_settings(), api)
        finally:
            jc.TIMEOUT_SECONDS = original
        self.assertIn("Save status unknown (api_unavailable)", reply)
        self.assertEqual(len(self.pending()), 1)
        kept = json.loads(self.pending()[0].read_text())
        # Pretend the server never committed it (the delayed handler is discarded).
        time.sleep(0.6)
        FakeJevi.state["operations"].pop(kept["operation_id"], None)
        FakeJevi.state["delay"] = 0.0
        FakeJevi.state["posts"] = []
        reply = jc.capture_command("next")
        self.assertIn("Saved to Jevi Ops on retry", reply)
        resent = [p for _a, p in FakeJevi.state["posts"] if p["operation_id"] == kept["operation_id"]]
        self.assertEqual(resent, [kept])
        self.assertEqual(self.pending(), [])

    def test_rejection_is_reported_and_not_retried(self):
        FakeJevi.state["mode"] = "reject"
        self.assertIn("Could not save: invalid_payload", jc.capture_command("x"))
        self.assertEqual(self.pending(), [])

    def test_mismatched_receipt_is_treated_as_unknown(self):
        FakeJevi.state["mode"] = "mismatch"
        reply = jc.capture_command("x")
        self.assertIn("Save status unknown (unexpected_response)", reply)
        self.assertEqual(len(self.pending()), 1)

    def test_server_down_is_unknown_not_failure(self):
        (self.home / "config.json").write_text(json.dumps({"api_url": "http://127.0.0.1:1"}))
        reply = jc.capture_command("x")
        self.assertIn("Save status unknown (api_unavailable)", reply)
        self.assertEqual(len(self.pending()), 1)

    def test_handler_always_returns_a_string(self):
        for raw in ["", None, "ok", "x" * 30_000]:
            self.assertIsInstance(jc.capture_command(raw), str)


if __name__ == "__main__":
    unittest.main()
