# Mercury review — what jevi-ops should borrow

*Review of [dmz1-7/mercury](https://github.com/dmz1-7/mercury) ("House Elf"), 2026-08-16.*

## What mercury is

Mercury is a self-hosted **household memory platform**: a Python/SQLite/FastAPI control
plane where a local LLM acts as an untrusted clerk — it only *proposes* actions as
schema-validated JSON, and Mercury validates, gates behind human approval, and writes.
It's organized around 17 enforced security invariants (hash-chained audit log,
deny-default reads, permanent taint on external content, approval tokens bound to a
mutation hash, etc.).

Two things to know before borrowing:

- **The stack doesn't transfer, the designs do.** Python/SQLite/stdlib vs our
  TS/Postgres/Fastify — we'd be porting use cases and mechanisms, not code.
- **It's a reference design more than a battle-tested app.** ~300 real tests and
  genuinely careful engineering, but one squashed commit, the framework-dependent parts
  (FastAPI, Telegram, WebAuthn, age encryption) have never actually executed, and many
  domain services are complete libraries that nothing in production calls yet. Treat the
  design decisions as the deliverable.

## Tier 1 — use cases that slot straight into jevi-ops gaps

### 1. Backup / restore-verify discipline

The strongest operational material in the repo, and jevi-ops (on a NAS, holding the only
copy of everything) has nothing like it. The unit: consistent DB snapshot +
content-addressed file store + manifest (schema version, per-table row counts, per-doc
hashes), age-encrypted, with a **restore-verify suite** reused by three callers —
restore, a migration guard (refuses to run a migration on a populated DB until a
pre-migration snapshot *passes verification*), and a monthly drill job. Plus: escrowed
key split from a read-only fetch credential, "re-issue secrets, never restore them,"
off-box byte-identity checks, and a recovery runbook written for a non-operator. This
whole complex ports cleanly to Postgres (`pg_dump` + our `scripts/db-migrate.sh`).

### 2. Receipt capture → inventory + derived reminders

Photograph a receipt, caption it "return 30d warranty 2y," get citation-backed facts
(serial, return-by, warranty-until) — and a tiny deterministic derivation table turns
each dated fact into scheduled nudges (return-window closes T−3, warranty expires T−30,
service due T−7). It never invents a deadline, caption beats OCR but conflicts are
surfaced, month math clamps correctly, retracting a fact retracts its reminders. jevi-ops
already has `inventory_items`, uploads, an LLM, and notifications — this stitches them
into a genuinely new capability. The derivation logic (`reminders/derive.py`, ~90 lines,
pure) ports near-verbatim.

### 3. Read-only finance via Actual Budget

jevi-ops has no finance surface at all. Mercury's pattern: a Node sidecar exposing
exactly four GET routes over Actual Budget, mutation-impossibility asserted *by test*
(export-surface equality, zero mutation verbs, a planted-write canary), integer cents
converted to Decimal at the boundary. If we run (or would run) Actual, this is a whole
new tab's worth of "what's in checking / how's the grocery budget" for very little risk.

### 4. Fact supersession + stale-memory lint — the LLM-wiki decay spec

Mercury's facts carry `valid_from`/`valid_until` and a `superseded_by` self-FK; nothing
is ever deleted, retraction is supersession. A quarterly job selects stale candidates
**deterministically in SQL** (expired facts, conflicting active pairs, old inferred
facts) and the model writes only a one-line rationale per already-selected item — it
selects nothing, decides nothing; output is inert keep/correct/deprecate proposals. This
maps almost one-to-one onto the forgetting-aware memory model specced for the wiki
vault, and would also fit `person_facts` and observations today.

### 5. Proposal → approval → undo loop for LLM-parsed captures

jevi-ops's voice-first capture applies the parser's output directly. Mercury's
alternative: code (never the model) assigns a tier — trivial typed notes auto-log *with
an undo token*; everything else gets a Yes/Edit/No card; voice and health always get a
read-back confirm because STT can capture the TV. The token mechanism is the gem:
`sha256(canonical(mutation))` bound single-use expiring token, edit invalidates and
reissues, redemption is one compare-and-set UPDATE, undo supersedes rather than deletes.
~150 lines of design that would make agent/watch/voice capture much more trustworthy.

## Tier 2 — design patterns worth adopting where the feature already exists

- **Weekly digest discipline** (we have `briefing`): deterministic pulls first, then
  *one* bounded synthesis call over fixed sections; every integration pull wrapped so a
  dead service renders "not connected" instead of blocking; model output escaped, never
  parsed; a deterministic fallback when the brain is offline.
- **Store-first, think-later ingestion** (we have `ingest`/`capture`): save and ack
  immediately, queue the LLM processing, revert to queued on LLM-unavailable, and return
  honest degraded-mode messages ("saved — brain offline, will process later") instead of
  500s.
- **Model-swap eval gate**: since jevi-ops points at whatever OpenAI-compatible model is
  running, borrow the quantitative gate — synthetic dataset, ≥95% schema-valid, ≥90%
  in-scope, and a *non-percentage* adversarial criterion (one swallowed injection fails),
  framed as "a failing model is a model-selection finding, not a reason to loosen
  validation."
- **Error Book** (pairs with the parser): a ledger of "the system got this wrong," filed
  by the operator or by a deterministic correction detector (≥2 edits on the same entity
  in 30 days auto-files one row); deduped, resolved by status flip, never deleted.
- **Frontier escalation with caps** (we have the Anthropic fallback switch): preview the
  exact prompt before sending anything to a hosted model, show weekly count/spend
  counters, hard-refuse over caps, and store the response as untrusted external content.
- **Mirror export**: regenerate a markdown file per entity (atomic tmp-dir + rename)
  with a `do-not-ingest` header that the ingest path hard-rejects — greppable memory
  that can never circularly feed itself back in. Natural fit for the wiki vault.
- **Health dose logging + refusal boundary** (we have `medications`): "did I take X /
  when was the last dose" answered from the log; "should I take another" refused *by a
  code classifier* (ambiguous defaults to refuse) that returns the stored protocol
  verbatim with citation instead of advice.
- **Citations as schema**: extracted facts carry source ID + content hash + character
  span, with a CHECK that an origin exists; a span that doesn't resolve is a rejected
  extraction, not a degraded one. Worth it if the wiki/observations pipeline will make
  claims from ingested documents.

## Tier 3 — probably skip

- **Multi-person machinery** (roles/grants, WebAuthn person-bound sessions, kiosk
  step-up, per-device display policies) — jevi-ops is deliberately single-user; this is
  most of mercury's complexity and solves a problem we don't have. Cherry-pick only if a
  shared wall display ever appears (`widget.ts` is adjacent).
- **Telegram as the primary channel** — we have the PWA + Pushover; adopting the
  *approval-card pattern* in our own UI beats adopting Telegram.
- **Home Assistant / Grocy** — essentially unimplemented in mercury (config stubs,
  `NotImplementedError` pulls). The one idea worth keeping: life-safety alerts must
  bypass the smart layer entirely.
- **Hash-chained audit log** — beautiful (~84 lines, frozen field tuple, re-walk
  verifier), but tamper-evidence matters less when the only writer is the operator; our
  `action_log` covers the practical need.

## Suggested starting points

The backup/restore-verify suite and the receipt → inventory → reminders pipeline are the
two highest-value first moves; each can be turned into a concrete design proposal
against the jevi-ops schema.
