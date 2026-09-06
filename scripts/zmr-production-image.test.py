import contextlib, io, json, os, pathlib, runpy, sys, tempfile, unittest
from unittest.mock import patch
SCRIPT=pathlib.Path(__file__).with_name('zmr-production-image.py')
OLD='ghcr.io/zenod-ai/zenod@sha256:c4d5fbf98818ca407ef445159965143cffc519a38f6c63e4e8c4f04230ba286d'
SHA='fb8b07c5910b3424c4a15da4e1cfaa920cee4e22'
class Flow(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
  self.app={'dockerImage':OLD,'env':'GIT_SHA='+SHA+'\nSIGNUP=0'}
  self.spec={'Image':OLD,'Env':['GIT_SHA='+SHA,'SIGNUP=0'],'Mounts':[{'Source':'keep-data','Target':'/data'}]}
  self.fail=False
  (self.root/'public-app.before.json').write_text(json.dumps(self.app))
  (self.root/'public-service.before.json').write_text(json.dumps([self.service()]))
  (self.root/'backup.log').write_text('restore_verified_at=2026-09-06')
  (self.root/'zenod-data-20260906T195603Z.tar.gz').write_bytes(b'fixture')
 def tearDown(self):self.tmp.cleanup()
 def service(self):return {'Spec':{'TaskTemplate':{'ContainerSpec':self.spec}},'UpdateStatus':{'State':'completed'}}
 def call(self,args,**kw):
  if args[0]=='curl':
   endpoint=args[-1].split('/api')[-1]
   if endpoint.startswith('/application.one'):return json.dumps(self.app).encode()
   if endpoint=='/application.update':
    if self.fail:raise RuntimeError('simulated API failure before mutation')
    self.app.update(json.loads(kw['input']))
   if endpoint=='/application.redeploy':
    self.spec.update(Image=self.app['dockerImage'],Env=self.app['env'].splitlines())
   return b'{}'
  cmd=args[-1]
  if cmd.startswith('docker service inspect'):return json.dumps([self.service()])
  if cmd.startswith('docker service ps'):return 'task1\n'
  if cmd.startswith('docker inspect'):return json.dumps([{'Status':{'State':'running'},'Spec':{'ContainerSpec':self.spec}}])
  raise AssertionError(cmd)
 def run_mode(self,mode,letter=None):
  argv=[str(SCRIPT),mode,'--state-dir',str(self.root)]
  if letter:argv+=['--candidate-sha',letter*40,'--candidate-image','ghcr.io/zenod-ai/zenod@sha256:'+letter*64]
  def health(*a,**k):return contextlib.closing(io.BytesIO(json.dumps({'status':'ok','sha':next(x.split('=',1)[1] for x in self.spec['Env'] if x.startswith('GIT_SHA='))}).encode()))
  with patch.object(sys,'argv',argv),patch.dict(os.environ,{'DOKPLOY_API_BASE':'https://fake/api','DOKPLOY_API_KEY':'test-not-secret'}),patch('subprocess.check_output',side_effect=self.call),patch('urllib.request.urlopen',side_effect=health),patch('time.sleep'),contextlib.redirect_stdout(io.StringIO()):runpy.run_path(str(SCRIPT),run_name='__main__')
 def test_override_then_plain_rollback(self):
  self.run_mode('deploy','a');self.run_mode('rollback');self.assertEqual(self.spec['Image'],OLD)
 def test_a_then_b_then_plain_rollback(self):
  self.run_mode('deploy','a');self.run_mode('deploy','b');self.run_mode('rollback');self.assertEqual(self.spec['Image'],OLD)
 def test_failed_b_does_not_forget_running_a(self):
  self.run_mode('deploy','a');self.fail=True
  with self.assertRaises(RuntimeError):self.run_mode('deploy','b')
  self.fail=False;self.run_mode('rollback');self.assertEqual(self.spec['Image'],OLD)
if __name__=='__main__':unittest.main()
