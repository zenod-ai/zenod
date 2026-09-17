import {expect,it} from 'vitest';
import {UsageStore} from '../src/usageStore.js';

it('persists the real gateway provider cost and surfaces it in the timeline and summary',()=>{
  const store=new UsageStore(':memory:');
  try{
    store.record({operation:'answer',provider:'openrouter',model:'openai/gpt-5.6-luna',inputTokens:1000,outputTokens:100,cachedInputTokens:0,cacheCreationInputTokens:0,providerCostUsd:0.0025,generationId:'gen-1'});
    store.record({operation:'classify',provider:'openrouter',model:'openai/gpt-5.6-luna',inputTokens:10,outputTokens:5,cachedInputTokens:0,cacheCreationInputTokens:0});
    const timeline=store.timeline({limit:10});
    expect(timeline.find((r)=>r.operation==='answer')!.providerCostUsd).toBeCloseTo(0.0025,9);
    expect(timeline.find((r)=>r.operation==='classify')!.providerCostUsd).toBeNull();
    expect(store.summary(0).providerCostUsd).toBeCloseTo(0.0025,9);
    expect(store.summary(0).calls).toBe(2);
  }finally{store.close();}
});
