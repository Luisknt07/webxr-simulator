import * as THREE from 'three';

// Editor-authored actions use the same ray and controller events as the original demo.
export default class InteractionRuntime {
  constructor(ctx, document, library, notify) {
    this.ctx = ctx;
    this.document = document;
    this.library = library;
    this.notify = notify;
    this.states = [];
    this.audio = [];
    this.visibility = new Map();
    this.cards = [];
    this.generation = 0;
  }

  stop() {
    this.generation++;
    this.states.forEach(name => {
      this.ctx.raycontrol.deactivateState(name);
      delete this.ctx.raycontrol.states[name];
    });
    this.states = [];
    this.audio.forEach(audio => {
      if (audio.isPlaying) audio.stop();
      if (audio.parent) audio.parent.remove(audio);
    });
    this.audio = [];
    this.visibility.forEach((visible, object) => { object.visible = visible; });
    this.visibility.clear();
    this.cards.forEach(card => {
      if (card.parent) card.parent.remove(card);
      card.material.map.dispose();
      card.material.dispose();
    });
    this.cards = [];
  }

  start(roomId) {
    this.stop();
    this.document.getObjects(roomId).forEach(object => {
      const action = object.userData.editorInteraction;
      if (!action || !action.type || action.type === 'none') return;
      const name = 'editor-action-' + object.userData.editorId;
      let state;
      if (action.type === 'teleport') {
        state = {
          colliderMesh: object, controller: 'primary', vrOnly: true,
          onHover: (hit, active) => this.ctx.teleport.onHover(hit.point, active),
          onHoverLeave: () => this.ctx.teleport.onHoverLeave(),
          onSelectStart: (hit, controller) => this.ctx.teleport.onSelectStart(controller),
          onSelectEnd: hit => this.ctx.teleport.onSelectEnd(hit.point)
        };
      } else {
        state = { colliderMesh: object, controller: 'primary', onSelectStart: hit => this.run(action, object, hit) };
      }
      state.consumeSelect = true;
      state.mergeSelection = true;
      this.ctx.raycontrol.addState(name, state);
      this.ctx.raycontrol.activateState(name);
      this.states.push(name);
    });
  }

  run(action, object, hit) {
    if (this.ctx.editor && this.ctx.editor.active) return;
    if (action.type === 'room') {
      const destination = Number(action.room);
      if (Number.isInteger(destination) && destination >= 0 && destination < 10) this.ctx.goto = destination;
    } else if (action.type === 'toggle') {
      const target = this.document.getObject(action.targetId);
      if (target) {
        if (!this.visibility.has(target)) this.visibility.set(target, target.visible);
        target.visible = !target.visible;
      }
    } else if (action.type === 'sound' && action.asset) {
      const generation = this.generation;
      const audio = new THREE.PositionalAudio(this.ctx.audioListener);
      object.add(audio);
      this.audio.push(audio);
      new THREE.AudioLoader().load(this.library.getURL(action.asset), buffer => {
        if (generation !== this.generation) return;
        audio.setBuffer(buffer);
        audio.setRefDistance(3);
        audio.setVolume(0.7);
        audio.play();
      }, undefined, () => this.notify('No se pudo reproducir el audio.'));
    } else if (action.type === 'message') {
      this.showCard(String(action.text || 'Información'), hit.point);
    }
  }

  showCard(message, point) {
    this.cards.forEach(card => {
      if (card.parent) card.parent.remove(card);
      card.material.map.dispose(); card.material.dispose();
    });
    this.cards = [];
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    context.fillStyle = '#142031';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#60e5c0';
    context.fillRect(0, 0, 8, canvas.height);
    context.fillStyle = '#ffffff';
    context.font = '36px sans-serif';
    let line = '', y = 70;
    message.slice(0, 650).split(/\s+/).forEach(word => {
      const next = line + word + ' ';
      if (context.measureText(next).width > 920) {
        context.fillText(line, 48, y);
        line = word + ' ';
        y += 48;
      } else line = next;
    });
    if (y < 490) context.fillText(line, 48, y);
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    const card = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, depthTest: false}));
    card.scale.set(1.8, 0.9, 1);
    card.position.copy(point);
    card.position.y += 0.6;
    card.renderOrder = 50;
    this.ctx.scene.add(card);
    this.cards.push(card);
    this.notify(message);
  }
}
