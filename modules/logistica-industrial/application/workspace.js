import {defineFunction, localFunction} from '../../../packages/module-sdk/index.js';
import {createLogisticsModule} from '../module.js';
import {fail} from '../../../packages/contracts/index.js';

// The existing production world is one explicit compatibility function. It
// keeps its physical load registry; the portable logical inventory is separate.
export const workspaceManifest = Object.freeze({id:'logistics.workspace',version:'1.0.0',capabilities:['domain.industrial-world'],metadata:{legacyAdapter:true,title:'Laboratorio industrial y editor',applicationLifetime:true,hotRemoval:false,hotPause:false}});
const sessions = new WeakMap();
function live(scope) {
  const session = sessions.get(scope);
  if (!scope.isCurrent() || !session || session.phase !== 'active') fail('workspace_unavailable', 'El mundo industrial ya no está disponible.');
  return session.world;
}
function detachContext(scope, context) {
  const framework = context && context.frameworkHost;
  if (!framework || framework.worldId !== scope.worldId || typeof framework.status !== 'function') return;
  const state = framework.status();
  if (state.disposed || state.functions.some(entry => entry.id === scope.id && entry.status === 'stopping')) context.frameworkHost = null;
}
export const workspaceFunction = defineFunction({...workspaceManifest,
  register(scope) {
    const world=scope.port('domain.industrial-world');
    for (const method of ['start','context','capture','dispose']) if (!world || typeof world[method] !== 'function') fail('invalid_workspace_port', 'El adaptador industrial necesita start/context/capture/dispose.');
    const session = {world, context:null, phase:'registered'}; sessions.set(scope, session);
    scope.register('commands','capture',()=>live(scope).capture());
    scope.register('commands','context',()=>live(scope).context());
    scope.register('components','legacy-document',{schemaVersion:1,format:'hello-webxr-editor',adapter:true});
    scope.onDispose(async()=>{
      session.phase='disposed'; let context=session.context;
      try { if (!context) context=world.context(); } catch (_) { /* Partial startup may not expose a context yet. */ }
      try { await world.dispose(); }
      finally { detachContext(scope,context); session.context=null; session.world=null; sessions.delete(scope); }
    });
  },
  async start(scope){
    const session=sessions.get(scope),world=session.world; session.phase='starting'; await world.start();
    // A cancelled asynchronous start must not restart its loop after shutdown.
    if (!scope.isCurrent()) { await world.dispose(); return; }
    session.context=world.context(); session.phase='active';
  },
  pause(){fail('workspace_page_lifetime','Este adaptador conserva UI, listeners y recursos de la página. Pausa la simulación desde sus controles; no se puede pausar todo el Workspace como función portable.');},
  canStop(){return {allowed:false,reason:'Workspace tiene ciclo de vida de página y todavía no libera toda su UI/listeners/GPU. Para retirarlo, guarda y recarga otra aplicación. El cierre de página usa dispose({force:true}).'};},
  stop(scope){const session=sessions.get(scope);if(session)session.phase='stopping';}
});
export const workspaceModule=createLogisticsModule([localFunction(workspaceManifest,()=>Promise.resolve(workspaceFunction))]);
