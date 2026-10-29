import * as THREE from 'three';
import {nativeBehavior, declareNativeBehaviors} from '../../../../../packages/tools/editor/src/NativeBehaviorAdapters.js';
import ColorWheel from '../lib/ColorWheel';
import {Area, AreaReactor, AreaChecker, Object3D, BoundingBox, ParentObject3D, DebugHelper} from '../../../../../packages/render-three/ecs/components/index';
import {angleBetween, getRandomInt} from '../../../../../packages/render-three/src/utils.js';

var colorWheel;

export function enter(ctx) {
  //ctx.raycontrol.activateState('graffiti');
  if (colorWheel) {
    colorWheel.enter();
  }
}

var material, wall, drawContext;
var lastPosition = new THREE.Vector2();
var brushImg, canvasTmp, ctxTmp;

var lastController;
var paintImg = new Image();

function colorize(r, g, b) {
  ctxTmp.clearRect(0, 0, canvasTmp.width, canvasTmp.height);
  ctxTmp.drawImage(brushImg, 0, 0);
  let imgData = ctxTmp.getImageData(0, 0, canvasTmp.width, canvasTmp.height);
  for (var t = 0; t < imgData.data.length; t += 4) {
     imgData.data[t]= r * imgData.data[t] / 255;
     imgData.data[t + 1]= g * imgData.data[t + 1] / 255;
     imgData.data[t + 2]= b * imgData.data[t + 2] / 255;
  }
  ctxTmp.putImageData(imgData,0,0);
  paintImg.src = canvasTmp.toDataURL();
}

export function setup(ctx, hall) {

  let area = ctx.world.createEntity();
  area.name = 'area';
  area
    .addComponent(BoundingBox)
    //.addComponent(DebugHelper)
    .addComponent(ParentObject3D, {value: hall})
    .addComponent(Area);

    let component = area.getMutableComponent(BoundingBox);
  component.min.set(-5, 0, 4.4);
  component.max.set(3, 3, 7);

  const bindings = new Map();
  const sprayTemplate = ctx.assets['spray_model'].scene;
  const activeInput = data => !(ctx.vrMode && ctx.studioMenuOpen) && data.enabled !== false && Boolean(data.desktop) !== Boolean(ctx.vrMode);
  const refreshState = () => {
    const painting = Array.from(bindings.values()).some(binding => binding.spray && binding.inside && activeInput(binding.data));
    if (painting && ctx.room === 0) ctx.raycontrol.activateState('graffiti');
    else ctx.raycontrol.deactivateState('graffiti');
  };

  function attachSprayCan(controllerData, binding) {
    let controller = controllerData.controller;
    const handedness = controllerData.inputSource.handedness;
    const sound = new THREE.PositionalAudio(ctx.audioListener);
    sound.setLoop(true);
    sound.name = 'spraySound';
    binding.sound = sound;
    controller.add(sound);
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load("modules/turismo/assets/ogg/spray.ogg", buffer => {
      // Decoding can finish after disconnect, hand preference changes or reuse
      // of the same target-ray Group for another XR input source.
      if (binding.detached || bindings.get(controller) !== binding) return;
      sound.setBuffer(buffer);
    });

    const spray = sprayTemplate.clone(true);
    spray.getObjectByName('spraycan').rotation.y += handedness === 'right' ? Math.PI / 2 : -Math.PI / 2;
    spray.name = 'spray';
    spray.visible = false;
    const sprayTex = ctx.assets['spray_tex'];
    spray.getObjectByName('spraycan').material = new THREE.MeshPhongMaterial({map: sprayTex});
    spray.getObjectByName('spraycolor').material = new THREE.MeshLambertMaterial({color: 0xFF0000});
    const color = ctx.editorSprayColor;
    if (color) spray.getObjectByName('spraycolor').material.color.setRGB(color.r / 255, color.g / 255, color.b / 255);
    controller.add(spray);
    binding.spray = spray; binding.sound = sound;
  }

  function attachColorWheel(controllerData) {
    let controller = controllerData.controller;
    colorWheel = new ColorWheel(ctx, controller, (rgb) => {
      ctx.editorSprayColor = rgb;
      colorize(
        rgb.r,
        rgb.g,
        rgb.b);
      bindings.forEach(binding => { if (binding.spray) binding.spray.getObjectByName('spraycolor').material.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255); });
    });

    colorWheel.enter();
  }

  function detachController(controllerData) {
    const binding = bindings.get(controllerData.controller); if (!binding || binding.data !== controllerData) return;
    bindings.delete(controllerData.controller);
    binding.reactor.onExiting(binding.checker);
    binding.detached = true;
    binding.checker.remove();
    if (lastController === controllerData.controller) lastController = null;
    if (binding.sound) {
      const sound = binding.sound;
      // r112 creates source only in play(); disconnect() assumes it exists.
      // Panner/gain are connected in the constructor and also need releasing
      // when loading never completed or the sound was never played.
      if (sound.source) {
        if (sound.isPlaying) sound.stop();
        sound.disconnect();
        sound.source.onended = null;
      }
      if (sound.panner) sound.panner.disconnect();
      if (sound.gain) sound.gain.disconnect();
      sound.source = null; sound.buffer = null;
      controllerData.controller.remove(sound);
    }
    if (binding.spray) {
      controllerData.controller.remove(binding.spray);
      ['spraycan', 'spraycolor'].forEach(name => binding.spray.getObjectByName(name).material.dispose());
    }
    if (binding.wheel) { binding.wheel.dispose(); if (colorWheel === binding.wheel) colorWheel = null; }
    refreshState();
  }

  function attachController(controllerData) {
    const previous = bindings.get(controllerData.controller);
    if (previous) detachController(previous.data);
    const binding = {data: controllerData, inside: false};
    bindings.set(controllerData.controller, binding);
    const checker = ctx.world.createEntity(); binding.checker = checker;
    checker.editorIsActive = () => activeInput(controllerData);
    if (controllerData.desktop || ctx.raycontrol.matchController(controllerData, "primary")) {
      attachSprayCan(controllerData, binding);
      checker
      .addComponent(AreaChecker)
      .addComponent(Object3D, {value: controllerData.controller})
      .addComponent(AreaReactor, {
        onEntering: entity => {
          if (binding.detached) return;
          binding.inside = true;
          const obj3D = controllerData.controller;
          const model = obj3D.getObjectByName('Scene');
          if (model) model.visible = false;
          obj3D.getObjectByName('spray').visible = true;
          let raycasterContext = controllerData.raycasterContext;
          if (!controllerData.desktop && raycasterContext) {
            raycasterContext.rotation.set(-Math.PI / 2, (controllerData.inputSource.handedness === "right" ? 1 : -1) * Math.PI / 2, 0);
            raycasterContext.position.set(0,-0.015,-0.025);
          }
          ctx.raycontrol.setLineStyle('basic', controllerData);
          refreshState();
        },
        onExiting: entity => {
          if (binding.detached) return;
          binding.inside = false;
          const obj3D = controllerData.controller;
          const sound = obj3D.getObjectByName('spraySound');
          if (sound && sound.isPlaying) sound.stop();
          const model = obj3D.getObjectByName('Scene');
          if (model) model.visible = true;
          obj3D.getObjectByName('spray').visible = false;
          let raycasterContext = controllerData.raycasterContext;
          if (!controllerData.desktop && raycasterContext) {
            raycasterContext.rotation.set(0,0,0);
            raycasterContext.position.set(0,0,0);
          }
          ctx.raycontrol.setLineStyle('advanced', controllerData);
          refreshState();
        }
      });
    } else {
      attachColorWheel(controllerData);
      binding.wheel = colorWheel;
      checker
      .addComponent(AreaChecker)
      .addComponent(Object3D, {value: controllerData.controller})
      .addComponent(AreaReactor, {
        onEntering: entity => {
          if (binding.detached) return;
          binding.inside = true;
          const obj3D = controllerData.controller;
          const model = obj3D.getObjectByName('Scene'); if (model) model.visible = false;
          obj3D.getObjectByName('ColorWheel').visible = true;
        },
        onExiting: entity => {
          if (binding.detached) return;
          binding.inside = false;
          const obj3D = controllerData.controller;
          const model = obj3D.getObjectByName('Scene'); if (model) model.visible = true;
          obj3D.getObjectByName('ColorWheel').visible = false;
        }
      });
    }
    binding.reactor = checker.getComponent(AreaReactor);
  }
  ctx.raycontrol.addEventListener('controllerConnected', attachController);
  ctx.raycontrol.addEventListener('controllerDisconnected', detachController);
  ctx.raycontrol.addEventListener('handednessChanged', () => {
    const connected = Array.from(bindings.values()).map(binding => binding.data);
    connected.forEach(detachController); connected.forEach(attachController);
  });

  let width = 2048;
  let height = 1024;
  let maxDistance = 1;

  brushImg = new Image();
  canvasTmp = document.createElement('canvas');
  //canvasTmp.style.position = "absolute";
  //canvasTmp.style.width = "20%";
  //canvasTmp.style.backgroundColor = "#333";
  ctxTmp = canvasTmp.getContext('2d');
  // document.body.appendChild(canvasTmp);

  brushImg.onload = () => {
    canvasTmp.width = brushImg.width;
    canvasTmp.height = brushImg.height;
    colorize(0,0,0);
  }
  brushImg.src = "modules/turismo/assets/spray_brush.png";

  var drawingCanvas = document.createElement('canvas');

  drawingCanvas.width = width;
  drawingCanvas.height = height;
  drawContext = drawingCanvas.getContext('2d');
  drawContext.clearRect(0, 0, width, height);
  drawContext.fillStyle = '#fff';
  drawContext.fillRect(0, 0, width, height);

  let map = new THREE.CanvasTexture( drawingCanvas );

  material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    lightMap: ctx.assets['lightmap_tex'],
    map: map
  });

  wall = hall.getObjectByName('graffiti');
  area.editorSurface = wall;
  area.editorScene = ctx.scene;
  area.editorBehaviorType = 'graffiti';
  declareNativeBehaviors(wall, [{type: 'graffiti', distance: 1, brushSize: 0.2, opacity: 1}]);
  wall.material = material;
  wall.updateWorldMatrix(true, false);
  ctx.editorGraffitiArea = {
    entity: area,
    componentType: BoundingBox,
    wall,
    originalWorldMatrix: wall.matrixWorld.clone(),
    originalBox: new THREE.Box3(component.min.clone(), component.max.clone())
  };

  var aux2 = new THREE.Vector2();

  ctx.raycontrol.addState('graffiti', {
    colliderMesh: wall,
    lineStyleOnIntersection: 'basic',
    onHover: (intersection, active, controller) => {
      const config = nativeBehavior(wall, 'graffiti');
      if (!config || !intersection.uv) return;
      if (intersection.actualObject && intersection.actualObject.material) {
        intersection.actualObject.material.map = material.map;
        intersection.actualObject.material.needsUpdate = true;
      }
      if (active)
      {
        var distance = intersection.distance;

        if (distance > config.distance) { return; }

        let x = intersection.uv.x * width;
        let y = height - intersection.uv.y * height;

        aux2.set(x, y);
        drawContext.imageSmoothingEnabled = true;
        drawContext.fillStyle = '#f00';
        drawContext.strokeStyle = '#0f0';
        var dist = lastPosition.distanceTo(aux2);
        var angle = angleBetween(lastPosition, aux2);
        let alpha = THREE.Math.clamp(1 - distance / config.distance, 0, 1) * config.opacity;

        drawContext.globalAlpha = alpha;

        for (var i = 0; i < dist; i ++ /* +=4 */) {
            var _x = lastPosition.x + (Math.sin(angle) * i);
            var _y = lastPosition.y + (Math.cos(angle) * i);
            drawContext.save();
            drawContext.translate(_x, _y);
            let r = THREE.Math.lerp(0.001, config.brushSize, distance / config.distance);
            drawContext.scale(r, r);

            drawContext.rotate(Math.PI * 180 / getRandomInt(0, 180));

            drawContext.drawImage(paintImg, -brushImg.width / 2, -brushImg.height / 2);
            drawContext.restore();
        }

        lastPosition.set(x, y);

        material.map.needsUpdate = true;
      }
    },
    onHoverLeave: (intersection) => {},
    onSelectStart: (intersection, controller) => {
      const config = nativeBehavior(wall, 'graffiti');
      if (!config || !intersection.uv) return;
      var distance = intersection.distance;

      if (distance > config.distance) { return; }

      lastController = controller;
      const sound = controller.getObjectByName('spraySound');
      if (sound && sound.buffer) sound.play();

      let x = intersection.uv.x * width;
      let y = height - intersection.uv.y * height;

      lastPosition.set(x, y);
    },
    onSelectEnd: (intersection) => {
      if (!lastController) { return; }
      const sound = lastController.getObjectByName('spraySound');
      if (sound && sound.isPlaying) sound.stop();
    }
  });
}

export function execute(ctx, delta, time) {
  const binding = ctx.editorGraffitiArea;
  if (!binding) return;
  const config = nativeBehavior(wall, 'graffiti');
  const component = binding.entity.getMutableComponent(BoundingBox);
  if (!config) { component.min.set(Infinity, Infinity, Infinity); component.max.set(-Infinity, -Infinity, -Infinity); return; }
  wall.updateWorldMatrix(true, false);
  const deltaMatrix = wall.matrixWorld.clone().multiply(new THREE.Matrix4().getInverse(binding.originalWorldMatrix));
  const box = binding.originalBox.clone().applyMatrix4(deltaMatrix).expandByScalar(Math.max(0, config.distance - 1));
  component.min.copy(box.min); component.max.copy(box.max);
}
