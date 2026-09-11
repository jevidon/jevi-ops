import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'adapter'))
from evidence import EvidenceCollector, ResearchError, permitted_url, public_addresses
from result import assemble
from worker import WorkerError, child_environment, perform_job, run_child, main, VERSION

class Response:
    def __init__(self, body=b'<title>Authority</title><p>Review annually.</p><a href="/guide">Guide</a>', status=200, headers=None):
        self.body = io.BytesIO(body); self.status = status; self.headers = headers or {'Content-Type': 'text/html'}
    def getheader(self, key): return self.headers.get(key)
    def read(self, size): return self.body.read(size)
class Connection:
    responses = []; requests = []
    def __init__(self, host, address, timeout): self.host = host; self.address = address
    def request(self, method, path, headers): self.requests.append((self.host, self.address, path, headers))
    def getresponse(self): return self.responses.pop(0)
    def close(self): pass

def collector(requests=4, sources=3):
    return EvidenceCollector(['authority.example'], sources, requests, time.monotonic()+10, connect=Connection, resolve=lambda host:['93.184.216.34'])
def model_result():
    return {'outcome':'no_supported_change','summary':'Annual review is recommended.',
        'claims':[{'kind':'fact','statement':'Review annually.','citation_ids':['s1']}],
        'evidence':[{'citation_id':'s1','supporting_locations':[{'location':'paragraph 1','excerpt':'Review annually.'}]}],
        'proposed_changes':[],'missing_facts':[],'uncertainty':[],'checked_question':True}

class EvidenceTests(unittest.TestCase):
    def setUp(self): Connection.requests=[]; Connection.responses=[]
    def test_fetch_retains_real_content_and_hash_without_ambient_headers(self):
        Connection.responses=[Response()]; c=collector()
        result=json.loads(c.fetch({'url':'https://authority.example/guide'}))
        self.assertEqual(result['citation_id'],'s1'); stored=c.sources['s1']
        self.assertEqual(hashlib.sha256(stored['content'].encode()).hexdigest(),stored['content_hash'])
        self.assertIn('Review annually.',stored['content']); self.assertEqual(stored['publisher'],'authority.example')
        self.assertNotIn('Authorization',Connection.requests[0][3]); self.assertNotIn('Cookie',Connection.requests[0][3])
        c.fetch({'url':'https://authority.example/guide'}); self.assertEqual(len(Connection.requests),1)
    def test_redirect_cannot_escape_scope_or_send_credentials(self):
        Connection.responses=[Response(status=302,headers={'Location':'https://evil.example/collect'})]
        result=json.loads(collector().fetch({'url':'https://authority.example/'}))
        self.assertEqual(result['error'],'source_scope_denied'); self.assertEqual(len(Connection.requests),1)
        for url in ['http://authority.example','https://secret@authority.example','https://authority.example:8443','https://authority.example.evil.test']:
            with self.assertRaises(ResearchError): permitted_url(url,['authority.example'])
    def test_parallel_calls_cannot_exceed_source_budget(self):
        from concurrent.futures import ThreadPoolExecutor
        Connection.responses=[Response(), Response()]; c=collector(sources=1)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(c.fetch, [{'url':'https://authority.example/a'}, {'url':'https://authority.example/b'}]))
        self.assertEqual(len(c.sources),1); self.assertEqual(len(Connection.requests),1)
        self.assertTrue(any(json.loads(result).get('error')=='source_budget_exhausted' for result in results))
    def test_reused_source_can_be_read_without_network_and_keeps_original_retrieval(self):
        Connection.responses=[Response()]; original=collector(); original.fetch({'url':'https://authority.example/guide'})
        stored=dict(original.sources['s1']); stored['retrieved_at']='2026-01-01T00:00:00+00:00'
        reuse=collector(requests=0); reuse.sources={'s1':stored}; reuse.urls={stored['url']:'s1'}
        before=len(Connection.requests)
        reuse.fetch({'url':stored['url']}); self.assertEqual(len(Connection.requests),before)
        result=assemble(json.dumps(model_result()),reuse.sources,{})
        self.assertEqual(result['sources'][0]['retrieved_at'],'2026-01-01T00:00:00+00:00')
        self.assertEqual(result['sources'][0]['content_hash'],stored['content_hash'])
    def test_private_dns_and_mixed_public_private_answers_denied(self):
        for addresses in [['127.0.0.1'],['169.254.169.254'],['93.184.216.34','10.0.0.1'],['::1']]:
            with patch('socket.getaddrinfo',return_value=[(0,0,0,'',(address,443)) for address in addresses]):
                with self.assertRaisesRegex(ResearchError,'private_network_denied'): public_addresses('authority.example')
    def test_budget_zero_and_redirect_budget_never_make_extra_requests(self):
        c=collector(requests=0); self.assertEqual(json.loads(c.fetch({'url':'https://authority.example/'}))['error'],'request_budget_exhausted'); self.assertEqual(Connection.requests,[])
        Connection.responses=[Response(status=302,headers={'Location':'/next'})]
        c=collector(requests=1); self.assertEqual(json.loads(c.fetch({'url':'https://authority.example/'}))['error'],'request_budget_exhausted'); self.assertEqual(len(Connection.requests),1)
    def test_binary_large_and_invalid_utf8_fail_honestly(self):
        for response,code in [(Response(headers={'Content-Type':'application/pdf'}),'unsupported_source_media'),(Response(body=b'a'*1_000_001),'source_too_large'),(Response(body=b'\xff'),'unsupported_source_encoding')]:
            Connection.responses=[response]; c=collector(); self.assertEqual(json.loads(c.fetch({'url':'https://authority.example/'}))['error'],code); self.assertFalse(c.sources)
    def test_fabricated_citations_excerpt_and_preconditions_rejected(self):
        Connection.responses=[Response()]; c=collector(); c.fetch({'url':'https://authority.example/'})
        valid=assemble(json.dumps(model_result()),c.sources,{})
        self.assertEqual(valid['sources'][0]['content'],c.sources['s1']['content'])
        fabricated=model_result(); fabricated['evidence'][0]['citation_id']='invented'
        with self.assertRaisesRegex(ResearchError,'unfetched_citation'): assemble(json.dumps(fabricated),c.sources,{})
        fabricated=model_result(); fabricated['evidence'][0]['supporting_locations'][0]['excerpt']='No review required.'
        with self.assertRaisesRegex(ResearchError,'unsupported_excerpt'): assemble(json.dumps(fabricated),c.sources,{})
        fabricated=model_result(); fabricated['outcome']='findings'; fabricated['proposed_changes']=[{'type':'profile_facts','facts':[{'key':'engine','expected':'guessed','value':'hybrid'}],'citation_ids':['s1'],'reason':'guess'}]
        with self.assertRaisesRegex(ResearchError,'proposal_context_mismatch'): assemble(json.dumps(fabricated),c.sources,{})
    def test_no_change_cannot_claim_unchecked_assessment_coverage(self):
        Connection.responses=[Response()]; c=collector(); c.fetch({'url':'https://authority.example/'})
        candidate=model_result()
        with self.assertRaisesRegex(ResearchError,'assessment_coverage_incomplete'):
            assemble(json.dumps(candidate),c.sources,{},requested_assessment_ids=['assessment-one'])
        candidate['checked_assessment_ids']=['assessment-one']
        self.assertEqual(assemble(json.dumps(candidate),c.sources,{},requested_assessment_ids=['assessment-one'])['checked_assessment_ids'],['assessment-one'])
        candidate['outcome']='insufficient_evidence'; candidate['checked_assessment_ids']=[]
        self.assertEqual(assemble(json.dumps(candidate),c.sources,{},requested_assessment_ids=['assessment-one'])['checked_assessment_ids'],[])
    def test_success_requires_question_coverage_and_cited_claim(self):
        candidate=model_result(); candidate['evidence']=[]; candidate['claims']=[]
        with self.assertRaisesRegex(ResearchError,'substantive_evidence_required'): assemble(json.dumps(candidate),{}, {})

class SupervisorTests(unittest.TestCase):
    def test_failed_run_stays_degraded_while_prior_configuration_proof_allows_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); state=root/'state'; state.mkdir()
            secrets=root/'.env'; secrets.write_text('JEVI_WORKER_TOKEN=fixture-api\nHERMES_MODEL_KEY=fixture-model\n'); secrets.chmod(0o600)
            fingerprint=hashlib.sha256(json.dumps([VERSION,'test','https://model.example/v1','fixture-model']).encode()).hexdigest()
            (state/'provider-health.json').write_text(json.dumps({'fingerprint':fingerprint,'ready':True,'verified':True}))
            cfg={'installation':str(root),'api_url':'https://api.example','model':'test','model_base_url':'https://model.example/v1','poll_seconds':0,'max_model_turns':2,'max_output_tokens':512}
            health=[]
            class API:
                claims=0
                def post(self,path,body):
                    if path.endswith('/health'): health.append(body); return {}
                    self.claims+=1
                    if self.claims==1: return {'job':{'id':'job'}}
                    (state/'stop').touch(); return {'job':None}
            with patch('worker.load_config',return_value=cfg), patch('worker.runtime_check'), patch('worker.run_child',return_value={}), patch('worker.Api',return_value=API()), patch('worker.perform_job',return_value=None), patch('worker.signal.signal'), patch('worker.event'), patch.object(sys,'argv',['worker.py','run','--config',str(root/'worker.toml'),'--env',str(secrets)]):
                main()
            self.assertTrue(health[0]['ready']); self.assertTrue(health[0]['configuration_verified'])
            self.assertFalse(health[1]['ready']); self.assertTrue(health[1]['configuration_verified'])
            self.assertEqual(json.loads((state/'provider-health.json').read_text()),{'fingerprint':fingerprint,'ready':False,'verified':True})
    def test_only_model_credential_enters_child_environment(self):
        with patch.dict(os.environ,{'JEVI_WORKER_TOKEN':'owner-token','DATABASE_URL':'private-db','OPENAI_API_KEY':'ambient-key','HERMES_KANBAN_TASK':'unexpected'}):
            result=child_environment(Path('/tmp/profile'),'model-key')
        self.assertEqual(result['HERMES_MODEL_KEY'],'model-key')
        for key in ['JEVI_WORKER_TOKEN','DATABASE_URL','OPENAI_API_KEY','HERMES_KANBAN_TASK']: self.assertNotIn(key,result)
    def test_oversized_context_is_refused_before_launch(self):
        with patch('worker.subprocess.Popen') as child:
            with self.assertRaisesRegex(WorkerError,'context_payload_too_large'):
                run_child({'installation':'/tmp/unused'},'model-key',{'context':'x'*2_500_001},lambda:None,lambda:False)
        child.assert_not_called()
    def test_result_retry_reuses_exact_payload_and_no_api_token_in_prompt(self):
        from datetime import datetime,timedelta,timezone
        calls=[]; result_attempts=[]
        class API:
            def post(self,path,body):
                calls.append((path,body))
                if path.endswith('/context'): return {'permissions':{'external_sharing_authorized':True},'snapshot':'s','pagination':{}}
                if path.endswith('/result'):
                    result_attempts.append(body)
                    if len(result_attempts)==1: raise WorkerError('api_unavailable')
                    return {'result_id':'result','substantive_check':True}
                return {}
        claimed={'lease_token':'private-lease','job':{'id':'job','run_id':'run','schema_version':1,'run_deadline':(datetime.now(timezone.utc)+timedelta(minutes=1)).isoformat(),
            'request':{'question':'Review?','task_type':'vehicle_question','allowed_domains':['authority.example'],'budget':{'timeout_seconds':30,'max_requests':5,'max_sources':2}}}}
        cfg={'model':'test','model_base_url':'https://model.example/v1','max_model_turns':2,'max_output_tokens':512,'max_context_pages':1}
        with patch('worker.run_child',return_value={'outcome':'no_supported_change'}) as child, patch('worker.event'):
            receipt=perform_job(API(),cfg,{'HERMES_MODEL_KEY':'model-key','JEVI_WORKER_TOKEN':'api-key'},claimed,lambda:False)
        self.assertTrue(receipt['substantive_check']); self.assertEqual(result_attempts[0],result_attempts[1]); self.assertEqual(result_attempts[0]['operation_key'],'hermes-result:run')
        model_payload=child.call_args.args[2]
        self.assertNotIn('private-lease',json.dumps(model_payload)); self.assertNotIn('api-key',json.dumps(model_payload))
    def test_revoked_lease_stops_result_submission(self):
        class API:
            def post(self,path,body): raise WorkerError('api_http_409')
        with patch('worker.run_child') as child, patch('worker.event'):
            result=perform_job(API(),{}, {}, {'lease_token':'private-lease','job':{'id':'job','run_id':'run','schema_version':1}},lambda:False)
        self.assertIsNone(result); child.assert_not_called()

if __name__=='__main__': unittest.main()
