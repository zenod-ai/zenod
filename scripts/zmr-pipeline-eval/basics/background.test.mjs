import test from 'node:test';import assert from 'node:assert/strict';import {backgroundFilingTracker} from './background.mjs';
test('queued capture cannot snapshot or start next case before actual filing callback',async()=>{
 const t=backgroundFilingTracker(),events=[];await t.wrapCapture(async()=>({queued:true}))();
 const drain=t.drain(1000).then(()=>events.push('snapshot/next-case'));
 await Promise.resolve();assert.deepEqual(events,[]);assert.equal(t.pending,1);
 events.push('late reconcile charged to original case');t.complete({evidenceRef:'Log/a#^e-1'});await drain;
 assert.deepEqual(events,['late reconcile charged to original case','snapshot/next-case']);assert.equal(t.receipts.length,1);
});
test('multiple callbacks, early callbacks and nonqueued captures counted exactly',async()=>{
 const t=backgroundFilingTracker();await t.wrapCapture(async()=>{t.complete({done:1});return {queued:true};})();
 await t.wrapCapture(async()=>({queued:false}))();await t.wrapCapture(async()=>({queued:true}))();assert.equal(t.pending,1);
 t.complete({done:2});await t.drain(100);assert.equal(t.pending,0);
});
test('failed background without callback is incomplete rather than synthetic completion',async()=>{
 const t=backgroundFilingTracker();await t.wrapCapture(async()=>({queued:true}))();await assert.rejects(t.drain(5),/unresolved/);assert.equal(t.pending,1);assert.deepEqual(t.receipts,[]);
});
test('capture rejection is not a phantom pending write',async()=>{const t=backgroundFilingTracker();await assert.rejects(t.wrapCapture(async()=>{throw Error('rejected');})());assert.equal(t.pending,0);await t.drain();});
