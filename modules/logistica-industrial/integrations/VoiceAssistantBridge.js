import VoiceAssistantPanel from '../../../packages/voice-assistant/VoiceAssistantPanel.js';
import samplesManifest from '../../../packages/voice-assistant/assets/manifest.json';
import {createVoiceSnapshot} from './VoiceContext.js';

/** The app provides this optional capability; the central host stays generic. */
export function voicePort(ctx, options = {}) {
  const dom = options.document || window.document;
  const samples = samplesManifest.samples.map(row => ({id: row.id, label: row.title, text: row.text, src: row.file}));
  return {window, document: dom, samples, assetBaseURL: new URL('packages/voice-assistant/assets/', dom.baseURI).href,
    getSnapshot: () => {
      const result = createVoiceSnapshot(ctx, {editor: ctx.editor, simulation: ctx.demo && ctx.demo.simulation, driving: ctx.demo && ctx.demo.driving, document: options.getDocument && options.getDocument(), project: options.getProject && options.getProject()});
      const xr = ctx.renderer && ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
      result.immersiveActive = !!(ctx.vrMode && xr && xr.isPresenting && session && (!session.visibilityState || session.visibilityState === 'visible'));
      result.hidden = ctx.vrMode ? !result.immersiveActive : !!dom.hidden;
      return result;
    },
    getAudioContext: () => ctx.audioListener && ctx.audioListener.context,
    onDuck: active => {const audio = ctx.editor && ctx.editor.industrialAudio; if (audio && audio.setNarrationDucking) audio.setNarrationDucking(active);},
    createUI(assistant, scope) {
      const panel = new VoiceAssistantPanel({assistant, context: ctx, document: dom}); panel.mount();
      ctx.voiceAssistant = assistant; ctx.voicePanel = panel;
      scope.register('systems', 'interface', {phase: 110, step(delta) {
        if (panel.launcher) {
          const anchor = ctx.editor && ctx.editor.active && ctx.editor.toolbar || dom.querySelector('.studio-header-actions') || dom.querySelector('.viewer-header .header-actions') || dom.body;
          if (panel.launcher.parentNode !== anchor) anchor.appendChild(panel.launcher);
          panel.launcher.classList.toggle('voice-assistant-launcher-floating', anchor === dom.body);
        }
        panel.step(delta);
      }});
      scope.onDispose(() => {if (ctx.voiceAssistant === assistant) delete ctx.voiceAssistant; if (ctx.voicePanel === panel) delete ctx.voicePanel; ctx.voicePanelOpen = false; const audio = ctx.editor && ctx.editor.industrialAudio; if (audio && audio.setNarrationDucking) audio.setNarrationDucking(false);});
      return panel;
    }
  };
}
