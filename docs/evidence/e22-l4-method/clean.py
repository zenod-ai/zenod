import json,re,collections as C,hashlib,os
d=json.load(open('/tmp/l4/voice.json'))
V=os.path.expanduser('~/github/obsidian-brain/Log')
def is_voice(x):
    h=x['head'].lower()
    if x['ct'] in('voice_note','audio'): return True
    if x['ct'] in('text','image'): return False
    return bool(re.search(r'voice note "|ptt from|voice note transcript|voice-note transcript|voice memo',h))
keep=[x for x in d if is_voice(x)]
seen={};uniq=[];dups=0
for x in keep:
    k=x['drive'] or hashlib.md5(' '.join(x['tr'].split()[:60]).encode()).hexdigest()
    if x['words']<3: k=x['id']
    if k in seen: dups+=1; seen[k]['filed']+=[f for f in x['filed'] if f not in seen[k]['filed']]; continue
    seen[k]=x;uniq.append(x)
print(len(d),len(keep),'dups',dups,'uniq',len(uniq))
for x in uniq:
    tb=x['transcriber'] or ''
    if 'card answer' in tb: ch='EpicTeam card answer'
    elif 'EpicTeam Chat' in tb: ch='EpicTeam chat'
    elif 'EpicSocial' in tb: ch='EpicSocial chat'
    elif x['src']=='whatsapp' or 'whatsapp' in x['head'].lower() or 'WhatsApp' in x['tr'][:0]: ch='WhatsApp'
    elif x['src']=='drive': ch='Drive upload'
    elif 'telegram' in x['head'].lower(): ch='Telegram'
    else: ch='other'
    x['ch']=ch
    x['ts']=x['cap'] or (x['day']+'T'+x['head'][:5]+':00Z')
json.dump(uniq,open('/tmp/l4/uniq.json','w'))
print(C.Counter(x['ch'] for x in uniq))
print(C.Counter(x['ts'][:7] for x in uniq))
o=[x for x in uniq if x['ch']=='other']
for x in o[:15]: print(x['day'],x['src'],x['ct'],x['transcriber'],x['words'],'|',x['head'][:70])
