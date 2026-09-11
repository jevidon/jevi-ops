#!/usr/bin/env python3
"""Lease supervisor: owns Jevi credentials; Hermes receives only scoped context."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import json
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import tomllib
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

PACKAGE = Path(__file__).resolve().parents[1]
RUNTIME = json.loads((PACKAGE / 'runtime.json').read_text(encoding='utf-8'))
VERSION = RUNTIME['adapter_version']
CAPABILITIES = ['external_fetch']

class WorkerError(Exception): pass
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs): return None

def endpoint(value, local=False):
    try:
        p = urlsplit(value)
        if p.username or p.password or p.query or p.fragment or not p.hostname: raise ValueError()
        if p.scheme != 'https' and not (local and p.scheme == 'http' and p.hostname in ('localhost', '127.0.0.1', '::1')): raise ValueError()
        return value.rstrip('/')
    except ValueError: raise WorkerError('invalid_endpoint') from None

def read_secrets(path):
    if path.stat().st_mode & 0o077: raise WorkerError('secret_file_permissions_require_0600')
    secrets = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'): continue
        key, sep, value = line.partition('=')
        if not sep or key not in ('JEVI_WORKER_TOKEN', 'HERMES_MODEL_KEY'): raise WorkerError('invalid_secret_file')
        secrets[key] = value.strip().strip('"').strip("'")
    if not all(secrets.get(key) for key in ('JEVI_WORKER_TOKEN', 'HERMES_MODEL_KEY')): raise WorkerError('worker_credentials_missing')
    return secrets

def load_config(path):
    cfg = tomllib.loads(path.read_text(encoding='utf-8'))
    cfg['installation'] = str(Path(cfg['installation']).expanduser().resolve())
    cfg['api_url'] = endpoint(cfg['api_url'], local=True)
    cfg['model_base_url'] = endpoint(cfg['model_base_url'], local=True)
    for key, low, high, default in [('poll_seconds', 2, 300, 10), ('max_model_turns', 1, 50, 20), ('max_output_tokens', 512, 16000, 6000), ('max_context_pages', 1, 20, 3)]:
        value = cfg.get(key, default)
        if type(value) is not int or not low <= value <= high: raise WorkerError('invalid_worker_budget')
        cfg[key] = value
    if not cfg.get('model') or cfg['model'] == 'choose-your-provider/model': raise WorkerError('model_not_configured')
    return cfg

class Api:
    def __init__(self, base, token):
        self.base = base; self.token = token
        self.opener = build_opener(NoRedirect(), ProxyHandler({}))
    def post(self, path, body):
        encoded = json.dumps(body, ensure_ascii=False).encode('utf-8')
        if len(encoded) > 2_500_000: raise WorkerError('result_payload_too_large')
        request = Request(self.base + path, encoded, method='POST', headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=10) as response:
                data = response.read(2_500_001)
                if len(data) > 2_500_000: raise WorkerError('api_response_too_large')
                return json.loads(data)
        except HTTPError as error: raise WorkerError('api_http_' + str(error.code)) from None
        except (OSError, URLError, ValueError): raise WorkerError('api_unavailable') from None

def child_environment(profile, model_key):
    # Allowlist, never os.environ.copy(): API/session/database/search credentials
    # and ambient Hermes integrations cannot cross the model process boundary.
    result = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT') if key in os.environ}
    result.update(HERMES_HOME=str(profile), HERMES_MODEL_KEY=model_key, PYTHONUNBUFFERED='1', PYTHONNOUSERSITE='1')
    return result

def prepare_profile(destination, template):
    for name in ('SOUL.md', 'config.yaml', '.no-bundled-skills'):
        shutil.copy2(template / name, destination / name)
    for name in ('workspace', 'skills'):
        shutil.copytree(template / name, destination / name)

def event(kind, **fields):
    # Callers supply only fixed codes, UUIDs and booleans; no URLs/questions/bodies.
    print(json.dumps({'at': int(time.time()), 'event': kind, **fields}), flush=True)

def runtime_check(installation):
    repo = installation / 'runtime'
    try:
        commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True, stderr=subprocess.DEVNULL).strip()
        changed = subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=all'], text=True, stderr=subprocess.DEVNULL).strip()
        if commit != RUNTIME['commit'] or changed or (repo / '.env').exists(): raise WorkerError('runtime_integrity_mismatch')
    except (OSError, subprocess.SubprocessError): raise WorkerError('runtime_missing') from None
    if not (repo / '.venv/bin/python').exists(): raise WorkerError('runtime_dependencies_missing')

def run_child(cfg, model_key, payload, callback, stopping, check=False):
    installation = Path(cfg['installation'])
    encoded_payload = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    if len(encoded_payload) > 2_500_000: raise WorkerError('context_payload_too_large')
    with tempfile.TemporaryDirectory(prefix='run-', dir=installation / 'runs') as folder:
        run_dir = Path(folder); profile = run_dir / 'profile'; profile.mkdir(mode=0o700)
        prepare_profile(profile, installation / 'profile')
        command = [str(installation / 'runtime/.venv/bin/python'), str(PACKAGE / 'adapter/hermes_run.py')]
        if check: command.append('--check')
        with tempfile.TemporaryFile() as output:
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL,
                cwd=profile / 'workspace', env=child_environment(profile, model_key), start_new_session=True)
            try:
                child.stdin.write(encoded_payload); child.stdin.close()
                deadline = time.monotonic() + min(payload['budget']['timeout_seconds'], 3600)
                heartbeat_at = time.monotonic() + 20
                while child.poll() is None:
                    if stopping() or time.monotonic() >= deadline: raise WorkerError('run_stopped' if stopping() else 'run_deadline_exceeded')
                    if time.monotonic() >= heartbeat_at:
                        callback(); heartbeat_at = time.monotonic() + 20
                    if output.tell() > 2_500_000: raise WorkerError('model_output_too_large')
                    time.sleep(0.2)
                output.seek(0); raw = output.read(2_500_001)
                if len(raw) > 2_500_000: raise WorkerError('model_output_too_large')
                try: response = json.loads(raw)
                except ValueError: raise WorkerError('model_output_invalid') from None
                if not response.get('ok'): raise WorkerError(response.get('error') if response.get('error') in SAFE_MODEL_ERRORS else 'hermes_runtime_failed')
                if child.returncode != 0: raise WorkerError('hermes_runtime_failed')
                return response['result']
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try: child.wait(timeout=3)
                    except subprocess.TimeoutExpired: os.killpg(child.pid, signal.SIGKILL); child.wait()

SAFE_MODEL_ERRORS = {'instructions_not_loaded', 'runtime_version_mismatch', 'unexpected_runtime_tools', 'worker_token_in_model_environment', 'invalid_model_result', 'invalid_model_json', 'unfetched_citation', 'unsupported_excerpt', 'proposal_context_mismatch', 'unsupported_proposal_operation', 'substantive_evidence_required', 'model_run_incomplete', 'hermes_runtime_failed', 'proposals_not_authorized', 'assessment_coverage_incomplete', 'unbound_model_transport'}

def payload_base(cfg):
    return {key: cfg[key] for key in ('model', 'model_base_url', 'max_model_turns', 'max_output_tokens')}

def context_pages(api, job, lease, cfg):
    path = '/api/research/jobs/' + job['id'] + '/context'
    context = api.post(path, lease)
    if context.get('permissions', {}).get('external_sharing_authorized') is not True: raise WorkerError('context_not_authorized')
    # Job-scoped API paths are constructed locally; never follow returned URLs.
    pages = 1; offset = 50
    while any(page.get('next') for page in context.get('pagination', {}).values()) and pages < cfg['max_context_pages']:
        next_context = api.post(path + '?offset=' + str(offset), lease)
        if next_context.get('snapshot') != context.get('snapshot'): raise WorkerError('context_snapshot_changed')
        for key in ('readings', 'items', 'history', 'visits', 'projects', 'source_references'):
            context[key].extend(next_context.get(key, []))
        context['pagination'] = next_context['pagination']; pages += 1; offset += 50
    if any(page.get('next') for page in context.get('pagination', {}).values()):
        context['adapter_coverage_note'] = 'Context page budget reached. Some records remain unavailable; do not assume complete history.'
    return context

def perform_job(api, cfg, secrets, claimed, stopping, onheartbeat=lambda: None):
    job = claimed['job']; lease = {'run_id': job['run_id'], 'lease_token': claimed['lease_token']}
    path = '/api/research/jobs/' + job['id']
    try:
        if job['schema_version'] != 1: raise WorkerError('unsupported_job_schema')
        context = context_pages(api, job, lease, cfg)
        api.post(path + '/heartbeat', lease)
        budget = dict(job['request']['budget'])
        from datetime import datetime, timezone
        remaining = (datetime.fromisoformat(job['run_deadline'].replace('Z', '+00:00')) - datetime.now(timezone.utc)).total_seconds()
        budget['timeout_seconds'] = min(budget['timeout_seconds'], max(1, int(remaining) - 3))
        payload = {**payload_base(cfg), 'question': job['request']['question'], 'task_type': job['request']['task_type'],
            'review_assessment_ids': job['request'].get('review_assessment_ids', []), 'allowed_domains': job['request']['allowed_domains'], 'allow_proposals': job['request'].get('allow_proposals', True), 'budget': budget, 'context': context}
        event('run_started', job_id=job['id'], run_id=job['run_id'])
        def heartbeat():
            api.post(path + '/heartbeat', lease); onheartbeat()
        result = run_child(cfg, secrets['HERMES_MODEL_KEY'], payload, heartbeat, stopping)
        body = {**lease, **result, 'operation_key': 'hermes-result:' + job['run_id']}
        # Exact payload/key retries only; API records the receipt idempotently.
        for attempt in range(3):
            try:
                receipt = api.post(path + '/result', body)
                event('result_delivered', job_id=job['id'], result_id=receipt.get('result_id'), proposal_id=receipt.get('proposal_id'), substantive_check=receipt.get('substantive_check', False))
                return {**receipt, 'external_fetch_verified': budget['max_requests'] > 0 and bool(result.get('sources'))}
            except WorkerError as error:
                if str(error) != 'api_unavailable' or attempt == 2: raise
        raise WorkerError('result_delivery_failed')
    except WorkerError as error:
        code = str(error)
        event('run_failed', job_id=job['id'], code=code)
        with contextlib.suppress(WorkerError): api.post(path + '/failure', {**lease, 'reason': code, 'retryable': code in ('api_unavailable', 'run_stopped')})
        return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['run', 'once', 'check', 'health', 'stop'])
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--env', type=Path)
    args = parser.parse_args()
    cfg = load_config(args.config.resolve()); installation = Path(cfg['installation'])
    state = installation / 'state'; stop_file = state / 'stop'; status_file = state / 'status.json'
    if args.command == 'stop': stop_file.touch(mode=0o600); event('stop_requested'); return 0
    if args.command == 'health':
        try: status = json.loads(status_file.read_text(encoding='utf-8'))
        except (OSError, ValueError): status = {'running': False}
        fresh = time.time() - status.get('at', 0) < max(60, cfg['poll_seconds'] * 2)
        print(json.dumps({**status, 'fresh': fresh})); return 0 if fresh and status.get('running') else 1
    runtime_check(installation)
    if args.command in ('check', 'run', 'once'):
        payload = {**payload_base(cfg), 'budget': {'timeout_seconds': 60, 'max_sources': 1, 'max_requests': 0}, 'allowed_domains': ['example.com']}
        check_result = run_child(cfg, '', payload, lambda: None, lambda: False, check=True)
        if args.command == 'check': print(json.dumps(check_result)); return 0
    secrets = read_secrets((args.env or args.config.with_name('.env')).resolve())
    api = Api(cfg['api_url'], secrets['JEVI_WORKER_TOKEN'])
    health_file = state / 'provider-health.json'
    fingerprint = hashlib.sha256(json.dumps([VERSION, cfg['model'], cfg['model_base_url'], secrets['HERMES_MODEL_KEY']]).encode('utf-8')).hexdigest()
    try: prior_health = json.loads(health_file.read_text(encoding='utf-8'))
    except (OSError, ValueError): prior_health = {}
    configuration_verified = prior_health.get('fingerprint') == fingerprint and prior_health.get('verified') is True
    health_ready = configuration_verified and prior_health.get('ready') is True
    health_detail = 'Model and public fetch were verified for this configuration.' if health_ready else 'The verified configuration is degraded after its last request.' if configuration_verified else 'Runtime installed; model and public fetch are untested for this configuration.'
    stopped = False
    def stop(_sig, _frame):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    def stopping(): return stopped or stop_file.exists()
    with open(state / 'worker.lock', 'a', encoding='utf-8') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise WorkerError('worker_already_running') from None
        stop_file.unlink(missing_ok=True)
        exit_code = 0
        def update_status():
            status_file.write_text(json.dumps({'at': int(time.time()), 'running': True, 'pid': os.getpid(), 'adapter_version': VERSION}), encoding='utf-8')
        try:
            while not stopping():
                update_status()
                try:
                    api.post('/api/research/health', {'adapter_version': VERSION, 'capabilities': CAPABILITIES, 'ready': health_ready, 'configuration_verified': configuration_verified, 'detail': health_detail})
                    claimed = api.post('/api/research/claim', {})
                    if claimed.get('job'):
                        receipt = perform_job(api, cfg, secrets, claimed, stopping, update_status)
                        substantive = bool(receipt and receipt.get('substantive_check'))
                        configuration_verified = configuration_verified or bool(substantive and receipt.get('external_fetch_verified'))
                        health_ready = substantive and configuration_verified
                        health_detail = 'Model and public fetch were verified for this configuration.' if health_ready else 'Latest request did not establish model and public fetch readiness.'
                        health_file.write_text(json.dumps({'fingerprint': fingerprint, 'ready': health_ready, 'verified': configuration_verified}), encoding='utf-8')
                        exit_code = 0 if substantive else 1
                    elif args.command == 'once': event('no_job_available'); exit_code = 2
                except WorkerError as error: event('poll_failed', code=str(error)); exit_code = 1
                if args.command == 'once': break
                deadline = time.monotonic() + cfg['poll_seconds']
                while time.monotonic() < deadline and not stopping(): time.sleep(0.2)
        finally:
            status_file.write_text(json.dumps({'at': int(time.time()), 'running': False, 'adapter_version': VERSION}), encoding='utf-8')
            with contextlib.suppress(WorkerError): api.post('/api/research/health', {'adapter_version': VERSION, 'capabilities': CAPABILITIES, 'ready': False, 'configuration_verified': configuration_verified, 'detail': 'Supervisor stopped.'})
    return exit_code

if __name__ == '__main__':
    os.umask(0o077)
    try: raise SystemExit(main())
    except (WorkerError, OSError, KeyError, ValueError) as error:
        event('worker_error', code=str(error) if isinstance(error, WorkerError) else 'invalid_worker_configuration')
        raise SystemExit(1)
