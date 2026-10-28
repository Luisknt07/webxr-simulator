import * as THREE from 'three';

const NAMES = {steer: ['Dirección', 'Girar volante', '↶ ↷'], lift: ['Elevación', 'Subir / bajar', '↑ ↓'], tilt: ['Inclinación', 'Inclinar mástil', '↶ ↷'], reach: ['Alcance', 'Extender / retraer', '↔'], sideShift: ['Lateral', 'Desplazar horquillas', '↔'], turret: ['Torreta', 'Girar horquillas', '↶ ↷']};
const COLORS = {idle: '#d7e4eb', guide: '#55c9ff', hover: '#74efd0', held: '#ffd16b'};
const alias = value => value === 'steering' || value === 'wheel' ? 'steer' : value === 'sideshift' ? 'sideShift' : value;
const normalized = value => alias(value && typeof value === 'object' ? value.control || value.channel || value.id : value);

/** Console-sized identification, never a camera overlay. One static atlas is
 * owned by the current mount; no source material, tracking pose or rig joint is
 * replaced. Highlight rings exist only around real configured controls. */
export default class VehicleCabLabels {
  constructor(ctx = {}, options = {}) { this.ctx = ctx; this.dom = options.document || ctx.document || (typeof document !== 'undefined' ? document : null); this.entries = []; this.root = null; this.guidance = null; }
  mount(root, controls) { this.clear(); this.root = root; this.controls = controls; if (this.ctx.vrMode) this.build(); }
  setGuidance(value) { this.guidance = normalized(value); this.sync(); }
  pictogram(context, channel, x, y) {
    if (!context.beginPath || !context.moveTo || !context.lineTo || !context.stroke) {context.font = 'bold 29px sans-serif'; context.fillText(NAMES[channel][2], x, y + 8); return;}
    const line = points => {context.beginPath(); points.forEach((point, index) => context[index ? 'lineTo' : 'moveTo'](x + point[0], y + point[1])); context.stroke();};
    const arrow = (horizontal, start, end) => { const points = horizontal ? [[start, 0], [end, 0], [end - Math.sign(end - start) * 7, -7], [end, 0], [end - Math.sign(end - start) * 7, 7]] : [[0, start], [0, end], [-7, end - Math.sign(end - start) * 7], [0, end], [7, end - Math.sign(end - start) * 7]]; line(points); };
    context.strokeStyle = '#edf9ff'; context.lineWidth = 4; context.lineCap = 'round';
    if (channel === 'steer' && context.arc) {context.beginPath(); context.arc(x, y, 21, 0, Math.PI * 2); context.stroke(); line([[-18, -7], [0, 0], [18, -7]]); line([[0, 0], [0, 20]]);}
    else if (channel === 'lift') {line([[-19, -22], [-19, 19], [8, 19]]); arrow(false, 12, -19);}
    else if (channel === 'tilt') {line([[-16, 22], [-7, -22], [7, -19], [-2, 22]]); arrow(true, -9, 22);}
    else if (channel === 'turret' && context.arc) {context.beginPath(); context.arc(x, y, 21, -.9, Math.PI * 1.25); context.stroke(); line([[17, -16], [23, -12], [25, -23]]); line([[-10, 2], [-10, 19], [9, 19]]);}
    else {arrow(true, -23, 23); arrow(true, 23, -23); if (channel === 'reach') line([[-17, 12], [-17, 24], [18, 24]]); else {line([[-13, 12], [-13, 24]]); line([[13, 12], [13, 24]]);}}
  }
  build() {
    if (this.texture || !this.root || !this.controls || !this.controls.length || !this.dom || !this.dom.createElement) return;
    const canvas = this.dom.createElement('canvas'); canvas.width = 1024; canvas.height = 256; const context = canvas.getContext && canvas.getContext('2d'); if (!context || !context.fillRect || !context.fillText) return;
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true; texture.name = 'Mandos de cabina · atlas'; this.texture = texture;
    const rig = this.root.userData.vehicleRig, geometries = this.geometries = new Set();
    const leverRing = new THREE.TorusBufferGeometry(.032, .003, 4, 16), wheelRing = new THREE.TorusBufferGeometry(1, .019, 4, 40); geometries.add(leverRing); geometries.add(wheelRing);
    this.controls.slice(0, 6).forEach((control, index) => {
      const name = NAMES[control.channel]; if (!name) return; const column = index % 4, row = Math.floor(index / 4), x = column * 256, y = row * 128;
      context.fillStyle = '#14232d'; context.fillRect(x, y, 256, 128); context.fillStyle = '#eaf7ff'; context.fillRect(x, y, 5, 128);
      this.pictogram(context, control.channel, x + 35, y + 49); context.fillStyle = '#f0faff'; context.font = 'bold 25px sans-serif'; context.fillText(name[0], x + 69, y + 43);
      context.font = '16px sans-serif'; context.fillText(name[1], x + 69, y + 70); context.font = 'bold 17px sans-serif'; context.fillStyle = '#a9c2cf'; context.fillText('Mantén AGARRE', x + 17, y + 108);
      const geometry = new THREE.PlaneBufferGeometry(control.kind === 'wheel' ? .18 : .15, .065), uv = geometry.attributes.uv;
      for (let vertex = 0; vertex < uv.count; vertex++) uv.setXY(vertex, (column + uv.getX(vertex)) / 4, 1 - (row + 1 - uv.getY(vertex)) / 2); geometries.add(geometry);
      const material = new THREE.MeshBasicMaterial({map: texture, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, toneMapped: false});
      const plate = new THREE.Mesh(geometry, material); plate.name = 'Mando · ' + name[0]; plate.userData.editorRuntimeHelper = true; plate.userData.vehicleCabLabel = control.channel; plate.raycast = () => {}; plate.rotation.set(-Math.PI / 2, 0, Math.PI);
      if (control.kind === 'wheel' && rig.dashboard) {rig.dashboard.add(plate); plate.position.set(0, .108, .008);}
      else if (rig.leverConsole && control.kind === 'lever') {rig.leverConsole.add(plate); plate.position.set(-.082, .088, control.object.position.z - rig.leverConsole.position.z);}
      else {control.object.parent.add(plate); plate.position.copy(control.object.position).add(new THREE.Vector3(control.kind === 'lever' ? -.09 : 0, .025, -.08));}
      const ringMaterial = new THREE.MeshBasicMaterial({color: COLORS.guide, transparent: true, opacity: .85, depthWrite: false, toneMapped: false});
      const ring = new THREE.Mesh(control.kind === 'wheel' && !control.descriptor.gripOnly ? wheelRing : leverRing, ringMaterial); ring.name = 'Guía de mando · ' + name[0]; ring.userData.editorRuntimeHelper = true; ring.raycast = () => {};
      if (control.kind === 'wheel' && !control.descriptor.gripOnly) {control.object.add(ring); ring.scale.setScalar((control.descriptor.radius || .17) * 1.03);}
      else {const anchor = control.descriptor.grip || control.object; anchor.add(ring); ring.rotation.x = Math.PI / 2;}
      ring.visible = false; this.entries.push({control, channel: control.channel, name: name[0], plate, ring, material, ringMaterial, state: null});
    });
    texture.needsUpdate = true;
  }
  sync(active = true, hands) {
    const shown = !!(active && this.root && this.ctx.vrMode); if (shown && !this.texture) this.build();
    this.entries.forEach(entry => {
      entry.plate.visible = shown;
      const hovered = hands && Array.from(hands.values()).some(hand => hand.hover === entry.control), state = entry.control.owner ? 'held' : hovered ? 'hover' : this.guidance === entry.channel ? 'guide' : 'idle';
      entry.ring.visible = shown && state !== 'idle';
      if (entry.state !== state) {entry.state = state; entry.material.color.set(COLORS[state]); entry.ringMaterial.color.set(COLORS[state]);}
    });
  }
  getStats() {return {cabLabelCount: this.entries.length, cabLabelAtlases: this.texture ? 1 : 0, cabLabelAtlasBytes: this.texture ? 1024 * 256 * 4 : 0, cabLabelMeshes: this.entries.length * 2};}
  clear() {
    this.entries.forEach(entry => {if (entry.plate.parent) entry.plate.parent.remove(entry.plate); if (entry.ring.parent) entry.ring.parent.remove(entry.ring); entry.material.dispose(); entry.ringMaterial.dispose();});
    if (this.geometries) this.geometries.forEach(geometry => geometry.dispose()); if (this.texture) this.texture.dispose();
    this.entries = []; this.texture = null; this.geometries = null; this.root = null; this.controls = null; this.guidance = null;
  }
  dispose() {this.clear();}
}
