import * as THREE from 'three';
import behaviorSchema from '../../../../modules/logistica-industrial/contracts/behaviors.js';

const {normalizeBehaviors, simulationTypes = []} = behaviorSchema;
let nextRuntimeId = 0;

function visibleInTree(object) {
  for (let current = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}

function activeCamera(ctx) {
  const xr = ctx.renderer && ctx.renderer.xr;
  return ctx.vrMode && xr && xr.getCamera ? xr.getCamera(ctx.camera) : ctx.camera;
}

function wrappedLines(context, value, width) {
  const lines = [];
  String(value || '').split(/\n/).forEach(paragraph => {
    let line = '';
    paragraph.split(/\s+/).filter(Boolean).forEach(word => {
      if (line && context.measureText(line + ' ' + word).width > width) { lines.push(line); line = word; }
      else line += (line ? ' ' : '') + word;
      while (context.measureText(line).width > width && line.length > 1) {
        let cut = line.length - 1; while (cut > 1 && context.measureText(line.slice(0, cut)).width > width) cut--;
        lines.push(line.slice(0, cut)); line = line.slice(cut);
      }
    });
    lines.push(line);
  }); return lines;
}

function drawContextCard(canvas, config) {
  const context = canvas.getContext('2d'); if (!context) throw new Error('No se pudo preparar la tarjeta de información.');
  // Keep wrapping and physical lettering in the same logical layout while
  // rasterizing glyphs at the backing store's actual reading resolution.
  if(context.setTransform)context.setTransform(canvas.width/480,0,0,canvas.height/300,0,0);
  if (context.clearRect) context.clearRect(0, 0, 480, 300);
  context.fillStyle = '#102631';
  if (context.beginPath && context.quadraticCurveTo && context.moveTo && context.lineTo && context.closePath && context.fill) {
    context.beginPath(); context.moveTo(16, 0); context.lineTo(464, 0); context.quadraticCurveTo(480, 0, 480, 16); context.lineTo(480, 284); context.quadraticCurveTo(480, 300, 464, 300); context.lineTo(16, 300); context.quadraticCurveTo(0, 300, 0, 284); context.lineTo(0, 16); context.quadraticCurveTo(0, 0, 16, 0); context.closePath(); context.fill();
  } else context.fillRect(0, 0, 480, 300);
  context.textAlign = 'left'; context.textBaseline = 'top'; context.fillStyle = '#7fe0d2'; context.font = 'bold 12px sans-serif'; context.fillText('INFORMACIÓN', 22, 17);
  context.fillStyle = config.color || '#ffffff'; context.font = 'bold 22px sans-serif';
  const title = wrappedLines(context, config.title, 436).slice(0, 2); title.forEach((line, index) => context.fillText(line, 22, 39 + index * 27));
  const top = 45 + Math.max(1, title.length) * 27;
  let font = Math.max(14, Math.min(19, (config.fontSize || .05) * 400)), lines;
  do { context.font = Math.round(font) + 'px sans-serif'; lines = wrappedLines(context, config.text, 436); if (lines.length * font * 1.35 <= 278 - top || font <= 14) break; font--; } while (font >= 14);
  const capacity = Math.max(1, Math.floor((278 - top) / (font * 1.35))); lines.slice(0, capacity).forEach((line, index) => {
    if (index === capacity - 1 && lines.length > capacity) { while (line && context.measureText(line + '…').width > 436) line = line.slice(0, -1); line += '…'; }
    context.fillText(line, 22, top + index * font * 1.35);
  });
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
    this.contextual = []; this.contextualRendering = new Set(); this.contextualActive = null;
    this.contextualStats = {scanned: 0, maxScannedPerFrame: 0, occlusionRays: 0, canvases: 0, activeId: null, textureBytes: 0, peakTextureBytes: 0, redraws: 0, resizes: 0};
    this.infoCameraPosition = new THREE.Vector3(); this.infoCameraForward = new THREE.Vector3(); this.infoOffset = new THREE.Vector3();
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
    this.contextual = []; this.contextualRendering.clear(); this.contextualActive = null; this.contextualStats.activeId = null;
  }

  start(roomId) {
    this.stop();
    this.roomId = roomId; this.roomIndex = this.ctx.room; this.infoCursor = 0; this.infoBest = null; this.infoBestScore = Infinity; this.infoTime = 0;
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
      const contextualInfo = behaviors.some(config => config.type === 'info' && config.enabled && config.presentation === 'contextual');
      behaviors.forEach(config => {
        // Persistent surfaces, including monitor mouse/VR interaction, retain
        // their own renderers and lifecycle across authoring and play.
        if (!config.enabled || config.type === 'collision' || config.type === 'decal' || config.type === 'lineMonitor' || config.type === 'surfaceMaterial' || config.type === 'surfaceWear' || config.type === 'machineAudio' || config.type === 'audioZone' ||
            nativeTypes.includes(config.type) || simulationTypes.includes(config.type)) return;
        if (config.type === 'billboard' && contextualInfo) return;
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
        vrOnly: group.every(part => part.vrOnly === true), teleport: group.every(part => part.teleport === true)
      };
      if(group.some(part=>part.handTouchable))state.handTouchable=true;
      if(group.some(part=>part.captureSelect))state.captureSelect=true;
      if (group.some(part => part.isSelectable)) state.isSelectable = (...args) => group.some(part => !part.isSelectable || part.isSelectable(...args));
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
    this.executeContextual(delta);
    this.components.forEach(component => {
      if (component.contextual) return;
      const visibility = this.ctx.performanceVisibility;
      if (component.visualOnly && visibility && !visibility.isVisible(component.object)) return;
      if (component.execute) component.execute(delta, time);
    });
  }

  create(object, config) {
    if(config.type==='hingeDoor')return this.hingeDoor(object,config);
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
        vrOnly: true, teleport: true,
        isSelectable: hit => this.ctx.teleport && !this.ctx.teleport.blocked() && this.ctx.teleport.walkableHit(hit),
        onHover: (hit, active) => this.ctx.teleport.onHover(hit.point, active),
        onHoverLeave: () => this.ctx.teleport.onHoverLeave(),
        onSelectStart: (hit, controller) => this.ctx.teleport.onSelectStart(controller),
        onSelectEnd: hit => this.ctx.teleport.onSelectEnd(hit.point)
      }};
    }
    if (config.type === 'sound') return this.sound(object, config);
    if (config.type === 'animation') return this.animation(object, config);
    if (config.type === 'info' && config.presentation === 'contextual') return this.contextualInfo(object, config);
    if (config.type === 'billboard') {
      const quaternion = object.quaternion.clone(), target = new THREE.Vector3(), location = new THREE.Vector3();
      return {execute: () => { const camera = activeCamera(this.ctx); if (!camera || !visibleInTree(object)) return; camera.getWorldPosition(target); if (config.axis === 'yaw') { object.getWorldPosition(location); target.y = location.y; } object.lookAt(target); }, dispose: () => object.quaternion.copy(quaternion)};
    }
    const adapter = this.ctx.editorBehaviorAdapters && this.ctx.editorBehaviorAdapters[config.type];
    if (adapter) return adapter(this.ctx, object, config, this.library);
    this.notify('La función ' + config.type + ' no está disponible en esta escena.');
    return null;
  }

  contextualInfo(object, config) {
    const runtime = this, hidden = new Map(), point = new THREE.Vector3();
    const descriptor = object.userData.editorDescriptor, behaviors = this.document.getBehaviors(object);
    // A standalone authored board may disappear between reads. An info
    // behavior on a machine never hides that machine's body or controls.
    if (descriptor && ['box', 'plane'].includes(descriptor.type) && !behaviors.some(value => simulationTypes.includes(value.type) || ['control', 'sensor', 'plc'].includes(value.type))) {
      object.traverse(child => { if (!child.material || child.userData.editorRuntimeHelper || child.userData.editorVisualOwnerId) return; (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => { if (!hidden.has(material)) { hidden.set(material, material.visible); material.visible = false; } }); });
    }
    const component = {contextual: true, object, config, point, opacity: 0, targetOpacity: 0, card: null, texture: null, signature: '', blockedUntil: 0, lastProbe: -Infinity,
      getConfig() { const values = object.userData.editorBehaviors || object.userData.editorDefaultBehaviors; const current = values && values.find(value => value.type === 'info'); return values ? current && current.enabled !== false && current.presentation === 'contextual' ? current : null : component.config; },
      releaseCard() { if (!component.card) return; if (component.card.parent) component.card.parent.remove(component.card); component.card.geometry.dispose(); component.card.material.dispose(); component.texture.dispose(); component.card = component.texture = null; component.signature = ''; runtime.contextualStats.canvases--;runtime.contextualStats.textureBytes-=component.textureBytes;component.textureBytes=0; },
      render(camera) {
        const current = component.getConfig(); if (!current) { if (component.card) { component.card.material.opacity = component.opacity; component.card.visible = component.opacity > .005 && visibleInTree(object); } return; }
        object.getWorldPosition(point);
        const resolution=runtime.contextCardWidth(camera,point,current.width||1);
        if (!component.card) {
          const canvas = document.createElement('canvas'); canvas.width = resolution; canvas.height = Math.round(resolution*.625);
          component.texture = new THREE.CanvasTexture(canvas); component.texture.encoding = THREE.sRGBEncoding;
          // r112/WebGL1 otherwise shrinks this non-power-of-two canvas to
          // generate mipmaps, losing text detail before it reaches the screen.
          component.texture.generateMipmaps=false;component.texture.minFilter=THREE.LinearFilter;component.texture.magFilter=THREE.LinearFilter;
          const capabilities=runtime.ctx.renderer&&runtime.ctx.renderer.capabilities;
          const limits=runtime.ctx.graphics&&runtime.ctx.graphics.getLimits?runtime.ctx.graphics.getLimits():{};
          component.texture.anisotropy=Math.min(4,limits.maxAnisotropy||4,capabilities&&capabilities.getMaxAnisotropy?capabilities.getMaxAnisotropy():1);
          component.card = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, .625), new THREE.MeshBasicMaterial({map: component.texture, transparent: true, opacity: 0, depthWrite: false, alphaTest: .01, side: THREE.FrontSide}));
          component.card.material.toneMapped = false; component.card.name = 'Tarjeta contextual · ' + (current.title || object.name); component.card.userData.editorRuntimeHelper = true; component.card.userData.editorInfoOwnerId = object.userData.editorId; component.card.renderOrder = 20;
          const host = runtime.ctx.scene || runtime.ctx.editor && runtime.ctx.editor.hooks && runtime.ctx.editor.hooks.renderScene || object.parent; if (!host) throw new Error('La tarjeta necesita una escena activa.'); host.add(component.card); runtime.contextualStats.canvases++;
          component.textureBytes=canvas.width*canvas.height*4;runtime.contextualStats.textureBytes+=component.textureBytes;
        }
        const canvas=component.texture.image;
        // Upgrade immediately when approaching. Keep that allocation until
        // fade-out, avoiding resize/redraw oscillation while the user moves.
        // Entering XR/mobile still enforces its smaller cap immediately.
        if(resolution>canvas.width||canvas.width>runtime.contextualTextureLimit){
          component.texture.dispose();runtime.contextualStats.textureBytes-=component.textureBytes;
          canvas.width=resolution;canvas.height=Math.round(resolution*.625);component.signature='';
          component.textureBytes=canvas.width*canvas.height*4;runtime.contextualStats.textureBytes+=component.textureBytes;runtime.contextualStats.resizes++;
        }
        runtime.contextualStats.peakTextureBytes=Math.max(runtime.contextualStats.peakTextureBytes,runtime.contextualStats.textureBytes);
        const signature = JSON.stringify([current.title, current.text, current.fontSize, current.color]);
        if (signature !== component.signature) { drawContextCard(canvas, current); component.texture.needsUpdate = true; component.signature = signature;runtime.contextualStats.redraws++; }
        component.card.position.copy(point); if (component.card.parent) component.card.parent.worldToLocal(component.card.position);
        component.card.scale.set(current.width || 1, current.width || 1, 1); const target = runtime.infoCameraPosition.clone(); target.y = point.y;
        if (Math.hypot(target.x - point.x, target.z - point.z) > .001) component.card.lookAt(target);
        component.card.material.opacity = component.opacity; component.card.visible = component.opacity > .005 && visibleInTree(object);
      },
      dispose() { component.releaseCard(); hidden.forEach((wasVisible, material) => { material.visible = wasVisible; }); runtime.contextualRendering.delete(component); }
    };
    this.contextual.push(component); return component;
  }

  contextCardWidth(camera,point,width) {
    const renderer=this.ctx.renderer,capabilities=renderer&&renderer.capabilities||{},hints=this.ctx.graphics&&this.ctx.graphics.hints||{};
    const xr=!!(this.ctx.vrMode||renderer&&renderer.xr&&renderer.xr.isPresenting);
    const constrained=xr||hints.mobile||hints.coarse||hints.standaloneXR;
    const hardware=Number.isFinite(capabilities.maxTextureSize)?capabilities.maxTextureSize:2048;
    const limit=Math.max(1,Math.pow(2,Math.floor(Math.log2(Math.max(1,Math.min(hardware,constrained?2048:4096))))));
    this.contextualTextureLimit=limit;
    const canvas=renderer&&renderer.domElement,eyes=camera.isArrayCamera&&camera.cameras.length?camera.cameras:[camera];
    let demand=0;
    for(const eye of eyes){
      // XR matrices already include tracking/rig transforms. Never update an
      // eye's local TRS here, or use the desktop mirror to size stereo text.
      const world=eye.matrixWorld&&eye.matrixWorld.elements,projection=eye.projectionMatrix&&eye.projectionMatrix.elements;if(!world||!projection)continue;
      const viewport=eye.viewport,pixelsX=viewport&&viewport.z||canvas&&canvas.width/eyes.length||1280,pixelsY=viewport&&viewport.w||canvas&&canvas.height||720;
      const axisLength=Math.hypot(world[8],world[9],world[10])||1;
      const depth=Math.max(.05,-((point.x-world[12])*world[8]+(point.y-world[13])*world[9]+(point.z-world[14])*world[10])/axisLength);
      demand=Math.max(demand,width*Math.max(Math.abs(projection[0])*pixelsX,Math.abs(projection[5])*pixelsY)/2/depth*1.25);
    }
    return Math.min(limit,Math.max(Math.min(1024,limit),Math.pow(2,Math.ceil(Math.log2(Math.max(1,demand))))));
  }

  hingeDoor(object,config) {
    const rest={position:object.position.clone(),quaternion:object.quaternion.clone()};
    const half=object.scale.x/2,hinge=rest.position.clone().add(new THREE.Vector3(-half,0,0).applyQuaternion(rest.quaternion));
    const rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),offset=new THREE.Vector3(),point=new THREE.Vector3(),helpers=[];
    let progress=config.open?1:0,target=progress;
    const invalidate=()=>{object.updateMatrixWorld(true);if(this.ctx.collisionWorld)this.ctx.collisionWorld.invalidate(object);};
    const pose=()=>{const eased=progress*progress*(3-2*progress);object.quaternion.copy(rest.quaternion).multiply(rotation.setFromAxisAngle(axis,config.openAngle*Math.PI/180*eased));object.position.copy(hinge).add(offset.set(half,0,0).applyQuaternion(object.quaternion));object.userData.hingeDoorOpen=progress>.99;invalidate();};
    const add=(geometry,material,position)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.fromArray(position);mesh.userData.editorRuntimeHelper=true;mesh.userData.editorNonCollidable=true;mesh.raycast=()=>{};object.add(mesh);helpers.push(mesh);return mesh;};
    let texture;
    if(typeof document!=='undefined'&&document.createElement){
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const drawing=canvas.getContext('2d');
      if(drawing){drawing.fillStyle='#163330';drawing.fillRect(0,0,512,128);drawing.fillStyle='#e6fff1';drawing.textAlign='center';drawing.font='bold 44px sans-serif';drawing.fillText(config.label,256,53,490);drawing.font='22px sans-serif';drawing.fillText('PULSA PARA ABRIR / CERRAR',256,100,490);texture=new THREE.CanvasTexture(canvas);texture.encoding=THREE.sRGBEncoding;}
    }
    for(const side of [-1,1]){
      const handle=add(new THREE.BoxBufferGeometry(.045,.10,.7),new THREE.MeshStandardMaterial({color:0xbac7c8,metalness:.65,roughness:.35}),[.38,-.05,side*.9]);handle.name='Manilla de '+config.label;
      add(new THREE.BoxBufferGeometry(.6,.23,.05),new THREE.MeshStandardMaterial({color:0x4b7985,metalness:.3,roughness:.25}),[0,.08,side*.52]);
      if(texture){
        const label=add(new THREE.PlaneBufferGeometry(.88,.14),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),[0,.34,side*.54]);if(side<0)label.rotation.y=Math.PI;
        // Fixed lintel lettering remains visible while the leaf is open.
        const header=new THREE.Mesh(new THREE.PlaneBufferGeometry(Math.abs(object.scale.x),.38),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));
        header.position.copy(rest.position).add(new THREE.Vector3(0,Math.abs(object.scale.y)/2+.23,side*.16).applyQuaternion(rest.quaternion));
        header.quaternion.copy(rest.quaternion);if(side<0)header.rotateY(Math.PI);
        header.name='Rótulo fijo de '+config.label;header.userData.editorRuntimeHelper=true;header.userData.editorNonCollidable=true;header.raycast=()=>{};
        if(object.parent)object.parent.add(header);helpers.push(header);
      }
    }
    pose();
    return {state:{handTouchable:true,captureSelect:true,
      isSelectable:()=>{const camera=activeCamera(this.ctx);return !!camera&&camera.getWorldPosition(point).distanceTo(object.getWorldPosition(offset))<=config.distance;},
      onSelectStart:()=>{
        const camera=activeCamera(this.ctx);if(!camera)return;
        if(target){camera.getWorldPosition(point);const center=object.parent?object.parent.localToWorld(rest.position.clone()):rest.position;
          if(Math.hypot(point.x-center.x,point.z-center.z)<.65){this.notify('Aléjate del umbral antes de cerrar la puerta.');return;}}
        target=target?0:1;this.notify(config.label+' · '+(target?'abriendo':'cerrando'));
      }},
      execute:delta=>{if(progress===target)return;const step=Math.max(0,Math.min(.1,Number.isFinite(delta)?delta:0))/config.duration;progress=target?Math.min(1,progress+step):Math.max(0,progress-step);pose();},
      dispose:()=>{helpers.forEach(mesh=>{if(mesh.parent)mesh.parent.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();});if(texture)texture.dispose();object.position.copy(rest.position);object.quaternion.copy(rest.quaternion);delete object.userData.hingeDoorOpen;invalidate();}
    };
  }

  executeContextual(delta) {
    if (!this.contextual.length) return; const camera = activeCamera(this.ctx); if (!camera) return;
    const step = Math.max(0, Math.min(.1, Number.isFinite(delta) ? delta : 0)); this.infoTime += step; camera.getWorldPosition(this.infoCameraPosition); camera.getWorldDirection(this.infoCameraForward);
    const roomActive = typeof this.ctx.room !== 'number' || typeof this.roomIndex !== 'number' || this.ctx.room === this.roomIndex;
    const assess = component => {
      const config = component.getConfig(); if (!roomActive || !config || !visibleInTree(component.object) || component.blockedUntil > this.infoTime) return null;
      component.object.getWorldPosition(component.point); this.infoOffset.copy(component.point).sub(this.infoCameraPosition); const distance = this.infoOffset.length(), limit = config.revealDistance || 5;
      if (distance > limit + .35 || distance < .01) return null; const alignment = this.infoOffset.divideScalar(distance).dot(this.infoCameraForward), threshold = Math.cos((config.gazeAngle || 110) * Math.PI / 360);
      if (alignment < threshold - (component === this.contextualActive ? .12 : 0)) return null;
      return {score: distance * (1 + (1 - alignment) * .4), opacity: THREE.Math.clamp((limit - distance) / (config.fadeDistance || .75), 0, 1)};
    };
    let checked = 0, completed = false;
    while (checked < 8 && checked < this.contextual.length) {
      const component = this.contextual[this.infoCursor++], candidate = assess(component); checked++;
      if (candidate && candidate.opacity > 0 && candidate.score < this.infoBestScore) { this.infoBest = component; this.infoBestScore = candidate.score; }
      if (this.infoCursor >= this.contextual.length) { this.infoCursor = 0; completed = true; break; }
    }
    this.contextualStats.scanned += checked; this.contextualStats.maxScannedPerFrame = Math.max(this.contextualStats.maxScannedPerFrame, checked);
    const activeAssessment = this.contextualActive && assess(this.contextualActive); let selected = activeAssessment ? this.contextualActive : null;
    if (completed) { const best = this.infoBest && assess(this.infoBest); if (best && (!activeAssessment || best.score < activeAssessment.score * .82)) selected = this.infoBest; this.infoBest = null; this.infoBestScore = Infinity; }
    const world = this.ctx.collisionWorld;
    if (selected && world && world.rayBlocked && this.infoTime - selected.lastProbe >= .15) {
      selected.lastProbe = this.infoTime; this.contextualStats.occlusionRays++;
      if (world.rayBlocked(this.infoCameraPosition, selected.point, {ignore: [selected.object]})) { selected.blockedUntil = this.infoTime + .4; selected = null; }
    }
    if (selected !== this.contextualActive) {
      this.contextualRendering.forEach(component => { if (component !== this.contextualActive && component !== selected) { component.releaseCard(); this.contextualRendering.delete(component); } });
      this.contextualActive = selected; if (selected) this.contextualRendering.add(selected);
    }
    this.contextualStats.activeId = selected && selected.object.userData.editorId || null;
    this.contextualRendering.forEach(component => {
      if (!roomActive) { component.opacity = 0; component.releaseCard(); this.contextualRendering.delete(component); return; }
      const current = component.getConfig(), candidate = component === selected && assess(component), target = candidate ? candidate.opacity : 0;
      component.targetOpacity = target; component.opacity += (target - component.opacity) * (1 - Math.exp(-step / Math.max(.05, current && current.fadeTime || .22)));
      if (component.opacity < .005 && !target) { component.releaseCard(); this.contextualRendering.delete(component); return; }
      component.render(camera);
    });
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
