import {expect,it} from 'vitest';
import {AnswerCursorAliases} from '../src/llm/answerCursors.js';
it('aliases issued read cursors without changing underlying source/version tokens',()=>{
 const c=new AnswerCursorAliases(),owner=c.readOwner('Log/A.md#^e-123abc');
 const raw='opaque.version.scope.offset'.repeat(30);
 const result=JSON.parse(c.encode(JSON.stringify({readPath:'Log/A.md#^e-123abc',part:'body',body:'Evidence',nextCursor:raw}),owner));
 expect(result.nextCursor).toBe('cursor_1');expect(result.body).toBe('Evidence');
 expect(c.resolve(result.nextCursor,owner)).toBe(raw);
 expect(()=>c.resolve('cursor_99',owner)).toThrow(/Unknown cursor/);
 expect(()=>c.resolve(result.nextCursor,c.readOwner('Log/B.md#^e-123abc'))).toThrow();
 expect(()=>c.resolve(result.nextCursor,c.readOwner('Log/A.md#^e-123abc','frontmatter'))).toThrow();
 expect(()=>new AnswerCursorAliases().resolve(result.nextCursor,owner)).toThrow();
 expect(()=>c.resolve(raw,owner)).toThrow();
});
it('separates search pagination, embedded exact-entry reads and coverage continuations',()=>{
 const c=new AnswerCursorAliases();const value={pagination:{nextCursor:'search-raw'},evidence:[{passage:{readPath:'Log/A.md#^e-123abc',part:'body',nextCursor:'note-raw'}}],coverage:{continuation:[{tool:'read_note',input:{path:'Log/A.md#^e-123abc',cursor:'note-raw'}},{tool:'search_entries',input:{query:'topic',cursor:'search-raw'}}]}};
 const result=JSON.parse(c.encode(JSON.stringify(value),c.searchOwner()));
 expect(result.pagination.nextCursor).toBe('cursor_1');expect(result.evidence[0].passage.nextCursor).toBe('cursor_2');
 expect(result.coverage.continuation[0].input.cursor).toBe('cursor_2');expect(result.coverage.continuation[1].input.cursor).toBe('cursor_1');
 expect(c.resolve('cursor_1',c.searchOwner())).toBe('search-raw');
 expect(()=>c.resolve('cursor_2',c.searchOwner())).toThrow();
 expect(JSON.stringify(result)).not.toContain('-raw');
});

it('aliases an anchored multipiece search result using its read path and final real cursor',()=>{
 const cursors=new AnswerCursorAliases(),path='Log/2026-09-15.md#^e-123abc';
 const encoded=JSON.parse(cursors.encode(JSON.stringify({evidence:[{evidenceRef:path,passage:{readPath:path,part:'body',passages:[{readPath:path,part:'body',body:'first',nextCursor:'raw-middle'},{readPath:path,part:'body',body:'second',nextCursor:'raw-tail'}],nextCursor:'raw-tail'}}]}),cursors.searchOwner()));
 const packet=encoded.evidence[0].passage;expect(packet.nextCursor).toBe(packet.passages[1].nextCursor);
 expect(cursors.resolve(packet.nextCursor,cursors.readOwner(path))).toBe('raw-tail');
 expect(()=>cursors.resolve(packet.nextCursor,cursors.searchOwner())).toThrow();
 expect(packet.passages.map((p:any)=>p.body)).toEqual(['first','second']);
});
