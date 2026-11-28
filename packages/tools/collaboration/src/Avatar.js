import * as THREE from 'three';
import {createAvatarRig} from './AvatarRig.js';

export const DEFAULT_AVATAR = {version: 1, base: 'identity', bodyColor: '#5cead5', accentColor: '#26364b', skinColor: '#d4a77e',bodyMode:'upper'};
export function createAvatar(config = DEFAULT_AVATAR) {
  const rig=createAvatarRig(config),group=rig.root;
  rig.update({quaternion:new THREE.Quaternion(),hands:{},mode:'desktop'});
  group.userData.editorRuntimeHelper=true;group.userData.rig=rig;group.userData.ready=rig.ready;group.userData.dispose=()=>rig.dispose();return group;
}
export function avatarBadge(config = DEFAULT_AVATAR) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
  [['circle', {cx: 32, cy: 32, r: 31, fill: config.accentColor}], ['circle', {cx: 32, cy: 23, r: 12, fill: config.skinColor}], ['path', {d: 'M12 56V49Q12 36 32 36Q52 36 52 49V56Z', fill: config.bodyColor}]].forEach(([tag, attributes]) => { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attributes).forEach(key => element.setAttribute(key, attributes[key])); svg.appendChild(element); }); return svg;
}
