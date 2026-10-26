import * as THREE from 'three';

function signature(mission) { let result = 2166136261; const text = JSON.stringify(mission); for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619); return (result >>> 0) || 1; }
export function advanceMission(mission, progress, event) {
  const next = Object.assign({step: 0, count: 0, status: mission.start === 'manual' ? 'ready' : 'active'}, progress);
  if (next.status !== 'active' || next.step >= mission.steps.length) return next;
  const step = mission.steps[next.step];
  if (step.objectId && step.objectId !== event.objectId) return next;
  if (step.failEvent && step.failEvent === event.type) { next.status = 'failed'; return next; }
  if (step.event !== event.type) return next;
  next.count++;
  if (next.count >= step.target) { next.step++; next.count = 0; if (next.step >= mission.steps.length) next.status = 'completed'; }
  return next;
}

/** The world representation uses the same ray states for mouse and both XR controllers. */
export default class EducationRuntime {
  constructor(editor, client) {
    this.editor = editor; this.client = client; this.progress = new Map(); this.widgets = []; this.seenEvents = new Set(); this.pending = new Set(); this.incompatible = new Set();
    const previous = editor.simulation.onEvent;
    editor.simulation.onEvent = event => { if (previous) previous(event); this.event(event); };
    this.desktop = document.createElement('section'); this.desktop.className = 'studio-widgets'; this.desktop.setAttribute('aria-label', 'Indicadores del escenario'); document.body.appendChild(this.desktop);
    this.progressStatus = 'El progreso del invitado se conserva durante esta visita.';
    this.accountGeneration = 0;
  }
  accountChanged() { const id = this.client.user && this.client.user.id || 'guest'; if (id === this.accountId) return; this.accountId = id; this.accountGeneration++; clearTimeout(this.saveTimer); this.progress.clear(); this.pending.clear(); this.seenEvents.clear(); this.incompatible.clear(); this.progressStatus = id === 'guest' ? 'El progreso del invitado se conserva durante esta visita.' : 'Cargando progreso de tu cuenta…'; }
  missions() { return (this.editor.document.studio && this.editor.document.studio.missions || []).filter(mission => mission.roomId === this.editor.roomId && mission.steps.length); }
  allMissions() { return (this.editor.document.studio && this.editor.document.studio.missions || []).filter(mission => mission.steps.length); }
  getProgress(mission) { const key = this.key(mission); if (!this.progress.has(key)) this.progress.set(key, {step: 0, count: 0, status: mission.start === 'manual' ? 'ready' : 'active'}); return this.progress.get(key); }
  key(mission) { return (this.client.user && this.client.user.id || 'guest') + ':' + (this.editor.currentProject && this.editor.currentProject.id || 'draft') + ':' + mission.id + ':' + signature(mission); }
  canPersist() { const project = this.editor.currentProject; return Boolean(this.client.user && project && project.id && !/^(public-|library-)/.test(project.id)); }
  async restoreProgress() {
    if (!this.canPersist()) return;
    const generation = this.accountGeneration, projectId = this.editor.currentProject.id, result = await this.client.getProgress(projectId);
    if (generation !== this.accountGeneration || !this.editor.currentProject || projectId !== this.editor.currentProject.id) return;
    const rows = Array.isArray(result) ? result : Object.values(result || {});
    this.incompatible.clear();
    rows.forEach(row => {
      const definition = this.allMissions().find(item => item.id === row.missionId);
      if (definition && signature(definition) !== row.missionVersion) this.incompatible.add(definition.id);
      const mission = definition && signature(definition) === row.missionVersion ? definition : null, value = row.value;
      if (!mission || !value || !Number.isInteger(value.step) || value.step < 0 || value.step > mission.steps.length ||
        !Number.isInteger(value.count) || value.count < 0 || !['ready', 'active', 'failed', 'completed'].includes(value.status) ||
        (value.status === 'completed') !== (value.step === mission.steps.length) || value.step < mission.steps.length && value.count >= mission.steps[value.step].target) return;
      this.progress.set(this.key(mission), {step: value.step, count: value.count, status: value.status});
    });
    this.progressStatus = 'Progreso recuperado de tu cuenta.';
  }
  event(event) {
    if (this.editor.active || this.seenEvents.has(event.id)) return;
    this.seenEvents.add(event.id); if (this.seenEvents.size > 2048) this.seenEvents.delete(this.seenEvents.values().next().value);
    this.missions().forEach(mission => {
      const old = this.getProgress(mission), next = advanceMission(mission, old, event);
      if (JSON.stringify(old) === JSON.stringify(next)) return;
      this.progress.set(this.key(mission), next); if (this.canPersist()) this.pending.add(mission.id);
      if (next.status === 'completed') this.editor.toast('Objetivo completado: ' + mission.name);
      clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveProgress(), 750);
    });
  }
  async saveProgress() {
    if (!this.canPersist()) return;
    if (this.saving) { this.saveAgain = true; return this.saving; }
    this.saving = this.persistProgress();
    try { return await this.saving; }
    finally { this.saving = null; if (this.saveAgain) { this.saveAgain = false; clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveProgress(), 100); } }
  }
  async persistProgress() {
    const generation = this.accountGeneration, userId = this.client.user.id, projectId = this.editor.currentProject.id;
    this.progressStatus = 'Guardando progreso…';
    let writing = null;
    const currentMissions = new Set(this.allMissions().map(mission => mission.id)); this.pending.forEach(id => { if (!currentMissions.has(id)) this.pending.delete(id); });
    try {
      for (const mission of this.allMissions()) {
        if (generation !== this.accountGeneration || !this.client.user || this.client.user.id !== userId || !this.editor.currentProject || this.editor.currentProject.id !== projectId) return;
        if (!this.pending.has(mission.id)) continue;
        writing = mission.id;
        const value = Object.assign({}, this.getProgress(mission));
        await this.client.saveProgress(projectId, mission.id, signature(mission), value);
        if (generation !== this.accountGeneration || !this.client.user || this.client.user.id !== userId) return;
        if (JSON.stringify(value) === JSON.stringify(this.getProgress(mission))) this.pending.delete(mission.id);
      }
      this.progressStatus = this.pending.size ? 'Cambios de progreso pendientes.' : 'Progreso guardado en tu cuenta.';
    } catch (error) { if (generation === this.accountGeneration) { if (error.code === 'progress_incompatible' && writing) this.incompatible.add(writing); this.progressStatus = 'Error al guardar: ' + error.message + ' · Puedes reintentar desde Progreso.'; } }
  }
  async resetMissionVersion(mission) {
    if (!this.canPersist()) throw new Error('Inicia sesión y guarda una variante propia para reiniciar este progreso.');
    const generation = this.accountGeneration, projectId = this.editor.currentProject.id;
    const value = {step: 0, count: 0, status: mission.start === 'manual' ? 'ready' : 'active'};
    await this.client.saveProgress(projectId, mission.id, signature(mission), value, true);
    if (generation !== this.accountGeneration || !this.editor.currentProject || this.editor.currentProject.id !== projectId) return;
    this.progress.set(this.key(mission), value); this.pending.delete(mission.id); this.incompatible.delete(mission.id); this.progressStatus = 'Progreso reiniciado para la versión actual.';
  }
  startMission(mission) { this.progress.set(this.key(mission), {step: 0, count: 0, status: 'active'}); this.pending.add(mission.id); this.saveProgress(); }
  disposeWidgets() {
    this.widgets.forEach(widget => {
      if (widget.mesh.parent) widget.mesh.parent.remove(widget.mesh);
      widget.mesh.geometry.dispose(); widget.texture.dispose(); widget.mesh.material.dispose();
      if (widget.state && this.editor.ctx.raycontrol.states[widget.stateName] === widget.state) { this.editor.ctx.raycontrol.deactivateState(widget.stateName); delete this.editor.ctx.raycontrol.states[widget.stateName]; }
    }); this.widgets = []; this.desktop.textContent = '';
  }
  syncWidgets() {
    const source = (this.editor.document.studio && this.editor.document.studio.widgets || []).filter(widget => widget.roomId === this.editor.roomId && widget.visible);
    const key = this.editor.roomId + ':' + JSON.stringify(source);
    if (this.widgetKey === key) return; this.widgetKey = key; this.disposeWidgets();
    source.forEach(config => {
      const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 320;
      const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding; texture.minFilter = THREE.LinearFilter;
      const mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.9, 0.375), new THREE.MeshBasicMaterial({map: texture, transparent: false, side: THREE.DoubleSide}));
      mesh.userData.editorRuntimeHelper = true; mesh.name = 'Widget · ' + config.name; mesh.position.fromArray(config.position); this.editor.root.add(mesh);
      const html = document.createElement(config.kind === 'button' ? 'button' : 'output'); this.desktop.appendChild(html);
      const item = {config, canvas, texture, mesh, html, last: null};
      const execute = () => { if (this.editor.active) return; try { if (!config.objectId) throw new Error('Este botón necesita un equipo vinculado.'); this.editor.simulation.command(config.objectId, config.action, 0.1); } catch (error) { this.editor.toast(error.message); } };
      html.addEventListener('click', execute);
      if (config.kind === 'button') {
        const stateName = 'studio-widget-' + config.id;
        const state = {colliderMesh: mesh, controller: 'both', consumeSelect: true, mergeSelection: true, captureSelect: true,
          isSelectable: (hit, controller) => !this.editor.active && this.editor.simulation.validInteraction(mesh, hit, controller, true),
          onSelectStart: (hit, controller) => { if (!this.editor.simulation.validInteraction(mesh, hit, controller, true)) return; mesh.scale.setScalar(0.97); execute(); }, onSelectEnd: () => mesh.scale.setScalar(1), onSelectCancel: () => mesh.scale.setScalar(1)};
        this.editor.ctx.raycontrol.addState(stateName, state); this.editor.ctx.raycontrol.activateState(stateName); Object.assign(item, {stateName, state});
      }
      this.widgets.push(item);
    });
  }
  tick() {
    this.syncWidgets(); const editor = this.editor;
    this.desktop.hidden = editor.active || editor.ctx.vrMode;
    const time = performance.now(); if (time - (this.lastTick || 0) < 100) return; this.lastTick = time;
    this.widgets.forEach(item => {
      const {config, mesh, html} = item;
      mesh.visible = config.presentation !== 'desktop'; html.hidden = config.presentation === 'world';
      const record = editor.simulation.records.get(config.objectId), value = record ? record.variables[config.variable] : undefined;
      const valueText = value === undefined ? config.objectId ? 'Variable no disponible' : config.kind === 'text' || config.kind === 'button' ? '' : 'Sin vínculo' : typeof value === 'number' ? Number(value.toFixed(2)).toLocaleString() : typeof value === 'boolean' ? value ? 'Activo' : 'Inactivo' : String(value);
      const key = valueText + editor.active; if (item.last === key) return; item.last = key;
      html.textContent = config.text + (valueText ? ': ' + valueText : '');
      const context = item.canvas.getContext('2d'); context.fillStyle = '#111e29'; context.fillRect(0, 0, 768, 320); context.fillStyle = config.color; context.fillRect(0, 0, 8, 320);
      context.font = 'bold 30px sans-serif'; context.fillStyle = '#c6d3df'; context.fillText(config.text.slice(0, 39), 32, 58);
      context.font = 'bold 65px sans-serif'; context.fillStyle = config.color; context.fillText((config.kind === 'button' ? config.text : valueText).slice(0, 22), 32, 164);
      if (config.kind === 'progress') { context.fillStyle = '#2d3d49'; context.fillRect(32, 220, 704, 30); context.fillStyle = config.color; context.fillRect(32, 220, Math.min(1, Math.max(0, Number(value) / config.maximum || 0)) * 704, 30); }
      context.font = '22px sans-serif'; context.fillStyle = '#9eafbd'; context.fillText(config.kind === 'button' ? 'Seleccionar para activar' : config.objectId ? config.variable : 'Información', 32, 290); item.texture.needsUpdate = true;
    });
  }
}
