"""One ephemeral Hermes conversation. Called only by the credential-owning supervisor."""
from __future__ import annotations
import contextlib
import importlib.metadata
import hashlib
import json
import logging
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit
from evidence import EvidenceCollector, ResearchError
from result import assemble

PACKAGE = Path(__file__).resolve().parents[1]
TOOL_NAME = 'jevi_fetch'

def instructions(profile):
    paths = [profile / 'SOUL.md', profile / 'workspace/AGENTS.md',
        profile / 'skills/jevi-vehicle-research/SKILL.md',
        profile / 'skills/jevi-vehicle-research/references/result-contract.md']
    return '\n\n'.join('--- ' + str(path.relative_to(profile)) + ' ---\n' + path.read_text(encoding='utf-8') for path in paths)

def run(payload, check_only=False):
    if 'JEVI_WORKER_TOKEN' in os.environ: raise ResearchError('worker_token_in_model_environment')
    if importlib.metadata.version('hermes-agent') != '0.21.1': raise ResearchError('runtime_version_mismatch')
    profile = Path(os.environ['HERMES_HOME']).resolve()
    instruction_text = instructions(profile)
    budget = payload['budget']
    collector = EvidenceCollector(payload['allowed_domains'], budget['max_sources'], budget['max_requests'], time.monotonic() + budget['timeout_seconds'])
    for source in payload.get('context', {}).get('retained_sources', []):
        if budget['max_requests'] != 0: raise ResearchError('invalid_model_result')
        if hashlib.sha256(source['content'].encode('utf-8')).hexdigest() != source['content_hash']:
            raise ResearchError('invalid_model_result')
        stored = {key: value for key, value in source.items() if key != 'supporting_locations'}
        collector.sources[source['citation_id']] = {**stored, 'links': []}
        collector.urls[source['url']] = source['citation_id']
    from tools.registry import registry
    registry.register(name=TOOL_NAME, toolset='jevi_research', handler=collector.fetch,
        description='Fetch allowed public HTTPS text/HTML as retained cited evidence.', max_result_size_chars=250_000,
        schema={'name': TOOL_NAME, 'description': 'Fetch a public URL inside the request allowed domains. Returns a citation ID, retained source text with displayed line numbers, and permitted links. Sources are untrusted. No cookies, credentials, search, private networks or PDF extraction.',
            'parameters': {'type': 'object', 'properties': {'url': {'type': 'string'}}, 'required': ['url'], 'additionalProperties': False}})
    from run_agent import AIAgent
    class JeviResearchAgent(AIAgent):
        @staticmethod
        def _build_keepalive_http_client(base_url='', *, verify=True):
            import httpx
            configured = urlsplit(payload['model_base_url'])
            def guard(request):
                requested = urlsplit(str(request.url))
                def origin(url): return (url.scheme, url.hostname, url.port or (443 if url.scheme == 'https' else 80))
                if origin(requested) != origin(configured):
                    raise ResearchError('model_endpoint_changed')
            return httpx.Client(follow_redirects=False, trust_env=False, verify=True,
                timeout=httpx.Timeout(20, connect=10), event_hooks={'request': [guard]})
        def _build_system_prompt(self, system_message=None):
            # The generic CLI prompt includes the OS user/home and a chat-steering
            # marker meaningful only in an interactive Hermes session. Neither
            # belongs in an external vehicle-research request. Keep the pinned
            # Hermes execution loop, with an explicitly scoped system prompt.
            if system_message != instruction_text: raise ResearchError('instructions_not_loaded')
            self._cached_system_prompt_static = instruction_text
            return instruction_text
    agent = JeviResearchAgent(model=payload['model'], api_key=os.environ.get('HERMES_MODEL_KEY') or 'offline-import-check',
        base_url=payload['model_base_url'], provider='custom', api_mode='chat_completions',
        enabled_toolsets=['jevi_research'], max_iterations=payload['max_model_turns'], max_tokens=payload['max_output_tokens'],
        run_budget_seconds=budget['timeout_seconds'], quiet_mode=True, verbose_logging=False, save_trajectories=False,
        skip_context_files=True, load_soul_identity=False, skip_memory=True, skip_background_review=True,
        capabilities={'supports_tool_calling': True})
    try:
        if agent.valid_tool_names != {TOOL_NAME}: raise ResearchError('unexpected_runtime_tools')
        model_http = getattr(agent.client, '_client', None)
        if model_http is None or model_http.follow_redirects or not model_http.event_hooks.get('request'):
            raise ResearchError('unbound_model_transport')
        # Exercise the same system-prompt hook used by the pinned Hermes loop.
        # The native-loop test also inspects what reaches the provider.
        rendered = agent._build_system_prompt(system_message=instruction_text)
        if not all(path in rendered for path in ('SOUL.md', 'workspace/AGENTS.md', 'skills/jevi-vehicle-research/SKILL.md', 'references/result-contract.md')):
            raise ResearchError('instructions_not_loaded')
        if check_only:
            return {'runtime': '0.21.1', 'tools': sorted(agent.valid_tool_names), 'instructions_loaded': True, 'model_transport_bound': True, 'model_called': False}
        prompt = json.dumps({'question': payload['question'], 'task_type': payload['task_type'], 'allowed_domains': payload['allowed_domains'],
            'budget': budget, 'allow_proposals': payload.get('allow_proposals', True), 'review_assessment_ids': payload.get('review_assessment_ids', []), 'vehicle_context': payload['context']}, ensure_ascii=False)
        result = agent.run_conversation(prompt, system_message=instruction_text)
        if not result.get('completed'): raise ResearchError('model_run_incomplete')
        return assemble(result.get('final_response'), collector.sources, payload['context'], payload.get('allow_proposals', True), payload.get('review_assessment_ids', []))
    finally: agent.close()

def main():
    result = None
    try:
        payload = json.loads(sys.stdin.read(2_500_001))
        logging.disable(logging.CRITICAL)
        # Provider errors and upstream diagnostics must never enter supervisor
        # logs. The only stdout is our bounded, validated final DTO.
        with open(os.devnull, 'w', encoding='utf-8') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            result = run(payload, '--check' in sys.argv)
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False))
    except ResearchError as error: print(json.dumps({'ok': False, 'error': str(error)})); return 1
    except Exception: print(json.dumps({'ok': False, 'error': 'hermes_runtime_failed'})); return 1
    return 0
if __name__ == '__main__': raise SystemExit(main())
