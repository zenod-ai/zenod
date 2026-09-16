/** Observe the existing captureNote queued result and engine onFilingComplete seam.
 * No synthetic completion and no access to the product's private write queue. */
export function backgroundFilingTracker(){
 let issued=0,completed=0,failure;const receipts=[];let notify;
 return {
  receipts,
  get pending(){return issued-completed;},
  wrapCapture(capture){return async(...args)=>{
   issued++;
   try{const result=await capture(...args);if(!result?.queued){issued--;notify?.();}return result;}
   catch(error){issued--;notify?.();throw error;}
  };},
  complete(result){completed++;receipts.push(result);notify?.();},
  async drain(timeoutMs=15*60*1000){
   if(failure)throw failure;
   if(completed>issued)throw new Error('evaluation_background_callback_mismatch');
   if(completed===issued)return;
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{notify=undefined;failure=new Error('evaluation_background_filing_unresolved');reject(failure);},timeoutMs);
    notify=()=>{if(completed>=issued){clearTimeout(timer);notify=undefined;completed===issued?resolve():reject(new Error('evaluation_background_callback_mismatch'));}};
    notify();
   });
  },
 };
}
