import {defineFunction, defineModule} from '../contracts/index.js';
import {createVoiceAssistant} from './VoiceAssistant.js';

export const voiceFunctionManifest = Object.freeze({
  id: 'assistant.voice', version: '1.0.0', capabilities: ['platform.voice'],
  provides: [{id: 'world.voice', version: '1.0.0'}],
  metadata: {title: 'Asistente de voz', description: 'Ayuda contextual en español, voz del navegador y muestras locales.'}
});
export const voiceModuleManifest = Object.freeze({id: 'shared.assistance', version: '1.0.0', metadata: {title: 'Asistencia compartida'}});

export function createVoiceFunction(options = {}) {
  const sessions = new WeakMap();
  return defineFunction({...voiceFunctionManifest,
    register(scope) {
      const port = scope.port('platform.voice') || {};
      const assistant = scope.own(createVoiceAssistant({...options, ...(port.options || {}), ...port}));
      sessions.set(scope, assistant);
      scope.provide('world.voice', assistant);
      scope.register('systems', 'guidance', {phase: 100, step: delta => assistant.step(delta)});
      if (typeof port.createUI === 'function') {
        const panel = port.createUI(assistant, scope);
        if (panel && typeof panel.dispose === 'function') scope.own(panel);
      }
    },
    pause(scope) { const assistant = sessions.get(scope); if (assistant) assistant.stop(); },
    stop(scope) { const assistant = sessions.get(scope); if (assistant) assistant.stop(); }
  });
}

export function createVoiceModule(options = {}) {
  return defineModule({...voiceModuleManifest, functions: [{...voiceFunctionManifest, load: async () => ({default: createVoiceFunction(options)})}]});
}
export default createVoiceModule;
