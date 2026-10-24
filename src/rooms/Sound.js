import * as THREE from 'three';
import {nativeBehavior, declareNativeBehaviors} from '../editor/NativeBehaviorAdapters.js';
var scene, listener, timeout, mixer, door, doorMaterial, context, editorRoot;

const soundNames = [
  'bells',
  'horn',
  'cowbell',
  'guiro',
  'mandolin',
  'squeaker',
  'train',
  'whistle',
  'motorhorn',
  'surdo',
  'trumpet',
];

var sounds = {};
soundNames.forEach( i => { sounds[i] = {animations: [], mesh: null, player: null, shadow: null} })

const MAX_REPETITIONS = 3;
var repetitions = MAX_REPETITIONS - 1;

function createDoorMaterial(ctx) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: {value: 0},
      selected: {value: 0},
      tex: {value: ctx.assets['doorfx_tex']}
    },
    vertexShader: ctx.shaders.basic_vert,
    fragmentShader: ctx.shaders.door_frag
  });
}

function prepareInstrument(sound, asset) {
  if (sound.loaded && sound.asset === asset) return Promise.resolve();
  if (sound.loadPromise && sound.loadingAsset === asset) return sound.loadPromise;
  sound.asset = asset;
  sound.loaded = false;
  sound.loadingAsset = asset;
  const url = context.editor && context.editor.library ? context.editor.library.getURL(asset) : 'assets/' + asset;
  sound.loadPromise = new Promise((resolve, reject) => {
    new THREE.AudioLoader().load(url, buffer => {
      if (sound.asset === asset) { sound.player.setBuffer(buffer); sound.loaded = true; }
      resolve();
    }, undefined, reject);
  }).catch(error => {
    if (sound.loadingAsset === asset) sound.loadPromise = null;
    throw error;
  });
  return sound.loadPromise;
}

// The room's audio buffers are downloaded/decoded only when it is entered.
// Concurrent transitions share requests; a failed request can be retried.
export function prepare(ctx) {
  if (!ctx.roomAssets) return Promise.resolve();
  return Promise.all(Object.keys(sounds).map(id => {
    const sound = sounds[id];
    const config = sound.mesh && nativeBehavior(sound.mesh, 'sound');
    return config ? prepareInstrument(sound, config.asset) : Promise.resolve();
  }));
}

export function setup(ctx) {
  context = ctx;
  const assets = ctx.assets;
  scene = assets['sound_model'].scene;
  door = assets['sound_door_model'].scene;

  door.getObjectByName('door_frame').material =
    new THREE.MeshBasicMaterial({map: assets['sound_door_lm_tex']});

  doorMaterial = createDoorMaterial(ctx);
  door.getObjectByName('door').material = doorMaterial;
  declareNativeBehaviors(door.getObjectByName('door'), [{type: 'portal', room: 0, event: 'press', hoverScale: 1.5}]);

  door.scale.set(0.5, 0.5, 0.5);
  door.position.set(0.4, 0.6, 1);
  door.rotation.set(0, 0.4, 0);

  listener = new THREE.AudioListener();

  mixer = new THREE.AnimationMixer(scene);

  for (let id in sounds) {
    const mesh = scene.getObjectByName(id);
    if (!mesh) { continue; } 

    const sound = new THREE.PositionalAudio(listener);
    if (!ctx.roomAssets) {
      const audioLoader = new THREE.AudioLoader();
      audioLoader.load('assets/ogg/' + id + '.ogg', buffer => {
        sound.setBuffer(buffer);
        sounds[id].loaded = true;
      });
    }

    sounds[id].player = sound;
    sounds[id].mesh = mesh;
    declareNativeBehaviors(mesh, [{type: 'sound', asset: 'ogg/' + id + '.ogg', volume: 1, autoplay: true, interval: 2}, {type: 'animation', clip: id, speed: 1, loop: false}]);
    sounds[id].asset = 'ogg/' + id + '.ogg';
    sounds[id].animationClip = id;
    sounds[id].animationRoot = mesh;
    const nativeClips = [];
    mesh.visible = false;
    mesh.add(sound);

    const clip = THREE.AnimationClip.findByName(assets['sound_model'].animations, id);
    if (clip) {
      nativeClips.push(clip);
      const action = mixer.clipAction(clip, mesh);
      action.loop = THREE.LoopOnce;
      sounds[id].animations.push(action);
    }

    for (let j = 0; j < mesh.children.length; j++) {
      const obj = mesh.children[j];
      const clip = THREE.AnimationClip.findByName(assets['sound_model'].animations, `${id}_${obj.name}`);
      if (!clip) { continue; }
      nativeClips.push(clip);
      const action = mixer.clipAction(clip, mesh);
      action.loop = THREE.LoopOnce;
      sounds[id].animations.push(action);
    }
    // Expose one complete clip per instrument to independently duplicated actors.
    // Most source files store a separate clip for each moving child mesh.
    const tracks = [];
    nativeClips.forEach(clip => clip.tracks.forEach(track => tracks.push(track.clone())));
    mesh.animations = tracks.length ? [new THREE.AnimationClip(id, -1, tracks)].concat(nativeClips.filter(clip => clip.name !== id)) : [];

    let shadow = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(3, 3),
      new THREE.MeshBasicMaterial({
        color: mesh.children[0].material.color,
        map: assets['sound_shadow_tex'],
        transparent: true,
        opacity: 0,
        depthTest: false,
        blending: THREE.AdditiveBlending
      })
    );
    shadow.position.set(mesh.position.x, 0.001, mesh.position.z);
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);
    sounds[id].shadow = shadow;
  }

  ctx.raycontrol.addState('sound', {
    colliderMesh: door.getObjectByName('door'),
    onHover: (intersection, active) => {
      const config = nativeBehavior(door.getObjectByName('door'), 'portal');
      if (!config) return;
      //teleport.onHover(intersection.point, active);
      const scale = intersection.object.scale;
      scale.z = Math.min(scale.z + 0.05 * (config.hoverScale + 0.5 - door.scale.z), config.hoverScale);
    },
    onHoverLeave: () => {
      //teleport.onHoverLeave();
    },
    onSelectStart: (intersection, e) => {
      const config = nativeBehavior(door.getObjectByName('door'), 'portal');
      if (config && config.event !== 'release') ctx.goto = config.room;
      //teleport.onSelectStart(e);
    },
    onSelectEnd: (intersection) => {
      const config = nativeBehavior(door.getObjectByName('door'), 'portal');
      if (config && config.event === 'release') ctx.goto = config.room;
      //teleport.onSelectEnd(intersection.point);
    }
  });

  ctx.raycontrol.addState('soundObjects', {
    colliderMesh: Object.keys(sounds).map(id => sounds[id].mesh).filter(Boolean),
    onSelectStart: hit => {
      let object = hit.object;
      while (object) {
        const sound = Object.keys(sounds).map(id => sounds[id]).find(value => value.mesh === object);
        if (sound) { playInstrument(sound); return; }
        object = object.parent;
      }
    }
  });

  const floorTexture = assets['grid_tex'];
  const floor = new THREE.Mesh(
    new THREE.PlaneBufferGeometry(20, 20),
    new THREE.MeshBasicMaterial({map: floorTexture})
  );
  scene.add(floor);
  floor.rotation.x = -Math.PI / 2;
  declareNativeBehaviors(floor, [{type: 'teleport'}]);

  editorRoot = new THREE.Group();
  editorRoot.name = 'Sala de sonido';
  editorRoot.add(scene, door);
  ctx.editorRoots.sound = editorRoot;

  ctx.raycontrol.addState('teleportSound', {
    vrOnly: true,
    colliderMesh: floor,
    onHover: (intersection, active) => {
      if (!nativeBehavior(floor, 'teleport')) return;
      ctx.teleport.onHover(intersection.point, active);
    },
    onHoverLeave: () => {
      ctx.teleport.onHoverLeave();
    },
    onSelectStart: (intersection, e) => {
      if (!nativeBehavior(floor, 'teleport')) return;
      ctx.teleport.onSelectStart(e);
    },
    onSelectEnd: (intersection) => {
      if (!nativeBehavior(floor, 'teleport')) return;
      ctx.teleport.onSelectEnd(intersection.point);
    }
  });
}

var currentSound = -1;

function updateAnimation(sound, config) {
  if (!config) { sound.animations.forEach(action => action.stop()); return; }
  let root = sound.mesh, clip = null;
  sound.mesh.traverse(node => {
    if (clip || !node.userData.editorVisualOwnerId) return;
    node.traverse(child => {
      if (clip || !child.animations) return;
      const candidate = THREE.AnimationClip.findByName(child.animations, config.clip);
      if (candidate) { clip = candidate; root = child; }
    });
  });
  if (!clip) clip = THREE.AnimationClip.findByName(sound.mesh.animations, config.clip);
  if (config.clip !== sound.animationClip || root !== sound.animationRoot) {
    sound.animations.forEach(action => action.stop());
    sound.animationClip = config.clip; sound.animationRoot = root;
    sound.animations = clip ? [mixer.clipAction(clip, root)] : [];
  }
  sound.animations.forEach(action => { action.timeScale = config.speed; action.loop = config.loop ? THREE.LoopRepeat : THREE.LoopOnce; });
}

function playInstrument(sound) {
  const config = sound.mesh && nativeBehavior(sound.mesh, 'sound');
  if (!config) return;
  const start = () => {
    if (sound.player.setVolume) sound.player.setVolume(config.volume);
    if (sound.player.isPlaying) sound.player.stop();
    sound.player.play();
  };
  if (config.asset !== sound.asset || !sound.loaded) {
    sound.asset = config.asset;
    sound.loaded = false;
    const url = context.editor && context.editor.library ? context.editor.library.getURL(config.asset) : 'assets/' + config.asset;
    new THREE.AudioLoader().load(url, buffer => { if (sound.asset === config.asset) { sound.player.setBuffer(buffer); sound.loaded = true; start(); } });
  } else start();
  const animation = nativeBehavior(sound.mesh, 'animation');
  updateAnimation(sound, animation);
  if (animation && sound.animations.length) {
    sound.mesh.visible = true;
    sound.animations.forEach(action => { action.timeScale = animation.speed; action.loop = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce; action.reset().play(); });
  }
  sound.shadow.material.opacity = 1;
}

function playSound() {
  if ((context.editor && context.editor.active) || (scene && !scene.visible)) {
    Object.keys(sounds).forEach(id => {
      if (sounds[id].player && sounds[id].player.isPlaying) sounds[id].player.stop();
    });
    timeout = null;
    return;
  }
  let sound;
  if (currentSound >= 0) {
    sound = sounds[soundNames[currentSound]];
    sound.player.stop();
    if (sound.animations.length) {
      sound.mesh.visible = false;
      sound.animations.forEach( i => {i.stop()});
    }
  }
  repetitions ++;
  if (repetitions == MAX_REPETITIONS) {
    repetitions = 0;
    // get next sound
    let checked = 0;
    do {
      currentSound = (currentSound + 1) % soundNames.length;
      sound = sounds[soundNames[currentSound]];
      const config = sound.mesh && nativeBehavior(sound.mesh, 'sound');
      if (config && config.autoplay) break;
      checked++;
    } while(checked < soundNames.length);
    if (checked >= soundNames.length) { currentSound = -1; timeout = setTimeout(playSound, 250); return; }
  }
  const config = sound.mesh && nativeBehavior(sound.mesh, 'sound');
  if (!config || !config.autoplay) { repetitions = MAX_REPETITIONS - 1; timeout = setTimeout(playSound, 250); return; }
  playInstrument(sound);
  timeout = setTimeout(playSound, config.interval * 1000);
}

export function enter(ctx) {
  ctx.renderer.setClearColor(0x000000);
  ctx.scene.add(editorRoot);
  ctx.camera.add(listener);

  timeout = setTimeout(playSound, 2000);
  ctx.raycontrol.activateState('teleportSound');
  ctx.raycontrol.activateState('sound');
  ctx.raycontrol.activateState('soundObjects');
}

export function exit(ctx) {
  ctx.scene.remove(editorRoot);
  ctx.camera.remove(listener);
  ctx.raycontrol.deactivateState('teleportSound');
  ctx.raycontrol.deactivateState('sound');
  ctx.raycontrol.deactivateState('soundObjects');
  clearTimeout(timeout);
  timeout = null;
  Object.keys(sounds).forEach(id => {
    if (sounds[id].player && sounds[id].player.isPlaying) sounds[id].player.stop();
  });
}

export function execute(ctx, delta, time) {
  // Editing pauses the native sequence without a polling timer. It resumes
  // when this room is executed again after leaving the editor.
  if (timeout === null && !(ctx.editor && ctx.editor.active) && scene.visible) timeout = setTimeout(playSound, 2000);
  Object.keys(sounds).forEach(id => {
    const sound = sounds[id]; if (!sound.mesh) return;
    const audio = nativeBehavior(sound.mesh, 'sound');
    if (!audio && sound.player.isPlaying) sound.player.stop();
    const animation = nativeBehavior(sound.mesh, 'animation');
    updateAnimation(sound, animation);
  });
  mixer.update(delta);
  const sound = sounds[soundNames[currentSound]];
  if (sound && sound.shadow.material.opacity > 0) {
    sound.shadow.material.opacity -= delta * 0.5;
  }
  doorMaterial.uniforms.time.value = time;

  if (door.scale.z > 0.5) {
    door.scale.z = Math.max(door.scale.z - delta * door.scale.z, 0.5);
  }
}
