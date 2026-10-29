import * as THREE from 'three';
import {nativeBehavior, declareNativeBehaviors} from '../../../../../packages/tools/editor/src/NativeBehaviorAdapters.js';
var panoL, panoR, context, editorRoot;

export function setup(ctx) {
  const assets = ctx.assets;
  const geometry = new THREE.SphereBufferGeometry(500, 60, 40);
  const materialL = new THREE.MeshBasicMaterial( { map: assets['stereopanoR'], side: THREE.BackSide } );
  const materialR = new THREE.MeshBasicMaterial( { map: assets['stereopanoL'], side: THREE.BackSide } );
  panoL = new THREE.Mesh(geometry, materialL);
  panoL.layers.set(1);
  declareNativeBehaviors(panoL, [{type: 'portal', room: 0, event: 'release', hoverScale: 1}]);
  panoR = new THREE.Mesh(geometry, materialR);
  panoR.layers.set(2);
  panoL.name = 'Panorama estéreo · ojo izquierdo';
  panoR.name = 'Panorama estéreo · ojo derecho';
  editorRoot = new THREE.Group();
  editorRoot.name = 'Panorama estéreo';
  editorRoot.add(panoL, panoR);
  ctx.editorRoots.panoramastereo = editorRoot;

  ctx.raycontrol.addState('panoramaStereo', {
    raycaster: false,
    onSelectStart: () => {
      const config = nativeBehavior(panoL, 'portal');
      if (config && config.event === 'press') ctx.goto = config.room;
    },
    onSelectEnd: onSelectEnd
  });
}

export function enter(ctx) {
  ctx.renderer.setClearColor(0x000000);
  ctx.scene.add(editorRoot);
  ctx.camera.layers.enable(1);
  context = ctx;

  ctx.raycontrol.activateState('panoramaStereo');
}

export function exit(ctx) {
  ctx.scene.remove(editorRoot);
  ctx.camera.layers.disable(1);
  ctx.raycontrol.deactivateState('panoramaStereo');
}

export function execute(ctx, delta, time) {
}

export function onSelectEnd(evt) {
  const config = nativeBehavior(panoL, 'portal');
  if (config && config.event === 'release') context.goto = config.room;
}

