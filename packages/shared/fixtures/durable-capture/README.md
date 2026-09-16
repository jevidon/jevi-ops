# Durable capture fixtures

Shared wire examples for the capture protocol (`packages/shared/src/schemas/durable-capture.ts`).

- Parsed by `apps/api/test/durable-capture-contract.test.ts` (Zod) and by
  `workers/hermes-capture/tests` (Python), so both implementations agree
  on envelope shape and on the ledger digest.
- `digest.json` records the canonical JSON and SHA-256 of `create-text.json`
  with `operation_id` removed — the identity the server memoises replays under.
  Regenerate with `node apps/api/scripts/capture-digest.mjs` if the fixture
  changes.

All UUIDs, hashes and text here are synthetic.
