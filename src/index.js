import * as THREE from 'three';
import SmoothPointerLockControls from './lib/SmoothPointerLockControls.js';
import AdaptiveGraphics from './lib/AdaptiveGraphics.js';
import PreparedMaterialTextures from './lib/PreparedMaterialTextures.js';
import MobileNavigation from './lib/MobileNavigation.js';
import NativeTextureAI from './lib/NativeTextureAI.js';
import NativeMaterialAI from './lib/NativeMaterialAI.js';
import XRMirror from './lib/XRMirror.js';
import XRLocomotion from './lib/XRLocomotion.js';
import {createXRGrip, updateXRGrip} from './lib/XRGripTracking.js';

import {VRButton} from './lib/VRButton.js';
import {loadAssets} from './lib/assetManager.js';
import RoomAssets from './lib/RoomAssets.js';
import RoomNavigation from './lib/RoomNavigation.js';
import RoomTransition from './lib/RoomTransition.js';

// ECSY
import { World } from 'ecsy';
import { SDFTextSystem } from './systems/SDFTextSystem.js';
import { DebugHelperSystem } from './systems/DebugHelperSystem.js';
import { AreaCheckerSystem } from './systems/AreaCheckerSystem.js';
import { ControllersSystem } from './systems/ControllersSystem.js';
import HierarchySystem from './systems/HierarchySystem.js';
import TransformSystem from './systems/TransformSystem.js';
import BillboardSystem from './systems/BillboardSystem.js';

import SystemsGroup from './systems/SystemsGroup.js';

import assets from './assets.js';

import { Text, Object3D, AreaChecker } from './components/index.js';

import RayControl from './lib/RayControl.js';
import Teleport from './lib/Teleport.js';
import SceneEditor from './editor/SceneEditor.js';
import StudioExperience from './studio/StudioExperience.js';
import ProjectWorkspaceTabs from './editor/ProjectWorkspaceTabs.js';
import SceneCreationDialog from './editor/SceneCreationDialog.js';
import SceneGuideChat from './editor/SceneGuideChat.js';
import MonitorWidgetTools from './editor/MonitorWidgetTools.js';
import SceneEntities from './studio/SceneEntities.js';
import ConveyorViewer from './editor/ConveyorViewer.js';
import studioSchema from '../shared/studio-document.js';

import * as roomHall from './rooms/Hall.js';
import * as roomPanorama from './rooms/Panorama.js';
import * as roomPanoramaStereo from './rooms/PanoramaStereo.js';
import * as roomPhotogrammetryObject from './rooms/PhotogrammetryObject.js';
import * as roomVertigo from './rooms/Vertigo.js';
import * as roomSound from './rooms/Sound.js';

import {shaders} from './lib/shaders.js';

import WebXRPolyfill from 'webxr-polyfill';
const polyfill = new WebXRPolyfill();

var clock = new THREE.Clock();

var scene, parent, renderer, camera, controls, context = {};
var raycontrol, teleport, controllers = [];
var desktopController, desktopControllerData;
let desktopVehicleAtMouseDown = null;
var keyboardState = {};
let roomNavigation;
let suspendedRoom;
const keyboardMoveSpeed = 3;
let lastVRCollisionPosition = null;
let lastRenderWorkMs;

function resetCollisionPose() {
  lastVRCollisionPosition = null;
}

function keepRoomOnVREntry(editor, roomId) {
  if (!editor) return false;
  const document = editor.document || {};
  return Boolean(editor.currentProject || studioSchema.hasSceneContent(document, roomId) ||
    (document.studio && document.studio.scenes || []).some(scene => scene.id === roomId));
}

function canStartVR() {
  const editor = context.editor;
  if (context.roomTransition || editor && (editor.loadingProject || editor.busy || editor.importingFiles ||
    editor.pastingObject || editor.creatingScene || editor.pendingEdits || editor.document &&
    (editor.document.loading || editor.document.transaction) || editor.transform && editor.transform.dragging)) {
    if (editor && editor.toast) editor.toast('Espera a que termine la operación actual antes de entrar en VR.');
    return 'Espera a que termine la operación actual antes de entrar en VR.';
  }
  context.xrEntryPending = true;
  if (context.nativeTextureAI) context.nativeTextureAI.suspend('vr-entry');
  return true;
}

function setVRFloorOffset(inVR, referenceSpaceType, reset = false) {
  const previous = reset ? 0 : context.xrLocalFloorOffset || 0;
  const next = inVR && referenceSpaceType === 'local' ? 1.6 : 0;
  context.cameraRig.position.y += next - previous;
  context.xrLocalFloorOffset = next;
}

var listener, ambientMusic;

var rooms = [
  roomHall,
  roomSound,
  roomPhotogrammetryObject,
  roomVertigo,
  roomPanoramaStereo,
  roomPanorama,
  roomPanorama,
  roomPanorama,
  roomPanorama,
  roomPanorama,
];

const roomNames = [
  'hall',
  'sound',
  'photogrammetry',
  'vertigo',
  'panoramastereo',
  'panorama1',
  'panorama2',
  'panorama3',
  'panorama4',
  'panorama5',
];

const musicThemes = [
  false,
  false,
  'chopin_snd',
  'wind_snd',
  false,
  'birds_snd',
  'birds_snd',
  'forest_snd',
  'wind_snd',
  'birds_snd',
];

const urlObject = new URL(window.location);
const roomName = urlObject.searchParams.get('room');
context.room = roomNames.indexOf(roomName) !== -1 ? roomNames.indexOf(roomName) : 0;
// console.log(`Current room "${roomNames[context.room]}", ${context.room}`);
const debug = urlObject.searchParams.has('debug');
const handedness = urlObject.searchParams.has('handedness') ? urlObject.searchParams.get('handedness') : "right";

// Target positions when moving from one room to another
const targetPositions = {
  hall: {
    sound: new THREE.Vector3(0, 0, 0),
    photogrammetry: new THREE.Vector3(1, 0, 0),
    vertigo: new THREE.Vector3(0, 0, 0)
  },
  photogrammetry: {
    hall: new THREE.Vector3(-3.6, 0, 2.8)
  },
  sound: {
    hall: new THREE.Vector3(4.4, 0, 4.8)
  },
  vertigo: {
    hall: new THREE.Vector3(-1.8, 0, -5)
  }
};

const desktopPortalSpawns = {
  hall: {
    sound: {x: 0.4, z: 3, yaw: Math.PI},
    photogrammetry: {x: 1.5, z: 0, yaw: Math.PI / 2},
    vertigo: {x: 0, z: 0, yaw: 0},
    panoramastereo: {x: 0, z: 0, yaw: 0},
    panorama1: {x: 0, z: 0, yaw: 0},
    panorama2: {x: 0, z: 0, yaw: 0},
    panorama3: {x: 0, z: 0, yaw: 0},
    panorama4: {x: 0, z: 0, yaw: 0},
    panorama5: {x: 0, z: 0, yaw: 0}
  },
  sound: {
    hall: {x: 4.4, z: 4.8, yaw: 0}
  },
  photogrammetry: {
    hall: {x: -3.6, z: 2.8, yaw: -Math.PI / 2}
  },
  vertigo: {
    hall: {x: -1.8, z: -5, yaw: Math.PI}
  },
  panoramastereo: {
    hall: {x: 0, z: 2, yaw: 0}
  },
  panorama1: {
    hall: {x: 0, z: 2, yaw: 0}
  },
  panorama2: {
    hall: {x: 0, z: 2, yaw: 0}
  },
  panorama3: {
    hall: {x: 0, z: 2, yaw: 0}
  },
  panorama4: {
    hall: {x: 0, z: 2, yaw: 0}
  },
  panorama5: {
    hall: {x: 0, z: 2, yaw: 0}
  }
};

function gotoRoom(room) {
  if (context.studio && context.studio.room && room !== context.room) {
    context.studio.message('Sal de la sala compartida antes de explorar otro escenario.');
    return Promise.resolve(false);
  }
  if (context.editor && context.editor.accessView && !context.editor.accessView.canVisit(roomNames[room])) {
    // Native demo portals open another read-only public projection during the
    // temporary preview. Private documents retain their single access scope.
    if (context.editor.accessView.visitPublicRoom) return context.editor.accessView.visitPublicRoom(roomNames[room]).then(visited => {
      if (!visited && context.studio) context.studio.message('Este escenario requiere acceso a su proyecto. Consulta Escenarios en el menú.');
      return visited;
    });
    if (context.studio) { context.studio.message('Este escenario requiere acceso a su proyecto. Consulta Escenarios en el menú.'); }
    return Promise.resolve(false);
  }
  return roomNavigation.go(room);
}

function commitRoomChange(room) {
  if (!suspendedRoom) suspendRoomChange();
  else if (suspendedRoom.entered) rooms[suspendedRoom.enteredRoom].exit(context);
  raycontrol.deactivateAll();

  const prevRoom = roomNames[context.room];
  const nextRoom = roomNames[room];
  const desktopSpawn = desktopPortalSpawns[prevRoom] &&
    desktopPortalSpawns[prevRoom][nextRoom];

  if (!context.vrMode && desktopSpawn) {
    context.camera.position.set(0, 1.6, 0);
    context.camera.rotation.set(0, desktopSpawn.yaw, 0);
    context.cameraRig.position.set(desktopSpawn.x, 0, desktopSpawn.z);
  } else if (targetPositions[prevRoom] && targetPositions[prevRoom][nextRoom]) {
    let deltaPosition = new THREE.Vector3();
    const targetPosition = targetPositions[prevRoom][nextRoom];
    var camera = renderer.xr.getCamera(context.camera);

    deltaPosition.x = camera.position.x - targetPosition.x;
    deltaPosition.z = camera.position.z - targetPosition.z;

    context.cameraRig.position.sub(deltaPosition);
  }

  context.room = room;

  playMusic(room);

  suspendedRoom.entered = true; suspendedRoom.enteredRoom = room;
  rooms[context.room].enter(context);
  if (context.editor) context.editor.afterRoomChange();
  if (context.roomAssets && context.roomAssets.setActiveRoom) context.roomAssets.setActiveRoom(nextRoom, context.editorRoots[nextRoom]);
  resetCollisionPose();
}

function suspendRoomChange() {
  if (suspendedRoom) {
    // A newer request can arrive after the older destination entered, while
    // its warmup is still covered. Retire that never-revealed room as well.
    if (suspendedRoom.entered) {if (context.editor) context.editor.beforeRoomChange(); rooms[suspendedRoom.enteredRoom].exit(context); suspendedRoom.entered = false; if (raycontrol) raycontrol.deactivateAll(); if (ambientMusic && ambientMusic.source && ambientMusic.isPlaying) ambientMusic.stop();}
    return;
  }
  if (context.editor) context.editor.beforeRoomChange();
  suspendedRoom = {room: context.room, entered: false, floorOffset: context.xrLocalFloorOffset || 0, rigPosition: context.cameraRig.position.clone(), rigQuaternion: context.cameraRig.quaternion.clone(), cameraPosition: context.camera.position.clone(), cameraQuaternion: context.camera.quaternion.clone()};
  rooms[context.room].exit(context); if (raycontrol) raycontrol.deactivateAll();
  if (ambientMusic && ambientMusic.source && ambientMusic.isPlaying) ambientMusic.stop();
  if (context.teleport && context.teleport.onHoverLeave) context.teleport.onHoverLeave();
  context.goto = null; clearKeyboardState();
}

async function recoverRoomChange(request) {
  if (!suspendedRoom) return;
  const recovery = suspendedRoom;
  const reenter = !(suspendedRoom.entered && suspendedRoom.enteredRoom === suspendedRoom.room && context.room === suspendedRoom.room);
  if (reenter && suspendedRoom.entered) rooms[suspendedRoom.enteredRoom].exit(context);
  context.room = suspendedRoom.room;
  context.cameraRig.position.copy(suspendedRoom.rigPosition); context.cameraRig.quaternion.copy(suspendedRoom.rigQuaternion);
  context.cameraRig.position.y += (context.xrLocalFloorOffset || 0) - suspendedRoom.floorOffset;
  // Tracked head-local transforms are never saved back into the XR camera.
  if (!context.vrMode) {context.camera.position.copy(suspendedRoom.cameraPosition); context.camera.quaternion.copy(suspendedRoom.cameraQuaternion);}
  if (context.editor) await context.editor.prepareRoom(roomNames[context.room]);
  if (suspendedRoom !== recovery || request && !request.isCurrent()) {if (suspendedRoom === recovery) suspendedRoom.entered = false; return;}
  if (reenter) {suspendedRoom.entered = true; suspendedRoom.enteredRoom = context.room; rooms[context.room].enter(context); playMusic(context.room); if (context.editor) context.editor.afterRoomChange();}
  resetCollisionPose();
  if (context.roomAssets && context.roomAssets.setActiveRoom) context.roomAssets.setActiveRoom(roomNames[context.room], context.editorRoots[roomNames[context.room]]);
  if (request && request.isCurrent() && context.roomTransitionView) {scene.updateMatrixWorld(true); await context.roomTransitionView.warm(scene, context.editor && context.editor.active && !context.vrMode ? context.editor.camera : context.camera, request);}
}

async function prepareCurrentRoom(request) {
  if (context.editor) {await context.editor.prepareRoom(roomNames[context.room], {signal: request.signal, yieldControl: request.yieldControl, assertCurrent: request.assertCurrent}); request.assertCurrent();}
  // A same-room document replacement still needs native ECS/audio re-entry.
  if (suspendedRoom && !suspendedRoom.entered) commitRoomChange(context.room);
  if (context.editor) context.editor.syncNative();
  scene.updateMatrixWorld(true);
  const renderCamera = context.editor && context.editor.active && !context.vrMode ? context.editor.camera : camera;
  await context.roomTransitionView.warm(scene, renderCamera, request);
}

function playMusic(room) {
  if (ambientMusic.source) ambientMusic.stop();

  const music = musicThemes[room];
  if (!music) { return; }
  ambientMusic.setBuffer(assets[music]);
  ambientMusic.setLoop(true);
  ambientMusic.setVolume(1.0);
  ambientMusic.offset = Math.random() * 60;
  ambientMusic.play();
}

var ecsyWorld;
var systemsGroup = {};

function detectWebXR() {
  if ('xr' in navigator) {
    navigator.xr.isSessionSupported('immersive-vr').then( supported => {
      if (!supported) document.getElementById('no-webxr').classList.remove('hidden');
    } ).catch(() => document.getElementById('no-webxr').classList.remove('hidden'));

  } else {
    document.getElementById('no-webxr').classList.remove('hidden');
  }
}

export function init() {

  window.webxrStartup.phase('Preparando la vista 3D…');

  document.getElementById(handedness + 'hand').classList.add('activehand');

  detectWebXR();

  var w = 100;
  ecsyWorld = new World();
  ecsyWorld
    .registerSystem(SDFTextSystem)
    .registerSystem(AreaCheckerSystem)
    .registerSystem(ControllersSystem)
    .registerSystem(DebugHelperSystem)
    .registerSystem(TransformSystem)
    .registerSystem(BillboardSystem)
    .registerSystem(HierarchySystem);

  systemsGroup['roomHall'] = new SystemsGroup(ecsyWorld, [
    AreaCheckerSystem, ControllersSystem, DebugHelperSystem
  ]);

  renderer = new THREE.WebGLRenderer({antialias: true, logarithmicDepthBuffer: false});
  renderer.gammaFactor = 2.2;
  renderer.outputEncoding = THREE.sRGBEncoding;
  context.graphics = new AdaptiveGraphics(renderer);
  context.graphics.setViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.005, 10000);
  camera.position.set(0, 1.6, 0);
  listener = new THREE.AudioListener();
  camera.add(listener);

  ambientMusic = new THREE.Audio(listener);

  controls = new SmoothPointerLockControls(camera, renderer.domElement);
  context.desktopLook = controls;

  parent = new THREE.Object3D();
  scene.add(parent);

  renderer.domElement.addEventListener('click', onDesktopCanvasClick);
  renderer.domElement.addEventListener('mousedown', onDesktopSelectStart);
  document.addEventListener('mouseup', onDesktopSelectEnd);
  renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearKeyboardState);

  window.addEventListener('resize', onWindowResize, false);

  for (let i = 0; i < 2; i++) {
    controllers[i] = renderer.xr.getController(i);
    createXRGrip(renderer, controllers[i], i);
    controllers[i].raycaster = new THREE.Raycaster();
    controllers[i].raycaster.near = 0.1;
    controllers[i].addEventListener('selectstart', onSelectStart);
    controllers[i].addEventListener('selectend', onSelectEnd);
  }

  // global lights
  const lightSun = new THREE.DirectionalLight(0xeeffff);
  lightSun.name = 'sun';
  lightSun.position.set(0.2, 1, 0.1);
  const lightFill = new THREE.DirectionalLight(0xfff0ee, 0.3);
  lightFill.name = 'fillLight';
  lightFill.position.set(-0.2, -1, -0.1);

  scene.add(lightSun, lightFill);

  var cameraRig = new THREE.Group();
  cameraRig.add(controls.getObject());
  cameraRig.add(controllers[0]);
  cameraRig.add(controllers[1]);
  controllers.forEach(controller => cameraRig.add(controller.userData.gripObject));
  cameraRig.position.set(0, 0, 2);
  scene.add(cameraRig);

  context.vrMode = false; // in vr
  context.assets = assets;
  context.shaders = shaders;
  context.scene = parent;
  context.renderer = renderer;
  context.camera = camera;
  context.audioListener = listener;
  context.goto = null;
  context.cameraRig = cameraRig;
  context.controllers = controllers;
  context.world = ecsyWorld;
  context.systemsGroup = systemsGroup;
  context.handedness = handedness;
  context.editorRoots = {};
  context.resetCollisionPose = resetCollisionPose;
  context.nativeTextureAI = new NativeTextureAI(context);
  context.preparedMaterials = new PreparedMaterialTextures(context);
  context.materialAI = new NativeMaterialAI(context);
  context.xrMirror = new XRMirror(context, {maxFPS: 15, maxPixels: 4000000});
  context.xrLocomotion = new XRLocomotion(context);

  context.roomAssets = new RoomAssets(renderer, assets, {getLimits: () => context.graphics && context.graphics.getLimits()});
  context.roomTransitionView = new RoomTransition(context);
  roomNavigation = new RoomNavigation(context, {
    count: rooms.length,
    getVersion: () => context.editor ? context.editor.projectGeneration : 0,
    cover: (request, label) => {
      request.yieldControl = () => context.roomTransitionView.nextFrame(request, 1);
      clearKeyboardState(); if (raycontrol) raycontrol.disable();
      if (context.xrLocomotion) context.xrLocomotion.reset();
      return context.roomTransitionView.cover(request, label);
    },
    suspend: suspendRoomChange,
    prepare: async (room, request) => {
      const options = {signal: request.signal, yieldControl: request.yieldControl, assertCurrent: request.assertCurrent};
      if (context.editor) await context.editor.prepareRoom(roomNames[room], options);
      else await context.roomAssets.prepareRoom(roomNames[room], context.editorRoots[roomNames[room]], options);
      request.assertCurrent();
      if (rooms[room].prepare) await rooms[room].prepare(context);
    },
    commit: commitRoomChange,
    prepareCurrent: prepareCurrentRoom,
    recover: recoverRoomChange,
    finish: async request => {
      await context.roomTransitionView.finish(request); if (!request.isCurrent()) return;
      suspendedRoom = null; clearKeyboardState(); resetCollisionPose();
      if (context.editor && context.editor.clearNavigation) context.editor.clearNavigation();
      if (context.xrLocomotion) context.xrLocomotion.reset();
      if (raycontrol) {if (context.editor && context.editor.active) raycontrol.disable(); else raycontrol.enable();}
    },
    failed: (error, retry) => context.roomTransitionView.fail(error, retry),
    onLoading: () => { if (context.editor) context.editor.toast('Cargando sala…'); },
    onError: error => {
      console.error('No se pudo abrir la sala', error);
      if (context.editor) context.editor.toast('No se pudo abrir la sala: ' + error.message + '. Puedes volver a intentarlo.');
    },
    onSettled: () => { if (context.editor) context.editor.roomSelect.value = context.room; }
  });
  context.roomNavigation = roomNavigation;
  context.withRoomTransition = (work, options) => roomNavigation.runExternal(work, options);

  window.context = context;

  const initialAssets = context.roomAssets.initialAssets();
  const loadTotal = Object.keys(initialAssets).length;

  loadAssets(renderer, 'assets/', initialAssets, () => {
    Object.assign(assets, initialAssets);
    window.webxrStartup.phase('Preparando la experiencia…');
    raycontrol = new RayControl(context, handedness);
    context.raycontrol = raycontrol;

    teleport = new Teleport(context);
    context.teleport = teleport;

    setupControllers();
    roomHall.setup(context);
    roomPanorama.setup(context);
    roomPanoramaStereo.setup(context);
    roomPhotogrammetryObject.setup(context);
    roomVertigo.setup(context);
    roomSound.setup(context);
    setupDesktopPointer();

    // Initial direct links (e.g. ?room=sound) need the same preparation as a
    // portal transition, before enter() starts native timers or playback.
    const prepare = rooms[context.room].prepare ? rooms[context.room].prepare(context) : Promise.resolve();
    Promise.resolve(prepare).then(finishStartup).catch(error => window.webxrStartup.fail(error));
  },

  loadProgress => {
    window.webxrStartup.progress(loadProgress, loadTotal);
  },
  debug, error => window.webxrStartup.fail(error));

  function finishStartup() {
    rooms[context.room].enter(context);

    // Resolve ECS-created text/parents before capturing stable native object IDs.
    ecsyWorld.execute(0, 0);

    document.body.appendChild(renderer.domElement);
    const vrButton = VRButton.createButton(renderer, (status, sessionInfo) => {
      context.xrEntryPending = false;
      context.xrExitPending = false;
      context.nativeTextureAI.resume('vr-entry');
      roomNavigation.cancel();
      context.vrMode = status === 'sessionStarted';
      context.xrLocomotion.reset();
      if (context.vrMode) context.xrReferenceSpaceType = sessionInfo && sessionInfo.referenceSpaceType || 'local-floor';
      else setVRFloorOffset(false);
      if (context.editor) context.editor.onVRChange(context.vrMode);
      if (desktopControllerData) desktopControllerData.enabled = !context.vrMode;
      document.body.classList.toggle('vr-mode', context.vrMode);
      if (context.vrMode) {
        controls.unlock();
        clearKeyboardState();
        document.getElementById('keyboard-help').classList.add('hidden');
        // Keep the hall's live simulation and recording when only changing
        // input mode. Other rooms still enter VR through the original hall.
        const keepProjectRoom = keepRoomOnVREntry(context.editor, roomNames[context.room]);
        if (context.room !== 0 && !keepProjectRoom) {
          gotoRoom(0).then(changed => {
            if (changed && context.vrMode) {
              context.cameraRig.position.set(0, 0, 2);
              setVRFloorOffset(true, context.xrReferenceSpaceType, true);
              resetCollisionPose();
            }
          });
        } else { context.cameraRig.position.set(0, 0, 2); if (context.studio) context.studio.applySpawn(true); }
        setVRFloorOffset(true, context.xrReferenceSpaceType);
        context.goto = null;
      } else {
        document.getElementById('keyboard-help').classList.remove('hidden');
      }
      resetCollisionPose();
      if (context.studio) context.studio.onVRChange(context.vrMode);
    }, canStartVR, {preferredFrameRate: 72});
    context.vrButton = vrButton;
    vrButton.id = 'VRButton';
    document.body.appendChild(vrButton);
    context.editor = new SceneEditor(context, {
      renderScene: scene,
      gotoRoom,
      unlock: () => controls.unlock(),
      clearKeyboard: clearKeyboardState
    });
    context.editor.ready.then(async () => {
      context.editor.entities = new SceneEntities(context.editor);
      if (context.editor.editorEnabled) context.editor.conveyorViewer = new ConveyorViewer(context.editor);
      const studio = new StudioExperience(context.editor, vrButton);
      await studio.ready;
      if (context.vrMode) studio.onVRChange(true);
      if (context.editor.editorEnabled) {
        context.editor.sceneCreationDialog = new SceneCreationDialog(context.editor);
        context.editor.monitorWidgets = new MonitorWidgetTools(context.editor);
        context.editor.sceneGuide = new SceneGuideChat(context.editor);
        new ProjectWorkspaceTabs(context.editor);
      }
      setupMobileNavigation();
      renderer.setAnimationLoop(animate);
      window.webxrStartup.complete();
    }).catch(error => window.webxrStartup.fail(error));
  }

}

function onKeyDown(event) {
  if (context.editor && context.editor.active || context.drivingVehicle) return;
  const target = event.target;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '')) {
    return;
  }

  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(event.code) !== -1 || context.desktopFlight && ['KeyQ', 'KeyE', 'ControlLeft', 'ControlRight'].includes(event.code)) {
    event.preventDefault();
    keyboardState[event.code] = true;
    return;
  }

  if (!debug || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.code === 'KeyN') {
    gotoRoom((context.room + 1) % rooms.length);
  } else if (/^Digit[0-9]$/.test(event.code)) {
    const room = Number(event.code.slice(5));
    if (room < rooms.length) gotoRoom(room);
  }
}

function onKeyUp(event) {
  keyboardState[event.code] = false;
}

function clearKeyboardState() {
  keyboardState = {};
  if (controls && controls.reset) controls.reset();
  if (context.mobileNavigation) context.mobileNavigation.reset();
  // A mouse release outside the window must not leave a pushbutton held down.
  // The immersive session retains its own controller lifecycle.
  if (!context.vrMode && raycontrol && desktopControllerData && raycontrol.cancelSelect) raycontrol.cancelSelect(desktopControllerData);
}

function setupDesktopPointer() {
  desktopController = new THREE.Group();
  desktopController.userData.isDesktop = true;
  desktopController.position.set(0.2, -0.2, -0.45);
  desktopController.userData.grabbing = null;
  desktopController.boundingBox = new THREE.Box3();
  const raycasterContext = new THREE.Group();
  raycasterContext.name = 'raycasterContext';
  // Keep the virtual hand offset for grabbing, but aim interactions through the
  // centered reticle rather than along a parallel ray beside the camera.
  raycasterContext.position.copy(desktopController.position).negate();
  raycasterContext.visible = false;
  desktopController.add(raycasterContext);
  camera.add(desktopController);
  desktopControllerData = raycontrol.addController(
    desktopController,
    {handedness: raycontrol.primary},
    raycasterContext
  );
  context.desktopController = desktopController;
  context.desktopControllerData = desktopControllerData;
}

function onDesktopCanvasClick(event) {
  // Selecting the operator zone can mount a truck during mousedown. Keep the
  // cursor that mount just released so this same click cannot hide its HUD.
  // A later canvas press made from inside the cockpit can capture look again.
  if (context.drivingVehicle && context.drivingVehicle !== desktopVehicleAtMouseDown) return;
  if (event.button === 0 && !context.vrMode && !(context.editor && context.editor.active) && !controls.isLocked) controls.lock();
}

function onDesktopSelectStart(event) {
  desktopVehicleAtMouseDown = context.drivingVehicle || null;
  if (context.vrMode || (context.editor && context.editor.active) || !desktopControllerData) return;
  if (event.button === 2) {
    event.preventDefault();
    desktopController.dispatchEvent({type: 'griptoggle'});
    return;
  }
  if (event.button !== 0) return;
  raycontrol.onSelectStart({target: desktopController});
}

function onDesktopSelectEnd(event) {
  if (context.vrMode || (context.editor && context.editor.active) || !desktopControllerData) return;
  if (event.button !== 0) return;
  raycontrol.onSelectEnd({target: desktopController});
}

function setupMobileNavigation() {
  const mouseEvent = () => ({button: 0, preventDefault() {}});
  context.mobileNavigation = new MobileNavigation(context, {
    onInteractStart: () => onDesktopSelectStart(mouseEvent()),
    onInteractEnd: () => onDesktopSelectEnd(mouseEvent()),
    onInteractCancel: () => raycontrol.cancelSelect(desktopControllerData),
    onGrabToggle: () => {
      if (!desktopControllerData || !desktopControllerData.enabled || desktopControllerData.active || raycontrol.enabled === false) return;
      const simulation = context.editor && context.editor.simulation;
      const pointedProduct = simulation && raycontrol.selectionEntries(desktopControllerData).some(entry => {
        const product = entry.state && simulation.products.get(entry.state.colliderMesh);
        return product && product.stateEntry && product.stateEntry.state === entry.state;
      });
      if (simulation && (simulation.held.has(desktopController) || pointedProduct)) {
        // Industrial desktop loads toggle through the trigger, with its normal
        // reach/obstruction checks and consumed release. Native sticks use grip.
        onDesktopSelectStart(mouseEvent());
        onDesktopSelectEnd(mouseEvent());
      } else onDesktopSelectStart({button: 2, preventDefault() {}});
    },
    onRelease: () => {
      const simulation = context.editor && context.editor.simulation;
      if (simulation) simulation.releaseHeldProducts(desktopController);
      if (context.editorXylophone && context.editorXylophone.releaseHeld) context.editorXylophone.releaseHeld(desktopController);
    },
    onDistance: deltaY => {
      const simulation = context.editor && context.editor.simulation;
      if (simulation) simulation.handleProductWheel({deltaY, deltaMode: 0, preventDefault() {}, stopPropagation() {}});
    },
    onFlightToggle: () => context.studio.setDesktopFlight(!context.desktopFlight)
  });
}

function updateKeyboardMovement(delta) {
  if (context.vrMode || (context.editor && context.editor.active)) return;
  const mobile = context.mobileNavigation ? context.mobileNavigation.consume() : {forward: 0, right: 0, vertical: 0};
  if (controls.addLookDelta && (mobile.lookX || mobile.lookY)) controls.addLookDelta(mobile.lookX || 0, mobile.lookY || 0);
  if (controls.update) controls.update(delta);
  if (context.drivingVehicle) return;
  if (context.studioLocomotion === 'teleport' && !context.desktopFlight) return;

  context.cameraRig.updateMatrixWorld(true);
  const previous = camera.getWorldPosition(new THREE.Vector3());

  const forward = Number(Boolean(keyboardState.KeyW || keyboardState.ArrowUp)) -
    Number(Boolean(keyboardState.KeyS || keyboardState.ArrowDown)) + mobile.forward;
  const right = Number(Boolean(keyboardState.KeyD || keyboardState.ArrowRight)) -
    Number(Boolean(keyboardState.KeyA || keyboardState.ArrowLeft)) + mobile.right;
  if (context.desktopFlight) {
    const vertical = Number(Boolean(keyboardState.KeyQ)) - Number(Boolean(keyboardState.KeyE)) + mobile.vertical;
    const direction = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(forward);
    const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    direction.addScaledVector(lateral, right); direction.y += vertical;
    const boost = keyboardState.ControlLeft || keyboardState.ControlRight ? 3 : 1;
    const strength = Math.min(1, direction.length());
    const desired = previous.clone().add(direction.normalize().multiplyScalar(strength * keyboardMoveSpeed * boost * Math.max(0, Math.min(delta || 0, .1))));
    const resolved = context.collisionWorld ? context.collisionWorld.moveSphere(previous, desired, .25) : desired;
    camera.position.copy(camera.parent ? camera.parent.worldToLocal(resolved.clone()) : resolved); context.cameraRig.updateMatrixWorld(true); return;
  }
  const distance = keyboardMoveSpeed * Math.min(delta, 0.1) /
    Math.max(1, Math.hypot(forward, right));
  controls.moveForward(forward * distance);
  controls.moveRight(right * distance);

  if (context.collisionWorld) {
    context.cameraRig.updateMatrixWorld(true);
    const desired = camera.getWorldPosition(new THREE.Vector3());
    const resolved = context.collisionWorld.moveCapsule(previous, desired, {radius: 0.25, height: 1.6, eyeHeight: 1.6});
    camera.position.copy(camera.parent ? camera.parent.worldToLocal(resolved.clone()) : resolved);
    context.cameraRig.updateMatrixWorld(true);
  }
}

function constrainVRCamera() {
  if (context.drivingVehicle) { resetCollisionPose(); return; }
  if (!context.vrMode || !context.collisionWorld) {
    resetCollisionPose();
    return;
  }
  context.cameraRig.updateMatrixWorld(true);
  // Three r112 supplies the tracked pose through matrixWorld. Calling
  // getWorldPosition() on this ArrayCamera would rebuild a stale local pose.
  const xrCamera = renderer.xr.getCamera(camera);
  const desired = new THREE.Vector3().setFromMatrixPosition(xrCamera.matrixWorld);
  const rigPosition = context.cameraRig.getWorldPosition(new THREE.Vector3());
  const eyeHeight = THREE.Math.clamp(desired.y - rigPosition.y, 0.6, 2.3);
  const resolved = context.collisionWorld.moveCapsule(lastVRCollisionPosition || desired, desired,
    {radius: 0.25, height: eyeHeight, eyeHeight});
  const correctedRig = rigPosition.add(resolved.clone().sub(desired));
  context.cameraRig.position.copy(context.cameraRig.parent ?
    context.cameraRig.parent.worldToLocal(correctedRig) : correctedRig);
  context.cameraRig.updateMatrixWorld(true);
  lastVRCollisionPosition = resolved.clone();
}

function setupControllers() {
  var model = assets['generic_controller_model'].scene;
  var material = new THREE.MeshLambertMaterial({
    map: assets['controller_tex'],
  });
  model.getObjectByName('body').material = material;
  model.getObjectByName('trigger').material = material;

  for (let i = 0;i < 2; i++) {
    let controller = controllers[i];
    controller.boundingBox = new THREE.Box3();
    controller.userData.grabbing = null;
    controller.addEventListener( 'connected', function ( event ) {
      if (this.userData.controllerModel) this.remove(this.userData.controllerModel);
      this.userData.controllerModel = model.clone();
      this.add(this.userData.controllerModel);
      const data = raycontrol.addController(this, event.data); data.grip = this.userData.gripObject;
    } );
    controller.addEventListener( 'disconnected', function () {
      if (this.userData.controllerModel) this.remove(this.userData.controllerModel);
      delete this.userData.controllerModel;
      if (this.userData.gripObject) this.userData.gripObject.visible = false;
      if (context.editorXylophone && context.editorXylophone.releaseHeld) context.editorXylophone.releaseHeld(this);
      raycontrol.removeController(this);
    });
  }
}

function syncXRControllers(frame) {
  if (!context.vrMode || !renderer.xr.getSession) return;
  const session = renderer.xr.getSession();
  if (!session || !session.inputSources) return;
  // Three r112 maps target-ray Groups by the current inputSources index. If
  // the first hand disconnects, the remaining hand moves to index zero without
  // receiving a connected event. Reconcile the app registry with that same map.
  controllers.forEach((controller, index) => {
    const source = session.inputSources[index];
    updateXRGrip(renderer, controller, source, frame);
    const previous = raycontrol.controllers.find(entry => entry.controller === controller);
    if (previous && previous.inputSource === source) return;
    if (previous) controller.dispatchEvent({type: 'disconnected', data: previous.inputSource});
    if (source) controller.dispatchEvent({type: 'connected', data: source});
  });
}

// @FIXME Hack for Oculus Browser issue
var selectStartSkip = {};
var selectEndSkip = {};
var OculusBrowser = navigator.userAgent.indexOf("OculusBrowser") !== -1 &&
  parseInt(navigator.userAgent.match(/OculusBrowser\/([0-9]+)./)[1]) < 8;

// <@FIXME

function onSelectStart(ev) {
  if (context.vrMode) {
    const data = raycontrol.controllers.find(entry => entry.controller === ev.target);
    if (context.studioMenuOpen || data && data.currentIntersection && data.currentIntersection.state.xrMenu) ev.target.userData.studioMenuTrigger = true;
  }
  // @FIXME Hack for Oculus Browser issue
  if (OculusBrowser) {
    const controller = ev.target;
    if (!selectStartSkip[controller]) {
      selectStartSkip[controller] = true;
      return;
    }
    selectStartSkip[controller] = false;
  }
  // <@FIXME

  const trigger = ev.target.getObjectByName('trigger');
  if (trigger) trigger.rotation.x = -0.3;
  raycontrol.onSelectStart(ev);
}

function onSelectEnd(ev) {
  // @FIXME Hack for Oculus Browser issue
  if (OculusBrowser) {
    const controller = ev.target;
    if (!selectEndSkip[controller]) {
      selectEndSkip[controller] = true;
      return;
    }
    selectEndSkip[controller] = false;
  }
  // <@FIXME

  const trigger = ev.target.getObjectByName('trigger');
  if (trigger) trigger.rotation.x = 0;
  raycontrol.onSelectEnd(ev);
  if (ev.target.userData.studioMenuTrigger) Promise.resolve().then(() => { delete ev.target.userData.studioMenuTrigger; });
}

function onWindowResize() {
  if (context.editor) { context.editor.resize(); return; }
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (context.graphics) context.graphics.setViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(time, frame) {
  var delta = clock.getDelta();
  var elapsedTime = clock.elapsedTime;

  // WebGL can be lost before its DOM event reaches Three's internal listener.
  // Avoid environment/PMREM/shader work in that gap: r112's compile diagnostics
  // otherwise throw on null logs and stop its animation callback permanently.
  // Keep sampling the clock so recovery does not advance a large catch-up step.
  const gl = renderer.getContext && renderer.getContext();
  if (gl && gl.isContextLost && gl.isContextLost() || context.graphics && context.graphics.lost) return;

  // r112 does not expose the session-init promise. Button state also clears
  // this gate after a denied/failed start, without deferring the user gesture.
  if (context.xrEntryPending && context.vrButton && !context.vrButton.disabled) {
    context.xrEntryPending = false;
    context.nativeTextureAI.resume('vr-entry');
  }
  if (context.materialAI) context.materialAI.tick();

  // A hidden desktop tab has no visible work. Keep the XR session running when
  // the headset owns presentation, even if the companion tab is hidden.
  if (document.hidden && !context.vrMode) {
    if (context.graphics) context.graphics.tick(0, {hidden: true});
    return;
  }
  const renderStarted = performance.now();
  const editor = context.editor;
  if (context.graphics) context.graphics.tick(delta, {
    xr: context.vrMode,
    loading: Boolean(context.roomTransition || editor && (editor.initializing || editor.loadingProject || editor.busy || editor.document && editor.document.loading)),
    workMs: lastRenderWorkMs
  });
  if (context.mobileNavigation) context.mobileNavigation.sync();
  const collisionWorld = context.collisionWorld;
  if (context.roomTransitionView && context.roomTransitionView.active) {
    syncXRControllers(frame); context.roomTransitionView.render(renderer, camera, delta); return;
  }
  if (context.roomTransitionView) context.roomTransitionView.presented();
  if (collisionWorld) collisionWorld.beginFrame();
  try {
    if (context.studio) context.studio.tick();
    if (context.editor && context.editor.entities) context.editor.entities.tick(delta);
    if (context.editor && context.editor.conveyorViewer) context.editor.conveyorViewer.tick(delta);
    if (context.editor && context.editor.active && !context.vrMode) {
      context.editor.render(delta);
      return;
    }

    updateKeyboardMovement(delta);
    syncXRControllers(frame);
    if (context.studio && context.studio.immersiveMenu) context.studio.immersiveMenu.tick(delta);
    if (context.xrLocomotion) context.xrLocomotion.tick(delta);
    ecsyWorld.execute(delta, elapsedTime);
    scene.updateMatrixWorld(true);

    // update controller bounding boxes
    for (let i = 0; i < controllers.length; i++) {
      const model = controllers[i].getObjectByName('Scene');
      if (model) controllers[i].boundingBox.setFromObject(model);
    }
    if (desktopController) desktopController.boundingBox.setFromObject(desktopController);

    context.raycontrol.execute(context, delta, elapsedTime);
    document.getElementById('desktop-reticle').classList.toggle(
      'hovering', Boolean(desktopControllerData && desktopControllerData.currentIntersection)
    );
    rooms[context.room].execute(context, delta, elapsedTime);
    // Native ECS/controller interactions may have moved colliders since walking.
    // All following simulation queries reuse this snapshot and targeted updates.
    if (collisionWorld) collisionWorld.invalidate();
    if (context.editor) context.editor.execute(delta, elapsedTime);
    constrainVRCamera();
    const docking = context.vehicleDriving && context.vehicleDriving.docking;
    if (docking && docking.renderBefore) docking.renderBefore(scene, delta);
    renderer.render(scene, camera);
    if (context.xrMirror) context.xrMirror.postRender(scene, camera, delta);
    if (docking && docking.postRender) docking.postRender();
    if (context.goto !== null) {
      gotoRoom(context.goto);
      context.goto = null;
    }
  } finally {
    if (collisionWorld) collisionWorld.endFrame();
    // CPU submission time is only headroom for an upgrade trial, not GPU timing.
    lastRenderWorkMs = performance.now() - renderStarted;
  }
}

window.onload = () => {
  try { init(); }
  catch (error) { window.webxrStartup.fail(error); }
};
