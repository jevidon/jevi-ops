"""Convert model claims into the API DTO using only collected source evidence."""
from __future__ import annotations
import json
import math
from evidence import ResearchError
FACT_KEYS = {'year', 'year_basis', 'make', 'model', 'variant', 'engine', 'fuel_powertrain', 'registration_class', 'import_origin', 'based_country', 'based_region', 'registration_country', 'registration_region'}

def require(condition, code='invalid_model_result'):
    if not condition: raise ResearchError(code)

def bounded_text(value, maximum):
    return isinstance(value, str) and 0 < len(value) <= maximum

def scalar(value):
    return isinstance(value, (str, bool, int, float)) and (not isinstance(value, str) or len(value) <= 1000) and (not isinstance(value, float) or math.isfinite(value))

def assemble(raw, collected, context, allow_proposals=True, requested_assessment_ids=()):
    require(isinstance(raw, str) and len(raw) <= 400_000)
    try: data = json.loads(raw)
    except (ValueError, TypeError): raise ResearchError('invalid_model_json') from None
    require(isinstance(data, dict))
    data.setdefault('checked_assessment_ids', [])
    require(set(data) == {'outcome', 'summary', 'claims', 'evidence', 'proposed_changes', 'missing_facts', 'uncertainty', 'checked_question', 'checked_assessment_ids'})
    checked = data['checked_assessment_ids']
    require(isinstance(checked, list) and all(isinstance(value, str) and value in requested_assessment_ids for value in checked) and len(set(checked)) == len(checked))
    if data['outcome'] == 'no_supported_change':
        require(set(checked) == set(requested_assessment_ids), 'assessment_coverage_incomplete')
    require(data['outcome'] in ('findings', 'no_supported_change', 'insufficient_evidence'))
    require(bounded_text(data['summary'], 20_000) and type(data['checked_question']) is bool)
    require(isinstance(data['evidence'], list) and len(data['evidence']) <= 10)
    sources, ids = [], set()
    for evidence in data.pop('evidence'):
        require(isinstance(evidence, dict) and set(evidence) == {'citation_id', 'supporting_locations'})
        sid = evidence['citation_id']
        require(isinstance(sid, str) and sid in collected and sid not in ids, 'unfetched_citation')
        locations = evidence['supporting_locations']
        require(isinstance(locations, list) and 1 <= len(locations) <= 20)
        for location in locations:
            require(isinstance(location, dict) and set(location) == {'location', 'excerpt'})
            require(bounded_text(location['location'], 1000) and bounded_text(location['excerpt'], 4000))
            require(location['excerpt'] in collected[sid]['content'], 'unsupported_excerpt')
        source = {key: value for key, value in collected[sid].items() if key != 'links'}
        sources.append({**source, 'supporting_locations': locations}); ids.add(sid)
    def citations(value, required):
        return isinstance(value, list) and (not required or len(value) > 0) and len(value) <= 20 and all(isinstance(sid, str) and sid in ids for sid in value)
    require(isinstance(data['claims'], list) and len(data['claims']) <= 100)
    for claim in data['claims']:
        require(isinstance(claim, dict) and set(claim) == {'kind', 'statement', 'citation_ids'})
        require(claim['kind'] in ('fact', 'interpretation', 'recommendation', 'open_question'))
        require(bounded_text(claim['statement'], 10_000) and citations(claim['citation_ids'], claim['kind'] != 'open_question'))
    require(isinstance(data['proposed_changes'], list) and len(data['proposed_changes']) <= 10)
    require(data['outcome'] == 'findings' or not data['proposed_changes'])
    require(allow_proposals or not data['proposed_changes'], 'proposals_not_authorized')
    seen = set()
    for op in data['proposed_changes']:
        require(isinstance(op, dict) and citations(op.get('citation_ids'), True) and bounded_text(op.get('reason'), 10_000))
        if op.get('type') == 'profile_facts':
            require(set(op) == {'type', 'facts', 'citation_ids', 'reason'})
            require(isinstance(op['facts'], list) and 1 <= len(op['facts']) <= 20)
            for fact in op['facts']:
                require(isinstance(fact, dict) and set(fact) == {'key', 'expected', 'value'})
                require(fact['key'] in FACT_KEYS and fact['key'] not in seen and scalar(fact['value']))
                expected = context.get('facts', {}).get(fact['key'], {}).get('value')
                require(fact['expected'] == expected, 'proposal_context_mismatch'); seen.add(fact['key'])
        elif op.get('type') == 'knowledge':
            require(set(op) <= {'type', 'rule_version_id', 'new_rule', 'assessment', 'effective', 'citation_ids', 'reason'})
            require(bool(op.get('rule_version_id')) != bool(op.get('new_rule')))
            # Tracking and authored-document writes are deliberately excluded;
            # the research context does not contain their full edit preconditions.
            assessment = op.get('assessment')
            require(isinstance(assessment, dict) and assessment.get('review_state') in ('needs_review', 'unreviewed'))
            require(assessment.get('evidence_basis') in ('official_source_supported', 'document_supported'))
            require(assessment.get('applicability') in ('unknown', 'applicable', 'not_applicable'))
            require(bounded_text(assessment.get('rationale'), 20_000))
        else: raise ResearchError('unsupported_proposal_operation')
    require(isinstance(data['missing_facts'], list) and len(data['missing_facts']) <= 20 and all(key in FACT_KEYS for key in data['missing_facts']))
    require(isinstance(data['uncertainty'], list) and len(data['uncertainty']) <= 30 and all(bounded_text(value, 4000) for value in data['uncertainty']))
    if data['outcome'] != 'insufficient_evidence':
        require(sources and data['checked_question'] and any(claim['kind'] != 'open_question' and claim['citation_ids'] for claim in data['claims']), 'substantive_evidence_required')
    return {**data, 'sources': sources}
