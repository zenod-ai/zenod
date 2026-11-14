import json,re,collections as C,datetime as D,statistics as S
import importlib.util
u=json.load(open('/tmp/l4/uniq.json'))
WPM=131.4
for x in u:
    h=x['head'].lower()
    if 'epicteam call' in h: x['ch']='EpicTeam call'
    if x['ch']=='other':
        x['ch']='Early transcripts' if x['day']<'2026-08' else 'Other'
    ts=x['ts']
    m=re.search(r'(2026-\d\d-\d\d)',x['head']) if 'call' in h and not x['cap'] else None
    if m: ts=m.group(1)+'T00:00:00Z'
    x['date']=ts[:10]
    x['min']=x['words']/WPM
u=[x for x in u if x['words']>=3]
start=D.date(2026,5,14)
u=[x for x in u if x['date']>=str(start)]
print('notes',len(u),'hours',round(sum(x['min'] for x in u)/60,1),'words',sum(x['words'] for x in u))
print('first',min(x['date'] for x in u))
# weekly
def wk(s):
    d=D.date.fromisoformat(s); return str(d-D.timedelta(days=d.weekday()))
W=C.OrderedDict()
d=D.date(2026,5,11)
while d<=D.date(2026,11,14): W[str(d)]=[0,0.0]; d+=D.timedelta(days=7)
for x in u: w=W[wk(x['date'])]; w[0]+=1; w[1]+=x['min']
for k,v in W.items(): print(k,v[0],round(v[1]))
mins=[x['min'] for x in u]
bins=[(0,0.5,'under 30 s'),(0.5,1,'30 s to 1 min'),(1,3,'1 to 3 min'),(3,10,'3 to 10 min'),(10,30,'10 to 30 min'),(30,999,'over 30 min')]
LB=[[lab,sum(1 for m in mins if a<=m<b),round(sum(m for m in mins if a<=m<b)/60,1)] for a,b,lab in bins]
print(LB,'median min',round(S.median(mins),2),'longest',round(max(mins),1))
CH=C.Counter(); CHm=C.Counter()
for x in u: CH[x['ch']]+=1; CHm[x['ch']]+=x['min']
print([(k,v,round(CHm[k]/60,1)) for k,v in CH.most_common()])
# filed
nf=[len(x['filed']) for x in u]
allf=[f for x in u for f in x['filed']]
prov=sum(1 for f in allf if 'provisional' in f['rest'])
ops=sum(1 for f in allf if 'ops rollup' in f['rest'])
sure=[int(m.group(1)) for f in allf for m in [re.search(r'(\d+)% sure',f['rest'])] if m]
pages=C.Counter(f['page'] for f in allf)
def proj(p):
    s=[t.strip() for t in p.split('›')]
    return s[1] if len(s)>1 else s[0]
PJ=C.Counter(proj(f['path']) for f in allf)
print('filed lines',len(allf),'distinct pages',len(pages),'notes with 0 filed',nf.count(0),'mean',round(sum(nf)/len(nf),2),'median',S.median(nf),'max',max(nf))
print('provisional',prov,'ops',ops,'with % sure',len(sure),'median sure',S.median(sure) if sure else None, 'sure>=70',sum(1 for s in sure if s>=70))
print(PJ.most_common(15)); print(pages.most_common(10))
print(C.Counter(f['rest'][:25] for f in allf).most_common(8))
print(C.Counter(min(n,8) for n in nf))
json.dump(dict(u=u,W=W),open('/tmp/l4/u2.json','w'))
