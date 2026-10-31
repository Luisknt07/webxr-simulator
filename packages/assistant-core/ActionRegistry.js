import {TOOL_DEFINITIONS,validateToolCall} from './contracts.js';

const error=(message,code)=>Object.assign(new Error(message),{code});
const clone=value=>JSON.parse(JSON.stringify(value));

/** Typed local capability registry. A model receives only declarations; host
 * handlers remain private closures and must revalidate their own authority. */
export class ActionRegistry{
  constructor({definitions=TOOL_DEFINITIONS,validate=validateToolCall,getIdentity=()=>'',guard}={}){
    this.catalog=new Map(definitions.map(row=>[row.name,row]));this.handlers=new Map();this.validate=validate;this.getIdentity=getIdentity;this.guard=guard;this.disposed=false;this.mutating=false;
  }
  register(name,handler){
    if(this.disposed)throw error('El asistente ya está cerrado.','assistant_disposed');
    if(!this.catalog.has(name)||typeof handler!=='function')throw error('La acción no está declarada.','unknown_tool');
    if(this.handlers.has(name))throw error('La acción ya está registrada.','duplicate_tool');
    this.handlers.set(name,handler);return this;
  }
  has(name){return !this.disposed&&this.handlers.has(name);}
  definitions(){return [...this.handlers.keys()].map(name=>clone(this.catalog.get(name)));}
  async execute(name,args={},options={}){
    if(this.disposed)throw error('El asistente ya está cerrado.','assistant_disposed');
    const handler=this.handlers.get(name),definition=this.catalog.get(name);if(!handler||!definition)throw error('Esta función no está disponible en el proyecto actual.','unknown_tool');
    const identity=String(this.getIdentity()||''),assertCurrent=()=>{if(this.disposed)throw error('El asistente ya está cerrado.','assistant_disposed');if(options.signal&&options.signal.aborted)throw error('La acción se canceló.','assistant_cancelled');if(identity!==String(this.getIdentity()||'')||options.expectedIdentity!==undefined&&options.expectedIdentity!==identity)throw error('La cuenta o el proyecto cambió. Vuelve a pedir la acción.','session_changed');};
    assertCurrent();const validated=this.validate(name,args);const parameters=validated&&validated.name===name&&validated.args?validated.args:validated;
    const mutation=definition.effect!=='read';if(mutation&&this.mutating)throw error('Espera a que termine la acción anterior.','assistant_busy');
    const execution={...options,name,definition,identity,assertCurrent};if(this.guard)this.guard(execution,parameters);if(mutation)this.mutating=true;
    try{const result=await handler(parameters,execution);assertCurrent();return result;}finally{if(mutation)this.mutating=false;}
  }
  dispose(){this.disposed=true;this.handlers.clear();}
}
export default ActionRegistry;
