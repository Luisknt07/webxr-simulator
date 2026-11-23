/** Optional displays never own logistics custody. Give failed displays a
 * one-second cooldown and retain their diagnostics after disabling them. */
export class PresentationGuard {
 constructor({now=()=>performance.now(),onError=()=>{}}={}){
  this.now=now;this.onError=onError;this.failures=new Map();
 }
 run(name,action){
  const previous=this.failures.get(name),now=this.now();
  if(previous&&(previous.disabled||now<previous.retryAt))return false;
  try{action();if(previous){previous.consecutive=0;previous.retryAt=0;}return true;}
  catch(error){
   const record=previous||{name,total:0,consecutive:0};
   record.total++;record.consecutive++;
   record.message=String(error&&error.message||error).slice(0,500);
   record.retryAt=now+1000;record.disabled=record.consecutive>=3;
   this.failures.set(name,record);
   try{this.onError({...record},error);}catch(_){}
   return false;
  }
 }
 stats(){return [...this.failures.values()].map(value=>({...value}));}
 reset(){this.failures.clear();}
}

/** Recover the disposable public demonstration from its authored state. A
 * partly applied logistics step is never resumed or retried in place. */
export class DemoRecovery {
 constructor({restart,onRecovered=()=>{},onFailure=()=>{},now=()=>performance.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),delayMs=500,cooldownMs=30000}={}){
  this.restart=restart;this.onRecovered=onRecovered;this.onFailure=onFailure;
  this.now=now;this.schedule=schedule;this.cancelTimer=cancel;
  this.delayMs=delayMs;this.cooldownMs=cooldownMs;
  this.pending=null;this.lastAttempt=-Infinity;this.attempts=0;this.disposed=false;
 }
 request(){
  if(this.disposed)return false;
  if(this.pending!==null)return true;
  if(this.now()-this.lastAttempt<this.cooldownMs)return false;
  this.pending=this.schedule(()=>{
   this.pending=null;if(this.disposed)return;
   this.lastAttempt=this.now();this.attempts++;
   try{this.restart();this.onRecovered();}catch(error){this.onFailure(error);}
  },this.delayMs);
  return true;
 }
 cancel(){if(this.pending!==null)this.cancelTimer(this.pending);this.pending=null;}
 reset(){this.cancel();this.lastAttempt=-Infinity;}
 stats(){return {attempts:this.attempts,pending:this.pending!==null};}
 dispose(){this.cancel();this.disposed=true;}
}
