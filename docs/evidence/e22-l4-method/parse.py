import re,glob,json,os,sys
V=os.path.expanduser('~/github/obsidian-brain/Log')
out=[]
for f in sorted(glob.glob(V+'/2*.md')):
    day=os.path.basename(f)[:-3]
    txt=open(f).read()
    parts=re.split(r'\n(?=## )',txt)
    for p in parts:
        if not p.startswith('## '): continue
        head=p.split('\n',1)[0]
        m=re.search(r'\^(e-[0-9a-f]+)',head)
        meta=dict(re.findall(r'^- ([a-z-]+): (.*)$',p,re.M))
        ct=meta.get('content-type','')
        lowhead=head.lower()
        isvoice = ct in('voice_note','audio') or 'voice note' in lowhead or 'transcri' in p[:3000].lower()
        if not isvoice: continue
        quote='\n'.join(l[2:] if l.startswith('> ') else l[1:] for l in p.split('\n') if l.startswith('>'))
        # transcript = quote lines after the header block
        qlines=[l for l in quote.split('\n')]
        hdr_keys=('Voice note','Raw artifact','Media type','Source','Transcribed by','Extraction artifact','User context','Audio','Duration')
        body=[l for l in qlines if l.strip() and not any(l.startswith(k) for k in hdr_keys)]
        tr=' '.join(body)
        filed=re.findall(r'^- filed: \[\[([^\]]+)\]\] \(([^)]*)\)(.*)$',p,re.M)
        dur=re.search(r'(?i)duration[^0-9]{0,15}([0-9.:]+)',p)
        out.append(dict(day=day,id=m.group(1) if m else None,head=head[3:90],ct=ct,src=meta.get('source'),
          cap=meta.get('captured-at'),verb=meta.get('verbatim'),words=len(tr.split()),
          transcriber=(re.search(r'Transcribed by ([^\n]+?)\.?\n',p) or [None,None])[1],
          drive=(re.search(r'drive\.google\.com/file/d/([\w-]+)',p) or [None,None])[1],
          mediatype=(re.search(r'Media type: (\S+)',p) or [None,None])[1],
          dur=dur.group(1) if dur else None,
          filed=[dict(page=a,path=b,rest=c.strip()) for a,b,c in filed], tr=tr))
json.dump(out,open('/tmp/l4/voice.json','w'),indent=0)
print(len(out))
