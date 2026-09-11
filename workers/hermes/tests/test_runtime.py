"""Optional real pinned Hermes driver against deterministic local provider/evidence.
Run with the pinned runtime's Python. Does not contact a real model or public site.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'adapter'))
from test_adapter import Connection, Response, model_result

@unittest.skipUnless(importlib.util.find_spec('run_agent'), 'Pinned Hermes environment required')
class NativeRuntimeTests(unittest.TestCase):
    def test_real_hermes_tool_loop_and_instruction_loading(self):
        requests=[]
        class Provider(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_POST(self):
                request=json.loads(self.rfile.read(int(self.headers['content-length'])))
                if 'messages' not in request:
                    self.send_response(404); self.end_headers(); return
                requests.append(request)
                tool_results=[m for m in request['messages'] if m['role']=='tool']
                if not tool_results:
                    message={'role':'assistant','content':None,'tool_calls':[{'id':'fetch-one','type':'function','function':{'name':'jevi_fetch','arguments':'{"url":"https://authority.example/guide"}'}}]}; finish='tool_calls'
                else:
                    message={'role':'assistant','content':json.dumps(model_result())}; finish='stop'
                if request.get('stream'):
                    delta=dict(message)
                    if delta.get('tool_calls'): delta['tool_calls'][0]['index']=0
                    chunk={'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':delta,'finish_reason':None}]}
                    ending={'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':{},'finish_reason':finish}], 'usage':{'prompt_tokens':100,'completion_tokens':50,'total_tokens':150}}
                    encoded=('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(ending)+'\n\ndata: [DONE]\n\n').encode(); media='text/event-stream'
                else:
                    encoded=json.dumps({'id':'fixture','object':'chat.completion','created':1,'model':'fixture', 'choices':[{'index':0,'message':message,'finish_reason':finish}], 'usage':{'prompt_tokens':100,'completion_tokens':50,'total_tokens':150}}).encode(); media='application/json'
                self.send_response(200); self.send_header('Content-Type',media); self.send_header('Content-Length',str(len(encoded))); self.end_headers(); self.wfile.write(encoded)
        server=ThreadingHTTPServer(('127.0.0.1',0),Provider); thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        package=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='jevi-hermes-native-test-') as folder:
            profile=Path(folder)
            for name in ['workspace','skills']: shutil.copytree(package/name,profile/name)
            shutil.copy2(package/'SOUL.md',profile/'SOUL.md'); shutil.copy2(package/'config.yaml.example',profile/'config.yaml'); (profile/'.no-bundled-skills').touch()
            env={'HERMES_HOME':str(profile),'HERMES_MODEL_KEY':'fixture-model-key','PATH':os.environ['PATH']}
            payload={'model':'fixture','model_base_url':f'http://127.0.0.1:{server.server_port}/v1','max_model_turns':4,'max_output_tokens':1000,
                'budget':{'timeout_seconds':30,'max_sources':2,'max_requests':4},'allowed_domains':['authority.example'],
                'question':'What review is recommended?','task_type':'source_verification','context':{'facts':{},'permissions':{'external_sharing_authorized':True}}}
            try:
                with patch.dict(os.environ,env,clear=True), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    import hermes_run
                    from run_agent import AIAgent
                    original_run = AIAgent.run_conversation
                    captured = []
                    def capture_result(agent, *args, **kwargs):
                        result = original_run(agent, *args, **kwargs); captured.append(result); return result
                    original=hermes_run.EvidenceCollector
                    def fixture_collector(*args): return original(*args,connect=Connection,resolve=lambda host:['93.184.216.34'])
                    Connection.responses=[Response()]; Connection.requests=[]
                    with patch.object(hermes_run,'EvidenceCollector',side_effect=fixture_collector), patch.object(AIAgent, 'run_conversation', capture_result):
                        try: result=hermes_run.run(payload)
                        except Exception as error:
                            raise AssertionError({'error':str(error),'result_errors':[item.get('error') for item in captured],'request_count':len(requests)}) from error
                self.assertEqual(result['outcome'],'no_supported_change'); self.assertEqual(len(result['sources']),1)
                self.assertEqual(len(Connection.requests),1); self.assertGreaterEqual(len(requests),2)
                serialized=json.dumps(requests)
                self.assertIn('workspace/AGENTS.md',serialized); self.assertIn('jevi-vehicle-research/SKILL.md',serialized)
                self.assertNotIn('fixture-model-key',serialized)
                self.assertNotIn('User home directory:', serialized)
                self.assertNotIn('OUT-OF-BAND USER MESSAGE', serialized)
                names={tool['function']['name'] for request in requests for tool in request.get('tools',[])}
                self.assertEqual(names,{'jevi_fetch'})
            finally: server.shutdown(); server.server_close(); thread.join()
if __name__=='__main__': unittest.main()
