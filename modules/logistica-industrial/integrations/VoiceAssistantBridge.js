import VoiceAssistantPanel from '../../../packages/voice-assistant/VoiceAssistantPanel.js';
import samplesManifest from '../../../packages/voice-assistant/assets/manifest.json';
import {createVoiceSnapshot} from './VoiceContext.js';
import RemoteVoiceProvider from '../../../packages/voice-assistant/RemoteVoiceProvider.js';

/** The app provides this optional capability; the central host stays generic. */
export function voicePort(ctx, options = {}) {
  const dom = options.document || window.document;
  const samples = samplesManifest.samples.map(row => ({id: row.id, label: row.title, text: row.text, src: row.file}));
  const identity=()=>{const client=ctx.studio&&ctx.studio.client||ctx.editor&&ctx.editor.ctx.studio&&ctx.editor.ctx.studio.client;return (client&&client.user&&client.user.id||'')+'#'+(ctx.editor&&ctx.editor.accessView&&ctx.editor.accessView.identityGeneration||0);};
  const remote=new RemoteVoiceProvider({window,backendAvailable:options.backendAvailable===true,getIdentity:identity});
  return {window, document: dom, samples, assetBaseURL: new URL('packages/voice-assistant/assets/', dom.baseURI).href,
    remoteState:()=>remote.state(),answerQuestion:request=>remote.answerQuestion(request),synthesize:request=>remote.synthesize(request),transcribe:request=>remote.transcribe(request),
    getSnapshot: () => {
      const result = createVoiceSnapshot(ctx, {editor: ctx.editor, simulation: ctx.demo && ctx.demo.simulation, driving: ctx.demo && ctx.demo.driving, document: options.getDocument && options.getDocument(), project: options.getProject && options.getProject()});
      const xr = ctx.renderer && ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
      result.immersiveActive = !!(ctx.vrMode && xr && xr.isPresenting && session && (!session.visibilityState || session.visibilityState === 'visible'));
      result.hidden = ctx.vrMode ? !result.immersiveActive : !!dom.hidden;
      result.sessionKey=identity()+':'+result.sessionKey;
      return result;
    },
    getAudioContext: () => ctx.audioListener && ctx.audioListener.context,
    onDuck: active => {const audio = ctx.editor && ctx.editor.industrialAudio; if (audio && audio.setNarrationDucking) audio.setNarrationDucking(active);},
    createUI(assistant, scope) {
      remote.onChange=()=>assistant.emit();scope.onDispose(()=>remote.dispose());remote.state();
      const panel = new VoiceAssistantPanel({assistant, context: ctx, document: dom}); panel.mount();
      ctx.voiceAssistant = assistant; ctx.voicePanel = panel;
      let identityElapsed=0;
      scope.register('systems', 'interface', {phase: 110, step(delta) {
        identityElapsed+=Number.isFinite(delta)?Math.max(0,delta):0;if(identityElapsed>=1){identityElapsed=0;remote.state();}
        if (panel.launcher) {
          const anchor = ctx.editor && ctx.editor.active && ctx.editor.toolbar || dom.querySelector('.studio-header-actions') || dom.querySelector('.viewer-header .header-actions') || dom.body;
          if (panel.launcher.parentNode !== anchor) anchor.appendChild(panel.launcher);
          if(panel.microphoneLauncher&&panel.microphoneLauncher.parentNode!==anchor)anchor.appendChild(panel.microphoneLauncher);
          panel.launcher.classList.toggle('voice-assistant-launcher-floating', anchor === dom.body);
          if(panel.microphoneLauncher)panel.microphoneLauncher.classList.toggle('voice-assistant-microphone-floating',anchor===dom.body);
        }
        panel.step(delta);
      }});
      scope.onDispose(() => {if (ctx.voiceAssistant === assistant) delete ctx.voiceAssistant; if (ctx.voicePanel === panel) delete ctx.voicePanel; ctx.voicePanelOpen = false; const audio = ctx.editor && ctx.editor.industrialAudio; if (audio && audio.setNarrationDucking) audio.setNarrationDucking(false);});
      return panel;
    }
  };
}
