import AgentController from '../../../packages/assistant-core/AgentController.js';
import RemoteVoiceProvider from '../../../packages/voice-assistant/RemoteVoiceProvider.js';
import AssistantWorkspacePanel from '../../../packages/assistant-ui/AssistantWorkspacePanel.js';
import {createAssistantActions} from './AssistantActionBridge.js';

/** Host adapter: the portable agent and visual workspace own no industrial
 * state. Removing this optional function restores the voice-only experience. */
export function assistantPort(ctx){return {create({voice}){
 const actions=createAssistantActions(ctx),identity=()=>{const client=ctx.studio&&ctx.studio.client||ctx.editor&&ctx.editor.ctx.studio&&ctx.editor.ctx.studio.client;return (client&&client.user&&client.user.id||'')+'#'+(ctx.editor&&ctx.editor.accessView&&ctx.editor.accessView.identityGeneration||0);};
 const remote=new RemoteVoiceProvider({window,backendAvailable:true,getIdentity:identity});let panel,disposed=false,elapsed=0;
 const agent=new AgentController({registry:actions.registry,isVisible:()=>!!(panel&&panel.opened&&panel.tab==='visuals'),getScope:()=>({identity:actions.bridge.identity(),roomId:ctx.editor&&ctx.editor.roomId||''}),getSnapshot:()=>{const current=actions.snapshot();return current.available?{...voice.snapshot(),...current}:current;},transport:{state:()=>remote.state(),plan:async({signal,...body})=>(await remote.request('agent',body,signal)).data,research:async({signal,...body})=>(await remote.request('research',body,signal)).data},onBegin(){voice.setEnabled(true);voice.stop(false);},onNarrate(text,source){voice.adoptSnapshot(voice.snapshot());voice.value.lastIntent='agent';voice.value.source=source;voice.lastResponse={intent:'answer',text};voice.speak(text.slice(0,700));},onStop(){voice.stop(false);}});
 remote.onChange=()=>agent.emit();remote.state();panel=new AssistantWorkspacePanel({document:window.document,context:ctx,agent});panel.mount();ctx.assistantAgent=agent;ctx.assistantWorkspace=panel;
 const previous={requestAgent:voice.options.requestAgent,agentBusy:voice.options.agentBusy,stopAgent:voice.options.stopAgent};
 voice.options.requestAgent=query=>{panel.open();return agent.ask(query);};voice.options.agentBusy=()=>agent.busy;voice.options.stopAgent=()=>agent.stop();
 return {agent,panel,step(delta){if(disposed)return;elapsed+=Number.isFinite(delta)?Math.max(0,delta):0;if(elapsed>=1){elapsed=0;remote.state();}agent.step(delta);panel.step();},dispose(){if(disposed)return;disposed=true;panel.dispose();agent.dispose();actions.dispose();remote.dispose();Object.assign(voice.options,previous);if(ctx.assistantAgent===agent)delete ctx.assistantAgent;if(ctx.assistantWorkspace===panel)delete ctx.assistantWorkspace;ctx.assistantPanelOpen=false;}};
}};}
export default assistantPort;
