import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {classifyModelOption,evaluationModels} from './models.mjs';
const parse=argv=>evaluationModels(parseArgs({args:argv,options:{'classify-model':classifyModelOption,'ask-model':{type:'string'}}}).values);
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
