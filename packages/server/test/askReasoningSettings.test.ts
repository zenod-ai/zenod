import {expect,it} from 'vitest';
import {SqliteStateStore} from 'zenod';
import {Settings} from '../src/settings.js';

it('persists ask-side reasoning effort per tenant and seeds from explicit environment',()=>{
 const first=new SqliteStateStore(':memory:'),second=new SqliteStateStore(':memory:');
 try{
  const a=new Settings(first),b=new Settings(second);
  expect(a.askReasoningEffort()).toBeUndefined();
  a.seedFromEnv({ZENOD_MODEL_ASK_REASONING_EFFORT:'low'});
  expect(new Settings(first).askReasoningEffort()).toBe('low');
  expect(b.askReasoningEffort()).toBeUndefined();
  a.set('model_ask_reasoning_effort','high');
  expect(()=>a.askReasoningEffort()).toThrow(/must be none, low/);
  a.applyProvision({token:'offline-provision',model_ask_reasoning_effort:'none'});expect(a.askReasoningEffort()).toBe('none');
  a.set('model_ask_reasoning_effort','');expect(a.askReasoningEffort()).toBeUndefined();
  expect(b.askReasoningEffort()).toBeUndefined();
 }finally{first.close();second.close();}
});
