import * as THREE from 'three';
import {nativeBehavior, declareNativeBehaviors} from '../editor/NativeBehaviorAdapters.js';
import { Text, Position, ParentObject3D } from '../components/index.js';

var panoramaRoots = [], currentRoot = null, context, panel, panelText;

const NUM_PANOS = 5;

const DATA = [
  'Tiger and Turtle - Magic Mountain\nArt installation in Agerpark, Germany.',
  'Hiking trail at Lake Byllesby Regional Park near Cannon Falls, USA.',
  'Dellwiger Bach natural reserve in Dortmund, Germany.',
  'Zapporthorn summit in Lepontine Alps, Switzerland.',
  'Ruin of romanesque Paulinzella abbey (1106) in Thuringia, Germany.',
];

var panoMaterials = [];

export function setup(ctx) {
  const assets = ctx.assets;
  const geometry = new THREE.SphereBufferGeometry(500, 60, 40);
  for (var i = 0; i < NUM_PANOS; i++) {
    const panoName = 'pano'+(i + 2);
    panoMaterials[i] = new THREE.MeshBasicMaterial( { map: assets[panoName], side: THREE.BackSide });
    const root = new THREE.Group();
    root.name = 'Panorama ' + (i + 1);
    const pano = new THREE.Mesh(geometry, panoMaterials[i]);
    pano.name = 'Entorno panorámico 360';
    declareNativeBehaviors(pano, [{type: 'portal', room: 0, event: 'release', hoverScale: 1}]);
    root.add(pano);
    panoramaRoots[i] = root;
    ctx.editorRoots['panorama' + (i + 1)] = root;
  }

  panel = assets['hall_model'].scene.getObjectByName('infopanel');
  panel.material = new THREE.MeshBasicMaterial({color: 0x040404});
  panel.position.set(0, 0.1, 0);
  panel.parent.remove(panel);

  panelText = ctx.world.createEntity();
  panelText
    .addComponent(Text, {
      color: '#ffffff',
      fontSize: 0.02,
      anchor: 'left',
      textAlign: 'left',
      baseline: 'center',
      maxWidth: 0.34,
      lineHeight: 1.3,
      text: DATA[0],
    })
    .addComponent(ParentObject3D, {value: panel})
    .addComponent(Position, {x: -0.17, y: 0.003, z: 0.01});

  ctx.raycontrol.addState('panorama', {
    raycaster: false,
    onSelectStart: () => {
      const config = currentRoot && nativeBehavior(currentRoot.children[0], 'portal');
      if (config && config.event === 'press') ctx.goto = config.room;
    },
    onSelectEnd: onSelectEnd
  });
}

export function enter(ctx) {
  ctx.renderer.setClearColor(0x000000);

  const room = ctx.room - 5;
  panelText.getMutableComponent(Text).text = DATA[room];
  currentRoot = panoramaRoots[room];
  ctx.scene.add(currentRoot);

  ctx.controllers[1].add(panel);

  ctx.raycontrol.activateState('panorama');

  context = ctx;
}

export function exit(ctx) {
  if (currentRoot) ctx.scene.remove(currentRoot);
  currentRoot = null;
  ctx.controllers[1].remove(panel);

  ctx.raycontrol.deactivateState('panorama');
}

export function execute(ctx, delta, time) {
}

export function onSelectEnd(evt) {
  const config = currentRoot && nativeBehavior(currentRoot.children[0], 'portal');
  if (config && config.event === 'release') context.goto = config.room;
}
