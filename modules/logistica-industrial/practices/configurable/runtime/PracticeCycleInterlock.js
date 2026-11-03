/** One deliberate request authorizes one timed native cycle. Completing it
 * removes the operator permit before another container can start. This helper
 * neither changes material nor advances a processor clock. */
export default class PracticeCycleInterlock {
 constructor(runtime){this.runtime=runtime;this.requests=new Map();}
 request(record){
  const p=record&&record.components.processor;
  if(!p||p.jobs.length||!p.input.queue.length)throw Error('La estación debe tener una entrada física y ningún ciclo en curso.');
  this.requests.set(record.id,p.completed+1);
  this.runtime.setVariable(record.id,'powered',true);
  this.runtime.setVariable(record.id,'operatorAvailable',true);
  this.runtime.setVariable(record.id,'running',true);
 }
 update(){
  for(const [id,count]of this.requests){const record=this.runtime.records.get(id),p=record&&record.components.processor;
   if(!p){this.requests.delete(id);continue;}
   if(p.completed>=count){this.runtime.setVariable(id,'operatorAvailable',false);this.runtime.setVariable(id,'running',false);this.requests.delete(id);}
  }
 }
 dispose(){for(const id of this.requests.keys()){const r=this.runtime.records.get(id);if(r&&r.components.processor){this.runtime.setVariable(id,'operatorAvailable',false);this.runtime.setVariable(id,'running',false);}}this.requests.clear();}
}
