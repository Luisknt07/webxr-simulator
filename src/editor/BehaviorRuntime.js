import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';

const {normalizeBehaviors, simulationTypes = []} = behaviorSchema;
let nextRuntimeId = 0;

function visibleInTree(object) {
  for (let current = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}

function portalEffects(object) {
  const effects = [], seen = new Set(), owner = object.userData.editorId;
  const visit = node => {
    if (node !== object && (node.userData.editorHelper || node.userData.editorRuntimeHelper ||
        node.userData.editorId && node.userData.editorId !== owner ||
        node.userData.editorVisualOwnerId && node.userData.editorVisualOwnerId !== owner)) return;
    if (node.material && !node.userData.editorGeometryReplaced) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        if (!material.isShaderMaterial || seen.has(material)) return;
        seen.add(material);
        const uniforms = material.uniforms || {};
        const numeric = key => uniforms[key] && typeof uniforms[key].value === 'number' &&
          Number.isFinite(uniforms[key].value) ? uniforms[key] : null;
        const time = numeric('time'), selected = numeric('selected');
        if (time || selected) effects.push({time, selected, initialTime: time && time.value});
      });
    }
    node.children.forEach(visit);
  };
  visit(object);
  return effects;
}

/** Creates fresh runtime resources for each object; only serializable settings copy. */
export default class BehaviorRuntime {
  constructor(ctx, document, library, notify) {
    this.ctx = ctx;
    this.document = document;
    this.library = library;
    this.notify = notify || (() => {});
    this.prefix = 'editor-behavior-' + (++nextRuntimeId) + '-';
    this.sequence = 0;
    this.generation = 0;
    this.states = [];
    this.components = [];
  }

  stop() {
    this.generation++;
    this.states.forEach(entry => {
      if (this.ctx.raycontrol.states[entry.name] !== entry.state) return;
      this.ctx.raycontrol.deactivateState(entry.name);
      delete this.ctx.raycontrol.states[entry.name];
    });
    this.states = [];
    this.components.slice().reverse().forEach(component => {
      try { if (component.dispose) component.dispose(); }
      catch (error) { this.notify('No se pudo liberar una función: ' + error.message); }
    });
    this.components = [];
  }

  start(roomId) {
    this.stop();
    const visited = new Set();
    this.document.getObjects(roomId).forEach(object => {
      if (!object || visited.has(object) || object.userData.editorHelper || object.userData.editorRuntimeHelper) return;
      // The document indexes logical descendants itself. A wrapper's visual
      // content can carry source metadata but never owns a second component.
      if (object.userData.editorVisualOwnerId) return;
      visited.add(object);
      const nativeTypes = object.userData.editorNativeBehaviorTypes || [];
      let behaviors;
      try {
        behaviors = normalizeBehaviors(this.document.getBehaviors ? this.document.getBehaviors(object) :
          object.userData.editorBehaviors || object.userData.editorDefaultBehaviors || []);
      } catch (error) {
        this.notify(error.message);
        behaviors = [];
      }
      const interactive = [];
      behaviors.forEach(config => {
        // Decals keep the same renderer in authoring and play/VR, independent
        // of the interactive components started and stopped here.
        if (!config.enabled || config.type === 'collision' || config.type === 'decal' || config.type === 'surfaceMaterial' || config.type === 'surfaceWear' ||
            nativeTypes.includes(config.type) || simulationTypes.includes(config.type)) return;
        try {
          const component = this.create(object, config);
          if (!component) return;
          component.object = object;
          // Only portal shader uniforms are purely decorative. Floating and
          // imported animation clips may move physical doors or machinery, so
          // their poses must keep advancing outside the camera's view.
          component.visualOnly = config.type === 'portal';
          this.components.push(component);
          if (component.state) interactive.push(component.state);
          if (component.states) interactive.push(...component.states);
        } catch (error) {
          this.notify('No se pudo iniciar ' + config.type + ': ' + error.message);
        }
      });
      if (interactive.length) this.register(object, interactive);
    });
  }

  register(object, states) {
    // RayControl chooses one state per hit. Combine compatible components on an
    // object so a click can, for example, play a sound and activate a portal.
    const groups = new Map();
    states.forEach(state => {
      const key = (state.controller || 'primary') + ':' + (state.raycaster === false ? 'direct' : 'ray');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(state);
    });
    groups.forEach(group => {
      const name = this.prefix + (++this.sequence);
      const state = {
        colliderMesh: object, controller: group[0].controller || 'primary',
        raycaster: group[0].raycaster !== false, consumeSelect: true, mergeSelection: true,
        vrOnly: group.every(part => part.vrOnly === true)
      };
      const style = group.find(part => part.lineStyleOnIntersection);
      if (style) state.lineStyleOnIntersection = style.lineStyleOnIntersection;
      ['onHover', 'onHoverLeave', 'onSelectStart', 'onSelectEnd'].forEach(event => {
        if (!group.some(part => part[event])) return;
        state[event] = (...args) => {
          if (this.ctx.editor && this.ctx.editor.active) return;
          const controller = event === 'onHover' || event === 'onHoverLeave' ? args[2] : args[1];
          group.forEach(part => {
            if (part.vrOnly && controller && controller.userData && controller.userData.isDesktop) return;
            if (part[event]) part[event](...args);
          });
        };
      });
      this.ctx.raycontrol.addState(name, state);
      this.ctx.raycontrol.activateState(name);
      this.states.push({name, state});
    });
  }

  execute(delta, time) {
    if (this.ctx.editor && this.ctx.editor.active) return;
    this.components.forEach(component => {
      const visibility = this.ctx.performanceVisibility;
      if (component.visualOnly && visibility && !visibility.isVisible(component.object)) return;
      if (component.execute) component.execute(delta, time);
    });
  }

  create(object, config) {
    if (config.type === 'portal') {
      const scale = object.scale.clone();
      // Native stations animate only their original materials. Copies own fresh
      // uniforms, so advance their shader and hover effect with this component.
      const effects = portalEffects(object);
      let elapsed = 0, hovered = false;
      effects.forEach(effect => { if (effect.selected) effect.selected.value = 0; });
      const state = {
        onHover: () => { hovered = true; object.scale.copy(scale).multiplyScalar(config.hoverScale); },
        onHoverLeave: () => { hovered = false; object.scale.copy(scale); }
      };
      state[config.event === 'release' ? 'onSelectEnd' : 'onSelectStart'] = () => { this.ctx.goto = config.room; };
      return {
        state,
        execute: delta => {
          elapsed += delta;
          effects.forEach(effect => {
            if (effect.time) effect.time.value = effect.initialTime + elapsed;
            if (effect.selected) effect.selected.value += ((hovered ? 1 : 0) - effect.selected.value) * 0.1;
          });
        },
        dispose: () => {
          object.scale.copy(scale);
          effects.forEach(effect => {
            if (effect.time) effect.time.value = effect.initialTime;
            if (effect.selected) effect.selected.value = 0;
          });
        }
      };
    }
    if (config.type === 'float') {
      const anchor = object.position.clone();
      let elapsed = 0;
      return {
        execute: delta => { elapsed += delta; object.position.y = anchor.y + Math.sin(elapsed * config.speed) * config.amplitude; },
        dispose: () => object.position.copy(anchor)
      };
    }
    if (config.type === 'teleport') {
      return {state: {
        vrOnly: true,
        onHover: (hit, active) => this.ctx.teleport.onHover(hit.point, active),
        onHoverLeave: () => this.ctx.teleport.onHoverLeave(),
        onSelectStart: (hit, controller) => this.ctx.teleport.onSelectStart(controller),
        onSelectEnd: hit => this.ctx.teleport.onSelectEnd(hit.point)
      }};
    }
    if (config.type === 'sound') return this.sound(object, config);
    if (config.type === 'animation') return this.animation(object, config);
    const adapter = this.ctx.editorBehaviorAdapters && this.ctx.editorBehaviorAdapters[config.type];
    if (adapter) return adapter(this.ctx, object, config, this.library);
    this.notify('La función ' + config.type + ' no está disponible en esta escena.');
    return null;
  }

  sound(object, config) {
    if (!config.asset) return null;
    if (!this.ctx.audioListener) throw new Error('El motor de audio aún no está listo.');
    const url = this.library.getURL(config.asset);
    const generation = this.generation;
    const audio = new THREE.PositionalAudio(this.ctx.audioListener);
    let disposed = false, ready = false, pending = config.autoplay, elapsed = 0;
    object.add(audio);
    audio.setVolume(config.volume);
    audio.setRefDistance(3);
    const play = () => {
      if (disposed) return;
      if (!ready) { pending = true; return; }
      if (!visibleInTree(object)) return;
      if (audio.isPlaying) audio.stop();
      audio.play();
      elapsed = 0;
    };
    new THREE.AudioLoader().load(url, buffer => {
      if (disposed || generation !== this.generation) return;
      audio.setBuffer(buffer);
      ready = true;
      if (pending && visibleInTree(object)) { pending = false; play(); }
    }, undefined, () => {
      if (!disposed && generation === this.generation) this.notify('No se pudo reproducir ' + config.asset + '.');
    });
    return {
      state: {onSelectStart: play},
      execute: delta => {
        if (!visibleInTree(object)) {
          if (audio.isPlaying) audio.stop();
          elapsed = 0;
          if (config.autoplay) pending = true;
          return;
        }
        if (!config.autoplay || !ready) return;
        if (pending) { pending = false; play(); return; }
        elapsed += delta;
        if (elapsed >= config.interval) play();
      },
      dispose: () => {
        disposed = true;
        if (audio.isPlaying) audio.stop();
        if (audio.source && audio.disconnect) audio.disconnect();
        if (audio.panner && audio.panner.disconnect) audio.panner.disconnect();
        if (audio.gain && audio.gain.disconnect) audio.gain.disconnect();
        if (audio.parent) audio.parent.remove(audio);
      }
    };
  }

  animation(object, config) {
    const clips = [];
    const seen = new Set();
    const id = object.userData.editorId;
    const visual = id && object.children.find(child => child.userData.editorVisualOwnerId === id);
    // The replaced source graph remains present for native object identity.
    // Its hidden clips must never win over the model the visitor actually sees.
    const source = visual || object;
    source.traverse(child => (child.animations || []).forEach(clip => {
      if (!seen.has(clip)) { seen.add(clip); clips.push({clip, root: child}); }
    }));
    const selected = config.clip ? clips.find(item => item.clip.name === config.clip) : clips[0];
    if (!selected) {
      this.notify(config.clip ? 'No se encontró la animación ' + config.clip + '.' : 'Este recurso no contiene animaciones.');
      return null;
    }
    const mixer = new THREE.AnimationMixer(selected.root);
    const action = mixer.clipAction(selected.clip);
    action.setLoop(config.loop ? THREE.LoopRepeat : THREE.LoopOnce, config.loop ? Infinity : 1);
    action.clampWhenFinished = !config.loop;
    action.timeScale = config.speed;
    return {
      state: {onSelectStart: () => { action.reset(); action.play(); }},
      execute: delta => mixer.update(delta),
      // In this project's Three.js version stopAllAction() resets counters
      // before restoring bindings. Stop the action first to restore its pose.
      dispose: () => { action.stop(); mixer.uncacheRoot(selected.root); }
    };
  }
}
