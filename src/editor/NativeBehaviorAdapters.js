import * as THREE from 'three';
import {Area, BoundingBox} from '../components/index.js';

// Configuration is JSON; live audio, canvas and controller state stay outside it.
export function nativeBehavior(object, type) {
  const list = object.userData.editorBehaviors || object.userData.editorDefaultBehaviors || [];
  const value = list.find(item => item.type === type);
  return value && value.enabled !== false ? value : null;
}

export function declareNativeBehaviors(object, behaviors) {
  if (!object) return;
  object.userData.editorDefaultBehaviors = behaviors.map(value => Object.assign({enabled: true}, value));
  object.userData.editorNativeBehaviorTypes = behaviors.map(value => value.type);
}

function textureOf(object) {
  let map;
  object.traverse(child => {
    if (map || !child.userData.editorVisualOwnerId) return;
    child.traverse(mesh => { if (!map && mesh.material) map = mesh.material.map; });
  });
  if (!map && !object.userData.editorGeometryReplaced) map = object.material && object.material.map;
  if (!map) object.traverse(child => { if (!map && !child.userData.editorGeometryReplaced && child.material) map = child.material.map; });
  return map;
}

export function canvasCard(object, config, camera) {
  // Visibility on Object3D is authored state in SceneDocument. Hide generated
  // SDF materials instead so a text preview cannot become a saved override.
  const hidden = new Map();
  object.traverse(child => {
    if (child.name !== 'textMesh' || !child.material) return;
    (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => {
      if (!hidden.has(material)) hidden.set(material, material.visible);
      material.visible = false;
    });
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 768;
  const context = canvas.getContext('2d');
  context.fillStyle = '#080b10'; context.fillRect(0, 0, 1024, 768);
  context.fillStyle = config.color || '#ffffff';
  const fontSize = Math.max(24, Math.min(110, (config.fontSize || 0.05) * 750));
  context.font = 'bold ' + Math.round(fontSize * 1.25) + 'px sans-serif';
  context.fillText(String(config.title || '').slice(0, 100), 45, 80);
  context.font = Math.round(fontSize) + 'px sans-serif';
  let line = '', y = 145;
  String(config.text || '').split(/\n/).forEach(paragraph => {
    paragraph.split(/\s+/).forEach(word => {
      const next = line + word + ' ';
      if (context.measureText(next).width > 930) { context.fillText(line, 45, y); line = word + ' '; y += fontSize * 1.4; }
      else line = next;
    });
    context.fillText(line, 45, y); line = ''; y += fontSize * 1.4;
  });
  const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
  const card = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 0.75), new THREE.MeshBasicMaterial({map: texture, transparent: true, side: THREE.DoubleSide}));
  card.name = 'Información'; card.userData.editorRuntimeHelper = true;
  object.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().getInverse(object.matrixWorld), bounds = new THREE.Box3();
  object.traverse(mesh => {
    if (!mesh.geometry || mesh.name === 'textMesh' || mesh.userData.editorRuntimeHelper || mesh.userData.editorGeometryReplaced) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  if (!bounds.isEmpty()) {
    const size = bounds.getSize(new THREE.Vector3());
    const scale = Math.max(0.05, Math.min(size.x || 1, size.y ? size.y / 0.75 : 1));
    card.scale.set(scale, scale, 1); card.position.copy(bounds.getCenter(new THREE.Vector3())); card.position.z = bounds.max.z + 0.015;
  } else card.position.z = 0.015;
  object.add(card);
  let disposed = false;
  return {
    card,
    execute() { if (camera) { const position = new THREE.Vector3(); camera.getWorldPosition(position); card.lookAt(position); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.remove(card);
      hidden.forEach((visible, material) => { material.visible = visible; });
      texture.dispose(); card.material.dispose(); card.geometry.dispose();
    }
  };
}

export function installNativeBehaviorAdapters(ctx) {
  ctx.editorBehaviorAdapters = Object.assign(ctx.editorBehaviorAdapters || {}, {
    painting(context, object, config) {
      const state = context.raycontrol.states.paintings;
      if (!state) return {};
      const delegate = {};
      ['onHover', 'onHoverLeave', 'onSelectStart', 'onSelectEnd'].forEach(event => {
        if (state[event]) delegate[event] = (hit, ...args) => {
          // An imported replacement can be a group; the UV still comes from the ray hit.
          const previous = object.userData.editorPaintingTexture;
          object.userData.editorPaintingTexture = textureOf(object);
          try { return state[event](Object.assign({}, hit, {object}), ...args); }
          finally { object.userData.editorPaintingTexture = previous; }
        };
      });
      return {state: delegate, dispose() { if (state.onHoverLeave) state.onHoverLeave({object}); }};
    },
    graffiti(context, object, config) {
      const entity = context.world && context.world.createEntity();
      let bounds;
      if (entity) {
        entity.editorSurface = object; entity.editorScene = context.scene;
        entity.editorBehaviorType = 'graffiti';
        entity.addComponent(BoundingBox).addComponent(Area); bounds = entity.getMutableComponent(BoundingBox);
      }
      const areaBox = new THREE.Box3();
      const syncArea = () => {
        if (!bounds) return;
        let visible = true, attached = false;
        for (let current = object; current; current = current.parent) {
          if (!current.visible) visible = false;
          if (current === context.scene) attached = true;
        }
        if (visible && attached) { object.updateWorldMatrix(true, true); areaBox.setFromObject(object).expandByScalar(config.distance); }
        else areaBox.makeEmpty();
        bounds.min.copy(areaBox.min); bounds.max.copy(areaBox.max);
      };
      syncArea();
      context.editorGraffitiAdapterUsers = (context.editorGraffitiAdapterUsers || 0) + 1;
      const systems = context.systemsGroup && context.systemsGroup.roomHall;
      if (context.room !== 0 && systems) systems.play();
      const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
      const draw = canvas.getContext('2d'); draw.fillStyle = '#ffffff'; draw.fillRect(0, 0, canvas.width, canvas.height);
      const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
      const materials = [];
      object.traverse(mesh => {
        if (!mesh.isMesh || !mesh.material || mesh.userData.editorGeometryReplaced) return;
        materials.push([mesh, mesh.material]);
        mesh.material = new THREE.MeshBasicMaterial({map: texture, side: THREE.DoubleSide});
      });
      let previous = null, lastController = null;
      const stopSpray = () => {
        const sound = lastController && lastController.getObjectByName && lastController.getObjectByName('spraySound');
        if (sound && sound.isPlaying) sound.stop();
        lastController = null; previous = null;
      };
      const paint = hit => {
        if (!hit.uv || hit.distance > config.distance) return;
        const point = new THREE.Vector2(hit.uv.x * canvas.width, (1 - hit.uv.y) * canvas.height);
        const color = context.editorSprayColor || {r: 0, g: 0, b: 0};
        draw.strokeStyle = 'rgb(' + [color.r, color.g, color.b].join(',') + ')';
        draw.lineWidth = Math.max(1, config.brushSize * canvas.width * Math.max(0.01, hit.distance) * 0.15);
        draw.lineCap = draw.lineJoin = 'round'; draw.globalAlpha = config.opacity;
        draw.beginPath(); draw.moveTo(previous ? previous.x : point.x, previous ? previous.y : point.y);
        draw.lineTo(point.x + 0.01, point.y); draw.stroke(); previous = point; texture.needsUpdate = true;
      };
      return {
        state: {
          lineStyleOnIntersection: 'basic',
          onSelectStart(hit, controller) {
            if (hit.distance > config.distance) return;
            previous = null; lastController = controller;
            const sound = controller && controller.getObjectByName && controller.getObjectByName('spraySound');
            if (sound && sound.buffer && !sound.isPlaying) sound.play();
            paint(hit);
          },
          onHover(hit, active) { if (active) paint(hit); }, onSelectEnd: stopSpray, onHoverLeave: stopSpray
        },
        execute: syncArea,
        dispose() {
          stopSpray();
          if (entity) entity.remove();
          context.editorGraffitiAdapterUsers = Math.max(0, context.editorGraffitiAdapterUsers - 1);
          if (!context.editorGraffitiAdapterUsers && context.room !== 0 && systems) systems.stop();
          materials.forEach(([mesh, material]) => { mesh.material.dispose(); mesh.material = material; }); texture.dispose();
        }
      };
    },
    note(context, object, config, library) {
      const registry = context.editorXylophone;
      if (!registry) return {};
      registry.addNote(object, config, library);
      return {execute(delta, time) { if (context.room !== 0) registry.tick(context, delta, time); }, dispose() { registry.removeNote(object); }};
    },
    grab(context, object, config) {
      const registry = context.editorXylophone;
      if (!registry) return {};
      registry.addStick(object, config);
      const releaseControls = registry.acquireControls();
      return {execute(delta, time) { if (context.room !== 0) registry.tick(context, delta, time); }, dispose() { registry.removeStick(object); releaseControls(); }};
    },
    info(context, object, config) { return canvasCard(object, config); },
    billboard(context, object) {
      const position = new THREE.Vector3();
      const quaternion = object.quaternion.clone();
      return {execute() { context.camera.getWorldPosition(position); object.lookAt(position); }, dispose() { object.quaternion.copy(quaternion); }};
    },
    news(context, object, config, library) {
      let disposed = false, elapsed = config.interval, index = 0, rows = [], card = null;
      const url = library ? library.getURL(config.url) : 'assets/' + config.url;
      fetch(url).then(response => { if (!response.ok) throw new Error('News'); return response.json(); }).then(data => { if (!disposed && Array.isArray(data)) rows = data; }).catch(() => {});
      return {
        execute(delta) {
          elapsed += delta; if (elapsed < config.interval || !rows.length) return; elapsed = 0;
          const row = rows[index++ % rows.length]; if (card) card.dispose();
          card = canvasCard(object, {title: config.hashtag + ' · ' + (row.author || ''), text: row.message || '', color: '#ffffff', fontSize: 0.05});
        },
        dispose() { disposed = true; if (card) card.dispose(); }
      };
    }
  });
}
