import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {classifyModelOption,organizerReasoningOption,evaluationModels} from './models.mjs';
const parse=argv=>evaluationModels(parseArgs({args:argv,options:{'classify-model':classifyModelOption,'organizer-provider-order':{type:'string'},'organizer-reasoning-effort':organizerReasoningOption,'ask-model':{type:'string'}}}).values);
test('existing organizing and answer defaults remain unchanged',()=>{
 assert.deepEqual(parse([]),{classifyModel:'minimax/minimax-m3',askModel:'x-ai/grok-4.3'});
});
test('organizing override reaches adapter options without changing answer model',()=>{
 assert.deepEqual(parse(['--classify-model','deepseek/deepseek-v4.1-flash']),{classifyModel:'deepseek/deepseek-v4.1-flash',askModel:'x-ai/grok-4.3'});
 assert.deepEqual(parse(['--classify-model','synthetic/model','--ask-model','synthetic/answer']),{classifyModel:'synthetic/model',askModel:'synthetic/answer'});
});
test('empty or whitespace-altered model identifiers fail before execution',()=>{
 for(const value of ['', ' model'])assert.throws(()=>parse(['--classify-model',value]),/exact model identifiers/);
});

test('optional organizer effort is forwarded unchanged and unsupported values fail',()=>{
 assert.deepEqual(parse(['--organizer-reasoning-effort','none']),{classifyModel:'minimax/minimax-m3',askModel:'x-ai/grok-4.3',organizerReasoningEffort:'none'});
 assert.deepEqual(parse(['--organizer-reasoning-effort','low']),{classifyModel:'minimax/minimax-m3',askModel:'x-ai/grok-4.3',organizerReasoningEffort:'low'});
 for(const value of ['medium','high',''])assert.throws(()=>parse(['--organizer-reasoning-effort',value]),/must be none, low/);
});

test('forwards explicit bounded organizer providers without changing model/effort defaults',()=>{
 assert.deepEqual(parse(['--organizer-provider-order','fireworks,together']).organizerProviderOrder,['fireworks','together']);
 for(const value of ['', 'fireworks,fireworks','fireworks/priority','a,b,c,d'])assert.throws(()=>parse(['--organizer-provider-order',value]),/provider order/);
});
