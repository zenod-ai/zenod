# E14-S10 round 3 re-cost. Prices per million tokens, from E15-Q0 (read 2026-11-08).
OR_FLASH=(0.15,0.60)      # DeepSeek V4.1 Flash via OpenRouter, no cache benefit counted (matches measured 0.6c / 5c)
FLASH_LITE=(0.25,1.50)    # Gemini 3.1 Flash Lite via OpenRouter
DS_MISS,DS_HIT,DS_OUT=0.15,0.003,0.60   # DeepSeek direct, off-peak; peak (weekdays 01-04, 06-10 UTC) doubles
def c(tin,tout,p): return (tin*p[0]+tout*p[1])/1e6
def ds(tin,tout,hit,peak): return (tin*(1-hit)*DS_MISS+tin*hit*DS_HIT+tout*DS_OUT)/1e6*peak
units = {
 # name: (tokens in, tokens out, today's price route, cache-hit share, peak factor)
 'filing small memory': (30000,2100,OR_FLASH,0.80,1.5),
 'filing 500-page memory': (280000,10000,OR_FLASH,0.90,1.5),
 'persona run': (8000,600,FLASH_LITE,0.70,1.0),
 'desk job': (12000,1000,FLASH_LITE,0.60,1.5),
 'reflection run (30 steps)': (200000,15000,FLASH_LITE,0.80,1.0),
}
for k,(i,o,p,h,f) in units.items():
  a=c(i,o,p); b=ds(i,o,h,f)
  print(f"{k:28s} today {a*100:6.3f}c  deepseek {b*100:6.3f}c  -{(1-b/a)*100:4.0f}%")
TR=0.3  # transcription c/min, unchanged
fs=ds(30000,2100,0.80,1.5)*100; fl=ds(280000,10000,0.90,1.5)*100
print("voice note 1 min today", 0.3+c(30000,2100,OR_FLASH)*100, "deepseek", TR+fs)
# planning rates (cents)
P_old=dict(mem=1.0,ans=0.3,per=1.0,desk=0.4,ref=None,call=5.0)
P_new=dict(mem=0.4,ans=0.3,per=0.2,desk=0.2,ref=2.0,call=5.0)
def mix(P,mem_d,ans_d,per_w,desk_w,ref_m,call_m):
  m=30*mem_d*P['mem']+30*ans_d*P['ans']+per_w*30/7*P['per']+desk_w*30/7*P['desk']+(ref_m*(P['ref'] or 0))+call_m*P['call']
  return m/100
print("round2 tier1 mix on old rates", mix(P_old,4,10,7,5,0,10))
print("round2 tier1 mix on new rates", mix(P_new,4,10,7,5,0,10))
print("Zenod full mix new", mix(P_new,10,12,14,10,0,10))
print("Plus full mix new", mix(P_new,30,30,42,40,30,40))
# typical users ($/month): 2 voice notes, 3 answers 0.2c, 1 deeper 1c a day; personas 30 runs; 10 desk; 2 calls x5min x3c
def typ(note,per,desk): return (30*(2*note+3*0.2+1*1.0)+30*per+10*desk+2*5*3)/100
print("typical today", typ(0.3+0.58,0.29,0.29), "deepseek", typ(TR+fs,ds(8000,600,.7,1)*100,ds(12000,1000,.6,1.5)*100))
# Jordi: 4 notes/day large memory, 3 answers, 1 deeper, weekly sweep ~ 4 large filings, personas
def jordi(fil,per): return (30*(4*fil+3*0.2+1*1.0)+4*fil+30*per)/100
print("jordi today", jordi(c(280000,10000,OR_FLASH)*100,0.29), "deepseek", jordi(fl,ds(8000,600,.7,1)*100))
eur=1.156
for name,eurp in (('Zenod',9),('Plus',19)):
  usd=eurp*eur; fee=0.015*usd+0.25*eur; net=usd-fee
  print(name, f"price ${usd:.2f} fee ${fee:.2f} net ${net:.2f}")
  for ai in (1.0,1.5,1.8,2.4,3,3.5,5,6,9.6,10,13):
    print(f"   AI ${ai:5.2f} left ${net-ai:6.2f} {100*(net-ai)/net:4.0f}%")
