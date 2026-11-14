import os,re,json,collections as C,statistics as S
V=os.path.expanduser('~/github/obsidian-brain')
d=json.load(open('/tmp/l4/u2.json'))['u']
ids={x['id'] for x in d}
ref=C.defaultdict(set); kind={}
for root in ['Notes','Projects','Areas','Personas','Inbox','Archive']:
    for dp,_,fs in os.walk(os.path.join(V,root)):
        for f in fs:
            if not f.endswith('.md'): continue
            p=os.path.join(dp,f); rel=os.path.relpath(p,V)[:-3]
            t=open(p,errors='ignore').read()
            for k in set(re.findall(r'e-[0-9a-f]{6}',t)):
                if k in ids: ref[k].add(rel)
            if rel.startswith('Notes/'):
                fm=t[:600]
                kind[rel]='provisional' if re.search(r'provisional',fm,re.I) else 'sure'
for x in d:
    pg=set(ref.get(x['id'],set()))|{f['page'] for f in x['filed']}
    x['pages']=sorted(pg)
live=lambda p: not p.startswith('Archive/') and not p.startswith('Inbox/')
n=[len([p for p in x['pages'] if live(p)]) for x in d]
allp=C.Counter(p for x in d for p in x['pages'] if live(p))
print('notes',len(d),'with >=1 live page',sum(1 for k in n if k),'mean',round(sum(n)/len(n),2),'median',S.median(n),'max',max(n))
print('distinct live pages touched',len(allp), 'Notes/',sum(1 for p in allp if p.startswith('Notes/')),'Projects/',sum(1 for p in allp if p.startswith('Projects/')),'Areas/',sum(1 for p in allp if p.startswith('Areas/')))
print('links',sum(n))
print(C.Counter(min(k,10) for k in n))
# notes pages: provisional?
np=[p for p in allp if p.startswith('Notes/')]
print(C.Counter(kind.get(p) for p in np))
json.dump(d,open('/tmp/l4/u3.json','w'))
