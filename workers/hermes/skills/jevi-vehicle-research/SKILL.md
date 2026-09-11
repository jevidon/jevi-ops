---
name: jevi-vehicle-research
description: Investigate an explicitly requested vehicle question, responsibility review, or source verification using the supplied Jevi Ops context and bounded public fetch tool; return cited findings and proposals for owner review.
---

Use the supplied question, allowed domains, budgets and dated context. The supervisor loads [the output contract](references/result-contract.md) alongside this skill because filesystem tools are disabled.

Fetch primary sources with `jevi_fetch`: government authorities for regulatory requirements; manufacturer documentation for service recommendations. Follow relevant links returned by the tool inside the allowed scope. There is no external search or PDF extraction tool in this package. A plausible URL, model recollection, successful fetch, or general rule alone does not establish vehicle applicability.

Each supported claim and proposed change needs citation IDs from this run and literal supporting excerpts. Preserve publisher, publication and effective-date uncertainty. A future proposal is not an enacted obligation. A negative applicability assessment is dated knowledge that can need review; it is not a permanent exemption. For missing engine, fuel, class or jurisdiction, explain what is missing instead of inferring it.

Propose only changes directly supported by retained evidence and relevant to the request. Profile facts require exact current scalar values (null when absent). Responsibility assessments must distinguish the rule from this vehicle's facts. Do not change an authored document whose body is withheld. Do not create a maintenance baseline or completion from research. The owner reviews changes before normal application services can apply them.

When allow_proposals is false, return findings and cited claims with an empty proposed_changes list.

When max_requests is zero, use only context.retained_sources from the earlier shared review. Preserve their original retrieval times and hashes; do not claim a fresh fetch. The fetch tool cannot make network requests for that job.

Only mark requested responsibility assessment IDs as checked when their rule, relevant facts and cited evidence were actually evaluated. Missing rule details or applicability facts remain unresolved; a general successful fetch cannot refresh every assessment.

Stop within the supplied source/request/time budgets. Return `insufficient_evidence` when the question remains unresolved, including failed or unsupported fetches and needed facts. Use `no_supported_change` only when real cited evidence answers the question and supports leaving the records unchanged. `checked_question` reports whether the question was substantively checked, not whether the process ran.
