# Live Hermes acceptance case

Status: **skipped at the owner's request on 11 September 2026; not executed**. The owner does not have Hermes available locally and removed this test from the current build task's completion requirements. This prepared T45/M2 live model, public-source, stale-refusal and owner-approval case is retained for optional future verification. The installed runtime and deterministic tests are recorded in [10-IMPLEMENTATION-STATUS.md](10-IMPLEMENTATION-STATUS.md); neither substitutes for a live result.

## Configuration if this test is run later

To run this test later, identify the real tool-calling model endpoint and model, or the location of its configuration. The repository's loopback `mock-model` is not suitable. Keep the model credential in the fresh installation's private `.env`; do not paste it into the conversation. Follow the [worker runbook](../../workers/hermes/README.md) for the pinned installation and separate restricted Jevi worker token.

Use the retained disposable onboarding smoke installation, not an owner's real vehicle or database. Its current test asset is `e27260d5-c9db-4574-981f-c36169894045`; verify it still exists in the isolated environment before submitting anything. If the fixture has been recreated, use its replacement test asset. The smoke servers are currently stopped and can be restarted with the dedicated controller. Keep monitoring disabled.

## Question and bounded request

The question tests a supported knowledge proposal without inventing vehicle specifications, service history or inspection dates. It asks about a source's limits, not the test vehicle's legal compliance. The model must decide what the fetched page actually supports; the instructions below are not evidence and do not predetermine a successful result.

Prepare this owner request for `POST /api/research/jobs`. Replace `TEST_ASSET_UUID` and `RESTRICTED_WORKER_UUID` with verified IDs from the disposable installation. Use a new operation key for each distinct request; retain the same key when retrying delivery of that request.

```json
{
  "operation_key": "m2-live-wof-scope-stale-1",
  "asset_id": "TEST_ASSET_UUID",
  "worker_id": "RESTRICTED_WORKER_UUID",
  "task_type": "vehicle_question",
  "question": "Read https://www.consumerprotection.govt.nz/help-product-service/cars/pre-purchase-inspections-checks. Using only the fetched page, explain what a Warrant of Fitness does and does not establish about a car's condition and whether it replaces a pre-purchase inspection. Retain literal supporting excerpts and distinguish source statements from interpretation. If supported, propose one service-recommendation reference about reviewing mechanical-condition evidence separately from a WoF. For this test vehicle, leave applicability unknown because a current purchase or inspection need has not been established. Explain that uncertainty in the assessment. Do not invent vehicle facts, historical work, inspection dates, service intervals or legal obligations. Do not propose tracking or document changes. If the page cannot support a reference, return the appropriate unresolved/no-supported-change result and explain why.",
  "allowed_domains": ["www.consumerprotection.govt.nz"],
  "budget": {
    "timeout_seconds": 180,
    "max_sources": 1,
    "max_requests": 4
  },
  "max_attempts": 1,
  "allow_proposals": true,
  "authorized_source_ids": [],
  "review_assessment_ids": []
}
```

Use at most two live requests initially: one stale attempt and one fresh approval. Each has the bounds above and the installation's explicit model turn/output-token limits. An unresolved answer remains unresolved; do not manufacture a proposal or silently broaden budgets to obtain a passing result.

The request example passed the current `ResearchJobInputSchema` after substituting valid fixture UUIDs. No request was submitted by that validation. Documentation code fences and relative links also passed checks.

## Execution and acceptance

1. Verify the isolated environment, model configuration, runtime check and restricted worker binding. Record the runtime/adapter versions and the model identifier without credentials. Queue the first request through the owner session.
2. Run `workers/hermes/scripts/smoke.sh --config /absolute/private/jevi-hermes/worker.toml` against the configured fresh installation. Check the actual result rather than treating process exit or health as approval.
3. Inspect the actual source URL, retrieval timestamp, retained content hash and literal excerpts. Confirm that the proposal is limited to a source-supported reference and an unknown applicability assessment. The result should make no claim that this vehicle is compliant, serviced, roadworthy or due for an inspection.
4. Obtain the first proposal's preview. Before approval, make one explicit, reversible edit to the disposable asset's authored document through its normal editor. Submit the previously reviewed approval and verify `409 proposal_stale` with no application receipt, knowledge application or maintenance change. Restore the synthetic document if desired. Its new version still invalidates the old research snapshot; a fresh preview cannot repair that old result.
5. Queue the same question with a new operation key, such as `m2-live-wof-scope-current-1`, so it captures the current asset snapshot. Run one new smoke request. Inspect its sources and proposal again, preview it, and use the owner approval flow while the asset remains unchanged.
6. Confirm the application receipt, accepted reference/assessment and linked retained evidence. Confirm that applicability remains unknown and no maintenance item, due date, historical visit or vehicle fact was created by this proposal. Check that a repeated delivery of the same approval returns the original receipt without another application.
7. Record both jobs' IDs and outcomes, result/proposal IDs, source URLs/hashes, stale-refusal evidence and the successful application receipt in the implementation report. Revoke the temporary worker token, disable the test worker, and stop the isolated servers. Mark this live test as passed only when the real sourced result and reviewed application are evidenced.

## Source access preflight

On 11 September 2026 NZ time, the packaged `EvidenceCollector` fetched the official [Consumer Protection pre-purchase inspections page](https://www.consumerprotection.govt.nz/help-product-service/cars/pre-purchase-inspections-checks) over public HTTPS and extracted the section addressing WoF limitations. This page distinguishes a safety check from evidence of overall mechanical condition and a pre-purchase inspection. It is a suitable candidate for the narrow question above, subject to checking what the page says when the worker actually runs.

The preflight retained 14,219 characters at `2026-09-10T21:38:32.774465+00:00`; the retained-text SHA256 was `df2981c76868f4675f47a850636f866361b10a974dd8fd6ad613d19e5abee8b4`. This is a fetch-only observation, not a model result, stored research job or acceptance receipt. Do not pin future acceptance to this hash: the live run must fetch and retain its own actual evidence.

Both hostname variants of the initially considered NZTA WoF page returned `source_empty` through this fetcher. No bypass was attempted. The selected Consumer Protection page was tested successfully using the adapter's existing restrictions.
