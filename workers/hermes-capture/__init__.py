"""jevi-capture — a deterministic Hermes slash command that saves text to Jevi Ops.

``/capture <text>`` runs inside the Hermes gateway process before any model
dispatch (verified for Hermes 0.18.2: plugin slash commands are resolved
in-process by tui_gateway/server.py). It POSTs a capture.create envelope to
the Jevi Ops API and reports the storage receipt — nothing here calls a
language model, and the reply text comes from the transport result, not
from generated language.

Targets the owner's interactive Hermes install (``~/.hermes``), NOT the
pinned research runtime under workers/hermes/runtime.
"""

from __future__ import annotations

from .jevi_capture import PLUGIN_VERSION, capture_command


def register(ctx):  # noqa: ANN001 — Hermes PluginContext
    ctx.register_command(
        "capture",
        capture_command,
        description="Save text to Jevi Ops without running the model",
        args_hint="<text>",
    )


__all__ = ["register", "capture_command", "PLUGIN_VERSION"]
