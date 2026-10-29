import * as THREE from 'three';
import {nativeBehavior, declareNativeBehaviors} from '../../../../../packages/tools/editor/src/NativeBehaviorAdapters.js';
import { Children, Object3D, Billboard, Text, Position, ParentObject3D } from '../../../../../packages/render-three/ecs/components/index.js';
import INFO_DATA from './InfoPanelsData.js';

var panels = [], panelTexts = [], panelsEntity = [];

export function setup(ctx, hall) {
  for (var i = 0; i < INFO_DATA.length; i++) {
    const id = i < 10 ? '0' + i : i;
    panels[i] = hall.getObjectByName('infopanel0'+id);
    declareNativeBehaviors(panels[i], [{type: 'info', title: INFO_DATA[i].title, text: INFO_DATA[i].description, fontSize: 0.05, color: '#ffffff'}, {type: 'billboard'}]);
    panels[i].geometry.computeBoundingBox();
    const panelWidth = panels[i].geometry.boundingBox.max.x - panels[i].geometry.boundingBox.min.x;
    const panelHeight = panels[i].geometry.boundingBox.max.y - panels[i].geometry.boundingBox.min.y;
    const offsety = INFO_DATA[i].offsety || 0;
    panels[i].material = new THREE.MeshBasicMaterial({color: 0x040404, transparent: true});

    panelTexts[i] = ctx.world.createEntity();
    panelTexts[i]
      .addComponent(Text, {
        color: '#ffffff', //0xdaa056,
        fontSize: 0.05,
        anchor: 'left',
        textAlign: 'left',
        baseline: 'top',
        maxWidth: panelWidth * 0.8,
        lineHeight: 1.3,
        text: INFO_DATA[i].title + '\n \n' + INFO_DATA[i].description,
      })
      .addComponent(ParentObject3D, {value: panels[i]})
      .addComponent(Position, {x: -panelWidth / 2 * 0.82, y: panelHeight / 2 * 0.65 + offsety, z: 0.01})

      panelsEntity[i] = ctx.world.createEntity();
      panelsEntity[i]
        .addComponent(Object3D, {value: panels[i]})
        .addComponent(Billboard, {camera3D: ctx.camera})
        .addComponent(Children, {value: [panelTexts[i]]});

  }
}

export function enter(ctx) {}
export function execute(ctx, delta, time) {
  panels.forEach((panel, index) => {
    const config = nativeBehavior(panel, 'info');
    const signature = JSON.stringify(config);
    if (panel.userData.editorInfoSignature !== signature) {
      panel.userData.editorInfoSignature = signature;
      const text = panelTexts[index].getMutableComponent(Text);
      text.text = config ? config.title + '\n \n' + config.text : '';
      if (config) { text.fontSize = config.fontSize; text.color = config.color; }
    }
    const entity = panelsEntity[index];
    const billboard = nativeBehavior(panel, 'billboard');
    if (billboard && !entity.hasComponent(Billboard)) entity.addComponent(Billboard, {camera3D: ctx.camera});
    else if (!billboard && entity.hasComponent(Billboard)) {
      entity.removeComponent(Billboard); panel.material.opacity = 1;
      panelTexts[index].getMutableComponent(Text).opacity = 1;
    }
  });
}
