import json,sys,re,time
import urllib.request,os
PRICE={'claude-haiku-5-5':(0.10,0.50),'claude-sonnet-5-5':(2.0,10.0),'claude-opus-5-5':(4.0,20.0)}
CAP=1.00
spent=0.0; log=[]
def call(model,system,user,effort,max_tokens=8000):
    global spent
    if spent>CAP*0.9: raise SystemExit('budget stop at $%.3f'%spent)
    t=time.time()
    body=dict(model='anthropic/'+model.replace('claude-','claude-').replace('-5-5','-5.5'),max_tokens=max_tokens,
      messages=[{'role':'system','content':system},{'role':'user','content':user}],reasoning={'effort':effort},usage={'include':True})
    req=urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',data=json.dumps(body).encode(),
      headers={'Authorization':'Bearer '+os.environ['OPENROUTER_API_KEY'],'Content-Type':'application/json'})
    r=json.load(urllib.request.urlopen(req,timeout=600))
    u=r['usage']; pi,po=PRICE[model]
    c=u.get('cost') or (u['prompt_tokens']*pi+u['completion_tokens']*po)/1e6; spent+=c
    log.append(dict(model=model,inp=u['prompt_tokens'],out=u['completion_tokens'],usd=round(c,5),sec=round(time.time()-t,1)))
    txt=r['choices'][0]['message']['content'] or ''
    m=re.search(r'\{.*\}',txt,re.S)
    return json.loads(m.group(0))
D=json.load(open(sys.argv[1])); S=D['sample']; IDX=D['index']
P1="""You read one transcribed voice note from Jordi (a founder who records his thinking by voice; English or Spanish; transcripts have errors like "Zenot" for Zenod). Extract faithfully, nothing invented. Return only JSON:
{"gist":"one plain sentence, what this note is about","items":[{"kind":"fact|decision|idea|ask|feeling|learning","text":"short plain sentence in English","quote":"his exact words, max 20 words"}],"people_projects":["names of projects, products, people"],"language":"en|es"}
Keep 3 to 12 items, the ones he would want back in a year. Merge repeats."""
out=[]
for x in S:
    r=call('claude-haiku-5-5',P1,f"Date {x['date']}, channel {x['ch']}.\n\nTranscript:\n{x['tr']}",'low',4000)
    out.append(dict(id=x['id'],date=x['date'],p1=r)); print('p1',x['id'],len(r.get('items',[])),file=sys.stderr)
P2="""You get first-pass extractions of several of Jordi's voice notes, recorded over months, and the list of pages already in his memory tree. Link across notes. Return only JSON:
{"threads":[{"name":"short theme name","notes":["note ids"],"summary":"one sentence: what connects them","home":"best existing page from the list, or NEW: <title>"}],
 "placements":[{"note":"id","item":"item text","home":"existing page or NEW: <title>","why":"few words"}],
 "duplicates_or_tensions":["one line each: where notes repeat or contradict each other"]}
Prefer existing pages; propose a NEW page only when three or more items need it. Every item of every note gets one placement."""
pages='\n'.join(IDX)
notes=json.dumps([dict(id=o['id'],date=o['date'],**o['p1']) for o in out],ensure_ascii=False)
p2=call('claude-sonnet-5-5',P2,f"Existing pages:\n{pages}\n\nNotes:\n{notes}",'medium',16000)
print('p2 threads',len(p2.get('threads',[])),file=sys.stderr)
P3="""You get Jordi's voice notes as extracted items plus the threads that link them, with dates. Write what only shows up over time: how his thinking moved, what he keeps coming back to, decisions that held or changed, open loops he has not closed, and what this memory now lets him do that one note alone could not. Plain words, no hype. Return only JSON:
{"insights":[{"title":"short","text":"two sentences max","notes":["ids"]}],"open_loops":["one line each"],"compounding":"two or three sentences: what the joined-up memory can do now that single notes could not"}
4 to 7 insights. Every insight must name the notes it rests on."""
p3=call('claude-opus-5-5',P3,f"Notes:\n{notes}\n\nThreads:\n{json.dumps(p2,ensure_ascii=False)}",'medium',12000)
json.dump(dict(p1=out,p2=p2,p3=p3,log=log,spent=round(spent,4)),open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
print('spent',round(spent,4),file=sys.stderr)
