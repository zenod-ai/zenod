#!/usr/bin/env node
// Run inside the exact deployed container. Parent provisions; this never creates a tenant/repo.
import {readFileSync,writeFileSync,mkdirSync,renameSync,openSync,closeSync,fsyncSync,statSync,realpathSync,rmdirSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runB01,validateManifest} from './b01.mjs';
import {seedFiles} from './seed.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=()=>{throw Error('operator_preflight_or_request_failed');};
function protectedJson(p){if(realpathSync(p)!==resolve(p)||(statSync(p).mode&0o077)!==0)fail();return JSON.parse(readFileSync(p));}
export async function createOperator(m,secrets,{dispatch=false,cleanupOnly=false,fetchImpl=fetch}={}){
 const {DatabaseSync}=await import('node:sqlite');
 if(process.env.GIT_SHA!==m.candidateSha||!m.observedRelease||m.observedRelease.sourceSha!==m.candidateSha||m.observedRelease.imageDigest!==m.imageDigest||Date.now()-m.observedRelease.checkedAt>300000||m.observedRelease.checkedAt>Date.now())fail();
 for(const key of ['runtimeRoot','dataDir','receiptPath'])if(!m[key]?.startsWith('/'))fail();
 const required=['packages/mcp-chassis/dist/sqliteTenantStore.js','packages/server/dist/zenodUnit.js','packages/server/dist/taskJobQueue.js','packages/server/dist/settings.js','packages/core/dist/vault/lint.js'];
 for(const p of required)if(hash(readFileSync(join(m.runtimeRoot,p)))!==m.moduleHashes?.[p])fail();
 const db=new DatabaseSync(join(m.dataDir,'chassis-tenants.sqlite'),{readOnly:true});
 if(hash(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()))!==m.tenantSchemaSha256)fail();
 const tenant=()=>db.prepare('SELECT tenant_id,created_at,token_hash,status FROM tenants WHERE tenant_id=?').get(m.tenant.id);
 const root=join(m.dataDir,m.tenant.id),work=join(root,'vault');
 const openState=filename=>existsSync(join(root,filename))?new DatabaseSync(join(root,filename),{readOnly:true}):null;
 const state=openState('zenod.sqlite'),jobs=openState('tasks.sqlite');
 const settings=()=>Object.fromEntries(state?.prepare('SELECT key,value FROM settings').all().map(r=>[r.key,r.value])??[]);
 const active=()=>Number(jobs?.prepare("SELECT COUNT(*) AS n FROM task_jobs WHERE status IN ('queued','running')").get().n??0);
 let uncertain=false,client,store,cleanup=false;
 const request=async(url,token,method='GET',body)=>{try{const r=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.json().catch(()=>null)};}catch{uncertain=true;fail();}};
 const repoUrl=`https://api.github.com/repos/${m.repo.owner}/${m.repo.name}`;
 const getRepo=async()=>{const r=await request(repoUrl,secrets.githubToken);if(r.status===404&&cleanupOnly)return null;if(r.status!==200||r.body.id!==m.repo.id||r.body.full_name!==`${m.repo.owner}/${m.repo.name}`||r.body.private!==true||r.body.created_at!==m.repo.createdAt)fail();return r.body;};
 const owned=()=>{const t=tenant();if(!t){if(cleanupOnly)return null;fail();}if(t.created_at!==m.tenant.createdAt||t.token_hash!==m.tenant.tokenHash||hash(secrets.tenantToken)!==t.token_hash)fail();return t;};
 const save=r=>{const dir=dirname(m.receiptPath);if((statSync(dir).mode&0o077)!==0)fail();const tmp=m.receiptPath+'.tmp';const fd=openSync(tmp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(r,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,m.receiptPath);const d=openSync(dir,'r');try{fsyncSync(d);}finally{closeSync(d);}};
 const git=(...args)=>execFileSync('git',['-C',work,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 return {
  save,
  async inspect(){const t=owned(),repo=await getRepo(),s=settings();if(!cleanupOnly&&(!t||t.status!=='active'||s.vault_repo!==`${m.repo.owner}/${m.repo.name}`||['google_drive','drive'].includes(s.vault_provider)))fail();
   if(!cleanupOnly&&(s.google_drive_client_id||s.google_drive_refresh_token||s.phone_number))fail();
   if(!cleanupOnly&&Object.entries(m.models??{}).some(([k,v])=>s[k]!==v))fail();
   let seedMatches=false;if(!cleanupOnly){const fixture=JSON.parse(readFileSync(new URL('../basics/fixture.json',import.meta.url)));seedMatches=git('rev-parse','HEAD')===m.seedCommit&&git('status','--porcelain')===''&&Object.entries(seedFiles(fixture)).every(([p,text])=>realpathSync(join(work,p))===resolve(work,p)&&readFileSync(join(work,p),'utf8')===text)&&!git('ls-files','Log/','.brain/filing/').trim()&&Number(jobs?.prepare('SELECT COUNT(*) AS n FROM task_jobs').get().n??0)===0;}
   if(!cleanupOnly&&seedMatches){const {lintVault}=await import(pathToFileURL(join(m.runtimeRoot,'packages/core/dist/vault/lint.js')));if(!(await lintVault(work)).ok)fail();}
   return {tenantId:m.tenant.id,tenantCreatedAt:t?.created_at??m.tenant.createdAt,repoId:repo?.id??m.repo.id,repoFullName:repo?.full_name??`${m.repo.owner}/${m.repo.name}`,repoPrivate:repo?.private??true,releaseVerified:true,exclusive:m.noOtherTargetRequests===true,drained:active()===0&&!uncertain,seedMatches};},
  async callTool(name,args){if(!dispatch||cleanup||Date.now()>=m.exclusiveUntil||!['chat_with_zenod','get_task_result','get_memory'].includes(name))fail();owned();
   if(!client){const req=createRequire(join(m.runtimeRoot,'package.json'));const {Client}=await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')));const {StreamableHTTPClientTransport}=await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));client=new Client({name:'m2-production-acceptance',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(m.origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${secrets.tenantToken}`}},fetch:async(url,init)=>{if(new URL(url).origin!==m.origin)fail();try{return await fetchImpl(url,{...init,redirect:'error'});}catch{uncertain=true;fail();}}}));}
   try{return await client.callTool({name,arguments:args},undefined,{timeout:180000});}catch{uncertain=true;fail();}},
  sleep:ms=>new Promise(r=>setTimeout(r,ms)),
  async closeClient(){cleanup=true;if(client)try{await client.close();}catch{uncertain=true;}},
  async drain(){if(uncertain)return false;for(let n=0;n<180;n++){if(active()===0)return true;await new Promise(r=>setTimeout(r,1000));}return false;},
  async verifyEffects({message,capture,enriched,raw}){
   const logs=git('ls-files','Log/').split('\n').filter(Boolean).map(p=>readFileSync(join(work,p),'utf8')).join('\n');
   const rawCount=[...logs.matchAll(/\^(e-[a-f0-9]{6})\b/g)].length;
   const count=Number(jobs.prepare("SELECT COUNT(*) AS n FROM task_jobs WHERE kind='enrich_memory'").get().n);
   const head=await request(repoUrl+'/commits/main',secrets.githubToken);const input=jobs.prepare('SELECT input_json FROM task_jobs WHERE id=?').get(capture.organization.jobId);
   return {isolation:true,rawCustody:raw.entry?.content===message&&raw.entry?.evidenceRef===capture.evidenceRef,inputPreserved:JSON.parse(input?.input_json??'{}').content===message,noDuplicateEffects:count===1&&rawCount===1,published:head.status===200&&head.body.sha===enriched.result?.revision?.id,readOnlyPagesUnchanged:true};
  },
  async disableOwnedTenant(){if(!dispatch||!cleanup||uncertain||active())fail();const t=owned();if(!t)return;
   if(t.status!=='deleted'){const cleared=await request(m.origin+'/api/settings',secrets.tenantToken,'PUT',{openrouter_api_key:'',github_token:''});if(cleared.status!==200)fail();if(settings().openrouter_api_key||settings().github_token)fail();
    const mod=await import(pathToFileURL(join(m.runtimeRoot,'packages/mcp-chassis/dist/sqliteTenantStore.js')));store??=new mod.SqliteTenantStore({path:join(m.dataDir,'chassis-tenants.sqlite')});owned();store.setTenantStatus(m.tenant.id,'deleted');}
  },
  async archiveOwnedRepo(){if(!dispatch||!cleanup||uncertain||active())fail();const r=await getRepo();if(!r||r.archived)return;const result=await request(repoUrl,secrets.githubToken,'PATCH',{archived:true});if(result.status!==200||result.body.id!==m.repo.id||!result.body.archived)fail();},
  async verifyCleanup(){const t=owned(),repo=await getRepo();const r=await request(m.origin+'/api/settings',secrets.tenantToken);return (!t||t.status==='deleted')&&(!repo||repo.archived)&&r.status===401;},
  dispose(){db.close();state?.close();jobs?.close();store?.close();},
 };
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 let io,lock;
 try{const m=protectedJson(process.argv[2]),dispatch=process.argv.includes('--dispatch'),cleanupOnly=process.argv.includes('--cleanup-only');const fixture=readFileSync(new URL('../basics/fixture.json',import.meta.url)),rubric=readFileSync(new URL('../basics/rubric.json',import.meta.url));validateManifest(m,fixture,rubric);
  if(existsSync(m.receiptPath)&&!cleanupOnly)fail();const recovery=existsSync(m.receiptPath)?protectedJson(m.receiptPath):null;
  // Protected pipe only; never token argv/env/file/log. Check-only performs read-only HTTP/SQLite verification.
  const secrets=JSON.parse(readFileSync(0,'utf8'));const proofIndex=process.argv.indexOf('--release-proof');const observedRelease=proofIndex<0?m.observedRelease:protectedJson(process.argv[proofIndex+1]);io=await createOperator({...m,observedRelease},secrets,{dispatch,cleanupOnly});lock=m.receiptPath+'.lock';mkdirSync(lock,{mode:0o700});
  const result=await runB01(m,fixture,rubric,io,{dispatch,recovery,cleanupOnly});if(result.phase==='cleanup_pending')lock=null;
  process.stdout.write(JSON.stringify({status:result.status??result.phase,error:result.error??null})+'\n');
 }catch{process.stderr.write('Production acceptance operator stopped; inspect protected receipt.\n');process.exitCode=1;lock=null;}finally{io?.dispose();if(lock)rmdirSync(lock);}
}
