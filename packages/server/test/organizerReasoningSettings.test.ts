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
  expect(()=>a.organizerReasoningEffort()).toThrow(/must be low/);
  a.set('model_classify_reasoning_effort','');expect(a.organizerReasoningEffort()).toBeUndefined();
 }finally{first.close();second.close();}
});
