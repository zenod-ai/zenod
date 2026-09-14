import {expect,it} from 'vitest';
import {SqliteStateStore} from 'zenod';
import {Settings} from '../src/settings.js';
it('persists organizer-only low effort per tenant and seeds from explicit environment',()=>{
 const first=new SqliteStateStore(':memory:'),second=new SqliteStateStore(':memory:');
 try{
  const a=new Settings(first),b=new Settings(second);
  expect(a.organizerReasoningEffort()).toBeUndefined();
  a.seedFromEnv({ZENOD_MODEL_CLASSIFY_REASONING_EFFORT:'low'});
  expect(new Settings(first).organizerReasoningEffort()).toBe('low');
  expect(b.organizerReasoningEffort()).toBeUndefined();
  a.set('model_classify_reasoning_effort','high');
  expect(()=>a.organizerReasoningEffort()).toThrow(/must be none, low/);
  a.applyProvision({token:'offline-provision',model_classify_reasoning_effort:'none'});expect(a.organizerReasoningEffort()).toBe('none');
  a.set('model_classify_reasoning_effort','none');expect(new Settings(first).organizerReasoningEffort()).toBe('none');
  expect(b.organizerReasoningEffort()).toBeUndefined();
  a.set('model_classify_reasoning_effort','');expect(a.organizerReasoningEffort()).toBeUndefined();
 }finally{first.close();second.close();}
});

it('persists ordered provider routing per tenant with environment, provisioning and deletion',()=>{
 const first=new SqliteStateStore(':memory:'),second=new SqliteStateStore(':memory:');
 try {
  const a=new Settings(first),b=new Settings(second);
  expect(a.organizerProviderOrder()).toBeUndefined();
  a.seedFromEnv({ZENOD_MODEL_CLASSIFY_PROVIDER_ORDER:'fireworks,together'});
  expect(new Settings(first).organizerProviderOrder()).toEqual(['fireworks','together']);
  expect(b.organizerProviderOrder()).toBeUndefined();
  for(const value of ['fireworks/priority','fireworks,fireworks','fireworks,','a,b,c,d']){a.set('model_classify_provider_order',value);expect(()=>a.organizerProviderOrder()).toThrow(/provider_order/);}
  a.applyProvision({token:'offline',model_classify_provider_order:'fireworks'});expect(a.organizerProviderOrder()).toEqual(['fireworks']);
  a.set('model_classify_provider_order','');expect(a.organizerProviderOrder()).toBeUndefined();
 }finally{first.close();second.close();}
});
