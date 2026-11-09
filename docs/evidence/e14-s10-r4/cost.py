# E14-S10 round 4: background work on DeepSeek's own API vs OpenRouter vs (if it were allowed) OpenCode Go.
# Prices per million tokens, read 2026-11-09: api-docs.deepseek.com/quick_start/pricing and opencode.ai/docs/go.
# Token sizes and cache shares are round 3's (e14-s10-r3/cost.py), fitted to measured costs.
OR_FLASH=(0.15,0.60)      # DeepSeek V4.1 Flash via OpenRouter, no cache benefit counted (matches measured)
FLASH_LITE=(0.25,1.50)    # Gemini 3.1 Flash Lite via OpenRouter (personas, desk today)
DS_MISS,DS_HIT,DS_OUT=0.15,0.003,0.60   # DeepSeek direct and Go's metered rate are the same; peak doubles
def c(tin,tout,p): return (tin*p[0]+tout*p[1])/1e6
def ds(tin,tout,hit,peak): return (tin*(1-hit)*DS_MISS+tin*hit*DS_HIT+tout*DS_OUT)/1e6*peak
units = {
 'text note filed, small memory': (30000,2100,OR_FLASH,0.80,1.5),
 'text note filed, 500-page memory': (280000,10000,OR_FLASH,0.90,1.5),
 'persona run': (8000,600,FLASH_LITE,0.70,1.0),
 'desk job': (12000,1000,FLASH_LITE,0.60,1.5),
 'self-reflection run': (200000,15000,FLASH_LITE,0.80,1.0),
}
print("per job (cents): OpenRouter today | DeepSeek own API | Go cash if allowed ($10 buys $100 of Flash use)")
for k,(i,o,p,h,f) in units.items():
  a=c(i,o,p)*100; b=ds(i,o,h,f)*100
  print(f"  {k:34s} {a:6.3f}c | {b:6.3f}c (-{(1-b/a)*100:2.0f}%) | {b/10:6.4f}c")
# Background share of each plan's full mix (planning rates in cents, round 3 P_new); chat and calls stay on OpenRouter.
P=dict(mem=0.4,ans=0.3,per=0.2,desk=0.2,ref=2.0,call=5.0)
P_today=dict(mem=1.0,per=1.0,desk=0.4,ref=None)
def parts(P,mem_d,ans_d,per_w,desk_w,ref_m,call_m):
  bg=(30*mem_d*P['mem']+per_w*30/7*P['per']+desk_w*30/7*P['desk']+ref_m*(P['ref'] or 0))/100
  fg=(30*ans_d*P['ans']+call_m*P['call'])/100
  return bg,fg
for name,args,net in (("Zenod EUR9 fully used",(10,12,14,10,0,10),9.96),("Plus EUR19 fully used",(30,30,42,40,30,40),21.35)):
  bg,fg=parts(P,*args)
  print(f"{name}: background ${bg:.2f} on DeepSeek + chat/calls ${fg:.2f} on OpenRouter = ${bg+fg:.2f}; keeps {100*(net-bg-fg)/net:.0f}% of ${net}")
# Typical user and Jordi, from round 3: typical $1.20 total of which background about $0.45; Jordi $2.50 of which about $1.80.
note=ds(30000,2100,0.80,1.5); per=ds(8000,600,.7,1); desk=ds(12000,1000,.6,1.5)
typ_bg=30*2*note+30*per+10*desk
print(f"typical user background a month: ${typ_bg:.2f}")
big=ds(280000,10000,0.90,1.5)
jordi_bg=30*4*big+4*big+30*per
print(f"Jordi background a month: ${jordi_bg:.2f}")
for n in (5,50,200):
  print(f"{n:4d} typical users: DeepSeek ${n*typ_bg:6.2f}/month; a $10 top-up lasts {10/(n*typ_bg):5.1f} months")
print(f"Jordi plus 5 testers: ${jordi_bg+5*typ_bg:.2f}/month; $10 lasts {10/(jordi_bg+5*typ_bg):.1f} months")
