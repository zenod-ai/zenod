#!/usr/bin/env python3
"""Pinned ZMR image switch. Secure snapshot stays outside Git; never restores data."""
import argparse, json, os, pathlib, re, subprocess, sys, tempfile, time, urllib.request
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode',choices=['deploy','rollback'])
parser.add_argument('--state-dir',default=os.environ.get('ZMR_DEPLOY_STATE','/Users/jordi/.local/state/zenod-zmr-production-20260906'))
parser.add_argument('--candidate-sha')
parser.add_argument('--candidate-image')
args=parser.parse_args();MODE=args.mode;STATE=pathlib.Path(args.state_dir)
if bool(args.candidate_sha)!=bool(args.candidate_image):parser.error('Supply both candidate SHA and immutable image')
if MODE=='rollback' and args.candidate_sha:parser.error('Rollback uses frozen receipt, not candidate overrides')
for required in ['public-app.before.json','public-service.before.json','backup.log','zenod-data-20260906T195603Z.tar.gz']:
 if not (STATE/required).is_file():raise SystemExit('Missing recovery file: '+required)
if 'restore_verified_at=' not in (STATE/'backup.log').read_text():raise SystemExit('Missing restore verification receipt')
APP='2dkayH_eAur427leH64MT'; SERVICE='zenod-mt-fxpzoo'
SHA='392d058a599bdf5fc69d17157282b8f9154dcf28'
IMAGE='ghcr.io/zenod-ai/zenod@sha256:d21468dbf09f33550c52eb53bed32adea616842b4a144cd5cda428861f151a93'
INITIAL_IMAGE=IMAGE
if args.candidate_sha:
 if not re.fullmatch(r'[0-9a-f]{40}',args.candidate_sha) or not re.fullmatch(r'ghcr.io/zenod-ai/zenod@sha256:[0-9a-f]{64}',args.candidate_image):parser.error('Require full source SHA and immutable Zenod digest')
 SHA=args.candidate_sha;IMAGE=args.candidate_image
OLD_SHA='fb8b07c5910b3424c4a15da4e1cfaa920cee4e22'
OLD_IMAGE='ghcr.io/zenod-ai/zenod@sha256:c4d5fbf98818ca407ef445159965143cffc519a38f6c63e4e8c4f04230ba286d'
a=json.loads((STATE/'public-app.before.json').read_text())
service=json.loads((STATE/'public-service.before.json').read_text())[0]
def api(path,body=None):
 # Cloudflare rejects Python urllib's default fingerprint on this admin host.
 with tempfile.NamedTemporaryFile(mode='w',prefix='zmr-header-',dir=STATE) as header:
  header.write('x-api-key: '+os.environ['DOKPLOY_API_KEY']+'\nContent-Type: application/json\n');header.flush()
  args=['curl','--fail','--silent','--show-error','--max-time','60','--header','@'+header.name]
  if body is not None: args+=['-X','POST','--data-binary','@-']
  raw=subprocess.check_output(args+[os.environ['DOKPLOY_API_BASE']+path],input=json.dumps(body).encode() if body is not None else None)
  return json.loads(raw) if raw else None
def ssh(*args):return subprocess.check_output(['ssh','-o','ClearAllForwardings=yes','hetzner_vps_1',*args],text=True)
current=json.loads(ssh('docker service inspect '+SERVICE))[0]
if current['Spec']['TaskTemplate']['ContainerSpec']['Image'] not in (IMAGE,INITIAL_IMAGE,OLD_IMAGE,a['dockerImage']):raise SystemExit('Image drift; stop')
old_mounts=service['Spec']['TaskTemplate']['ContainerSpec']['Mounts']
if current['Spec']['TaskTemplate']['ContainerSpec']['Mounts'] != old_mounts:raise SystemExit('Mount drift; stop')
old_env=service['Spec']['TaskTemplate']['ContainerSpec']['Env']
current_env=current['Spec']['TaskTemplate']['ContainerSpec']['Env']
if sorted(x for x in current_env if not x.startswith('GIT_SHA='))!=sorted(x for x in old_env if not x.startswith('GIT_SHA=')):raise SystemExit('Environment drift; stop')
pending=api('/application.one?applicationId='+APP)
def stable_env(value):return sorted(line for line in value.splitlines() if not line.startswith('GIT_SHA='))
if stable_env(pending.get('env',''))!=stable_env(a['env']):raise SystemExit('Pending Dokploy environment drift; stop')
if pending.get('dockerImage') not in (IMAGE,INITIAL_IMAGE,OLD_IMAGE,a['dockerImage']):raise SystemExit('Pending Dokploy image drift; stop')
image=IMAGE if MODE=='deploy' else OLD_IMAGE
sha=SHA if MODE=='deploy' else OLD_SHA
env=a['env']
if MODE=='deploy':
 import re
 env,n=re.subn(r'^GIT_SHA=.*$', 'GIT_SHA='+SHA,env,flags=re.M)
 if n!=1:raise SystemExit('Expected exactly one GIT_SHA override')
api('/application.update',{'applicationId':APP,'sourceType':'docker','dockerImage':image,'env':env})
print('Dokploy desired image/environment updated; requesting redeploy',flush=True)
api('/application.redeploy',{'applicationId':APP,'title':'ZMR '+MODE+' '+sha[:7]})
# Dokploy is authoritative. Do not silently force an image fallback if it fails.
for attempt in range(60):
 time.sleep(5)
 try:
  live_service=json.loads(ssh('docker service inspect '+SERVICE))[0]
  observed=live_service['Spec']['TaskTemplate']['ContainerSpec']
  task_ids=ssh('docker service ps --filter desired-state=running --format {{.ID}} '+SERVICE).split()
  tasks=json.loads(ssh('docker inspect '+' '.join(task_ids))) if task_ids else []
  converged=(live_service.get('UpdateStatus',{}).get('State')=='completed' and len(tasks)==1 and tasks[0]['Status']['State']=='running' and tasks[0]['Spec']['ContainerSpec']['Image']==image)
  with urllib.request.urlopen('https://cloud.zenod.dev/api/health',timeout=8) as r: health=json.load(r)
  if converged and observed['Image']==image and health.get('sha')==sha and health.get('status')=='ok':
   if observed['Mounts']!=old_mounts:raise RuntimeError('Mount drift after deploy')
   if sorted(x for x in observed['Env'] if not x.startswith('GIT_SHA='))!=sorted(x for x in old_env if not x.startswith('GIT_SHA=')):raise RuntimeError('Environment drift after deploy')
   (STATE/(MODE+'-health.json')).write_text(json.dumps(health,indent=2))
   print(json.dumps({'mode':MODE,'image':image,'source':sha,'health':'PASS','other_env':'unchanged','mounts':'unchanged'}));break
 except (OSError,ValueError):pass
 if attempt%6==0:print('Waiting for exact image/health convergence',flush=True)
else:raise SystemExit('Deployment did not converge. Inspect; rollback command remains available.')
