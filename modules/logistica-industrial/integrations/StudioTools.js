import * as THREE from 'three';
import schema from '../contracts/behaviors.js';
import {buildIndustrialLab} from '../scenarios/IndustrialLab.js';
import {buildIndustrialCediLevel} from '../scenarios/IndustrialCediLevel.js';
import {buildStudyScene, studySceneReport} from '../scenarios/IndustrialStudyScenes.js';
import {retrofitCediRobotics} from '../scenarios/IndustrialCediRobotics.js';
import {compileStudyProject, compileBlankProject} from '../scenarios/StudySceneProject.js';
import {STUDY_SCENES, studyScene} from '../scenarios/StudySceneCatalog.js';
import {applyIndustrialAging} from '../functions/presentacion/runtime/IndustrialAgingPresentation.js';
import {addWarehouseMissionExperience} from '../scenarios/WarehouseMissionEnhancement.js';

const uid = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
const clone = value => JSON.parse(JSON.stringify(value));
function node(tag, text, parent) { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (parent) parent.appendChild(result); return result; }
function button(parent, text, action) { const result = node('button', text, parent); result.type = 'button'; result.addEventListener('click', action); return result; }
function field(parent, label, value, type = 'text') { const line = node('label', label, parent), input = node('input', undefined, line); input.type = type; input.value = value; return input; }
function select(parent, label, options, value) { const line = node('label', label, parent), input = node('select', undefined, line); options.forEach(option => { const item = node('option', option.label || option, input); item.value = option.value === undefined ? option : option.value; }); if (value !== undefined) input.value = value; return input; }

/** Authoring tools keep logical grouping separate from native simulation pivots. */
export default class StudioTools {
  constructor(editor) {
    this.editor = editor;
    this.selection = new Set();
    editor.studioTools = this;
    const originalSelect = editor.select.bind(editor);
    editor.select = object => {
      if (!this.extendingSelection) this.selection.clear();
      if (object) this.selection.add(object);
      originalSelect(object);
    };
    editor.ctx.renderer.domElement.addEventListener('pointerdown', event => {
      if (!event.shiftKey || !editor.active || event.button !== 0) return;
      const rect = editor.ctx.renderer.domElement.getBoundingClientRect();
      const camera = editor.camera, ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(editor.root.children, true).find(hit => editor.document.getEditableObject(hit.object));
      if (!hit) return;
      const object = this.topObject(editor.document.getEditableObject(hit.object));
      event.stopImmediatePropagation(); event.preventDefault();
      if (this.selection.has(object)) this.selection.delete(object); else this.selection.add(object);
      this.extendingSelection = true; editor.select(this.selection.has(object) ? object : Array.from(this.selection).pop() || null); this.extendingSelection = false;
      editor.toast(this.selection.size + ' objetos seleccionados · Shift + clic añade o quita.');
    }, true);
    editor.transform.addEventListener('dragging-changed', event => {
      if (!event.value) { this.groupTransform = null; return; }
      const anchor = editor.selected; if (!anchor) return;
      // Resizing one linked machine changes its own dimensions. Its neighbours
      // are fitted by the assembly solver; implicit groups must not scale them
      // and their products a second time. Explicit multiselection stays a group.
      if (editor.toolMode === 'scale' && this.selection.size <= 1 && editor.assembly && editor.assembly.supported(anchor)) {
        this.groupTransform = null; return;
      }
      // The physical assembly tool already owns a whole-line move or an
      // explicit Ctrl detach. Applying an implicit Studio group afterwards
      // would move unrelated modules and undo the user's detach choice.
      if (editor.toolMode === 'translate' && this.selection.size <= 1 && editor.assembly &&
          editor.dragAssembly === editor.assembly && editor.assembly.drag) {
        this.groupTransform = null; return;
      }
      const group = (editor.document.studio && editor.document.studio.groups || []).find(group => group.members.includes(anchor.userData.editorId));
      const members = this.selection.size > 1 ? this.objects() : group ? group.members.map(id => editor.document.getObject(id)).filter(Boolean) : [];
      anchor.updateWorldMatrix(true, false);
      this.groupTransform = {anchor, inverse: new THREE.Matrix4().getInverse(anchor.matrixWorld), members: members.filter(object => object !== anchor).map(object => { object.updateWorldMatrix(true, false); return {object, matrix: object.matrixWorld.clone()}; })};
    });
    editor.transform.addEventListener('objectChange', () => {
      const group = this.groupTransform; if (!group || !editor.transform.dragging) return;
      group.anchor.updateWorldMatrix(true, false);
      const delta = new THREE.Matrix4().multiplyMatrices(group.anchor.matrixWorld, group.inverse);
      group.members.forEach(({object, matrix}) => {
        const local = new THREE.Matrix4().multiplyMatrices(delta, matrix);
        if (object.parent) { object.parent.updateWorldMatrix(true, false); local.premultiply(new THREE.Matrix4().getInverse(object.parent.matrixWorld)); }
        local.decompose(object.position, object.quaternion, object.scale); object.updateMatrixWorld(true);
      });
    });
  }
  topObject(object) { while (object.parent && object.parent !== this.editor.root && object.parent.userData.editorId) object = object.parent; return object; }
  selectObject(object, event) { object = this.topObject(object); if (!event.shiftKey) return this.editor.select(object); if (this.selection.has(object)) this.selection.delete(object); else this.selection.add(object); this.extendingSelection = true; this.editor.select(this.selection.has(object) ? object : Array.from(this.selection).pop() || null); this.extendingSelection = false; }
  objects() { const editor = this.editor; return Array.from(this.selection.size ? this.selection : editor.selected ? [editor.selected] : []).map(object => this.topObject(object)).filter((object, i, all) => all.indexOf(object) === i && editor.document.getObject(object.userData.editorId) === object); }
  guard(action) { return Promise.resolve().then(action).catch(error => this.editor.toast(error.message)); }
  nameScene(id) { const scene = schema.studio.sceneEntries(this.editor.document).find(scene => scene.id === id); return scene ? scene.name : id; }
  selectAll() { const objects = this.editor.document.getObjects(this.editor.roomId).filter(object => object.parent === this.editor.root && object.visible); this.selection = new Set(objects); this.extendingSelection = true; this.editor.select(objects[0] || null); this.extendingSelection = false; this.editor.toast(objects.length + ' objetos seleccionados.'); }
  groupSelection() {
    const objects = this.objects(); if (objects.length < 2) throw new Error('Selecciona al menos dos objetos con Shift + clic.');
    const name = window.prompt('Nombre del grupo', 'Grupo de equipos'); if (!name) return;
    const document = this.editor.document, groups = document.studio && document.studio.groups || [];
    const members = objects.map(object => object.userData.editorId);
    document.setStudio({groups: groups.map(group => Object.assign({}, group, {members: group.members.filter(id => !members.includes(id))})).filter(group => group.members.length).concat({id: uid('group'), name, roomId: this.editor.roomId, members})});
    this.editor.toast('Grupo creado. Transformar uno de sus miembros mueve el conjunto.');
  }
  ungroupSelection() { const document = this.editor.document, ids = this.objects().map(object => object.userData.editorId); document.setStudio({groups: (document.studio && document.studio.groups || []).filter(group => !group.members.some(id => ids.includes(id)))}); }
  linkedStudio(snapshots, wholeScene = false) {
    const studio = this.editor.document.studio || {}, roomId = this.editor.roomId;
    const ids = new Set(snapshots.flatMap(snapshot => snapshot.sources.map(([, id]) => id)));
    return {version: 1,
      widgets: clone((studio.widgets || []).filter(item => item.roomId === roomId && (wholeScene || ids.has(item.objectId)))),
      missions: clone((studio.missions || []).filter(item => item.roomId === roomId && (wholeScene || item.steps.some(step => ids.has(step.objectId)) && item.steps.every(step => !step.objectId || ids.has(step.objectId))))),
      spawns: clone((studio.spawns || []).filter(item => item.roomId === roomId && ids.has(item.objectId))),
      groups: clone((studio.groups || []).filter(item => item.roomId === roomId).map(item => Object.assign({}, item, {members: item.members.filter(id => ids.has(id))})).filter(item => item.members.length > 1))
    };
  }
  async saveTemplate() {
    const objects = this.objects(); if (!objects.length) throw new Error('Selecciona los objetos de la plantilla.');
    const name = window.prompt('Nombre de plantilla', objects.length > 1 ? 'Conjunto de equipos' : objects[0].name); if (!name) return;
    const document = this.editor.document, template = {id: uid('template'), name, version: 1, objects: objects.map(object => document.captureObject(object))};
    template.linkedStudio = this.linkedStudio(template.objects);
    document.setStudio({templates: (document.studio && document.studio.templates || []).concat(template)}); this.editor.renderAssets(); return template;
  }
  async placeTemplate(template, options = {}) {
    const editor = this.editor, document = editor.document, copies = [], references = new Map();
    if (editor.loadingProject || editor.pastingObject || document.loading || document.transaction) throw new Error('Termina la operación actual antes de insertar la plantilla.');
    if (!template || !Array.isArray(template.objects) || !template.objects.length || template.objects.length > 100) throw new Error('La plantilla no contiene un conjunto compatible.');
    const roomId = editor.roomId, generation = editor.projectGeneration;
    const transformEnabled = editor.transform.enabled, previousInert = editor.ui && editor.ui.inert;
    editor.pastingObject = true; editor.transform.enabled = false; if (editor.ui) editor.ui.inert = true;
    let failure;
    try { await editor.perform(async () => {
      const before = document.capture(), historyLength = document.undoStack.length;
      try {
        for (const snapshot of template.objects) {
          const object = await document.pasteObject(snapshot, roomId, 0, () => {
            if (editor.projectGeneration !== generation || editor.roomId !== roomId) throw new Error('El proyecto o escenario cambió durante la inserción.');
          }, {deferExternalReferences: true});
          copies.push(object); const entry = document.additions.get(object.userData.editorId);
          snapshot.sources.forEach(([path, original]) => { const child = path ? entry.nodes.get(path) : object; if (child) references.set(original, child.userData.editorId); });
        }
        document.begin();
        const copiedIds = new Set(references.values());
        copies.forEach((object, index) => {
          const crossRoom = String(template.objects[index].roomId) !== roomId;
          const internal = id => references.has(id) || copiedIds.has(id);
          const remap = id => references.has(id) ? references.get(id) : id;
          const addition=document.additions.get(object.userData.editorId);
          if(addition&&addition.descriptor.type==='cad'&&addition.descriptor.attachment){
            const descriptor=clone(addition.descriptor),attachment=descriptor.attachment;
            if(references.has(attachment.targetId))attachment.targetId=remap(attachment.targetId);
            else if(crossRoom&&!copiedIds.has(attachment.targetId)){
              delete descriptor.attachment;
              const transform=template.objects[index].cadTransform;if(transform)document.setTransform(object,transform);
            }
            document.updateCAD(object,descriptor);
          }
          object.traverse(child => {
            if (!child.userData.editorId) return;
            const behaviors = document.getBehaviors(child).map(behavior => {
              ['sourceId', 'targetId', 'outputId', 'branchId'].forEach(key => { if (references.has(behavior[key])) behavior[key] = remap(behavior[key]); else if (crossRoom && behavior[key] && !internal(behavior[key])) behavior[key] = ''; });
              if (behavior.type === 'robot' && behavior.destinationRulesJson) { const rules = JSON.parse(behavior.destinationRulesJson).filter(rule => !crossRoom || internal(rule.outputId)); rules.forEach(rule => { rule.outputId = remap(rule.outputId); }); behavior.destinationRulesJson = JSON.stringify(rules); }
              if (behavior.type === 'automation') { const rules = JSON.parse(behavior.rules).filter(rule => !crossRoom || internal(rule.sourceId) && internal(rule.targetId)); rules.forEach(rule => ['sourceId', 'targetId'].forEach(key => { rule[key] = remap(rule[key]); })); behavior.rules = JSON.stringify(rules); }
              return behavior;
            });
            document.setBehaviors(child, behaviors);
            const interaction = child.userData.editorInteraction;
            if (interaction && interaction.targetId) document.setInteraction(child, internal(interaction.targetId) ? Object.assign({}, interaction, {targetId: remap(interaction.targetId)}) : crossRoom ? {type: 'none'} : interaction);
          });
        });
        const delta = new THREE.Vector3();
        if (copies.length && !options.preservePosition) {
          delta.copy(editor.orbit.target).sub(copies[0].position); delta.y = 0;
          copies.forEach(object => {const entry=document.additions.get(object.userData.editorId),attachment=entry&&entry.descriptor.type==='cad'&&entry.descriptor.attachment;if(!attachment||!copiedIds.has(attachment.targetId))object.position.add(delta);});
        }
        if (template.linkedStudio) {
          const linked = schema.studio.normalize(template.linkedStudio), patch = {};
          const remap = id => references.has(id) ? references.get(id) : id;
          if (linked.widgets) patch.widgets = (document.studio && document.studio.widgets || []).concat(linked.widgets.map(widget => Object.assign({}, widget, {
            id: uid('widget'), roomId, objectId: remap(widget.objectId), position: widget.position.map((n, i) => n + delta.getComponent(i))
          })));
          if (linked.missions) patch.missions = (document.studio && document.studio.missions || []).concat(linked.missions.map(mission => Object.assign({}, mission, {
            id: uid('mission'), roomId, steps: mission.steps.map(step => Object.assign({}, step, {objectId: remap(step.objectId)}))
          })));
          if (linked.spawns) patch.spawns = (document.studio && document.studio.spawns || []).concat(linked.spawns.filter(spawn => references.has(spawn.objectId)).map(spawn => ({objectId: remap(spawn.objectId), roomId})));
          if (linked.groups) patch.groups = (document.studio && document.studio.groups || []).concat(linked.groups.map(group => Object.assign({}, group, {
            id: uid('group'), roomId, members: group.members.filter(id => references.has(id)).map(remap)
          })).filter(group => group.members.length > 1));
          document.setStudio(patch);
        }
        if(document.syncCADAttachments)document.syncCADAttachments();document.commit();
        // One undo restores the whole template, including any failed partial paste.
        document.undoStack.splice(historyLength);
        document.undoStack.push(before);
      } catch (error) { document.transaction = null; document._restore(before); document.undoStack.splice(historyLength); failure = error; throw error; }
    });
    if (failure) throw failure;
    } finally { editor.pastingObject = false; editor.transform.enabled = transformEnabled; if (editor.ui) editor.ui.inert = previousInert; }
    this.selection = new Set(copies); this.extendingSelection = true; editor.select(copies[0] || null); this.extendingSelection = false;
    return copies;
  }
  async renameScene() {
    const editor = this.editor, roomId = editor.roomId, generation = editor.projectGeneration;
    const name = editor.shell && editor.shell.requestSceneName ? await editor.shell.requestSceneName({title: 'Renombrar nivel', value: this.nameScene(roomId), confirmLabel: 'Renombrar'}) : window.prompt('Nombre del escenario', this.nameScene(roomId));
    if (!name || !name.trim()) return;
    if (editor.projectGeneration !== generation || editor.roomId !== roomId || !editor.active) throw new Error('El escenario cambió. Vuelve a seleccionar el nivel que quieres renombrar.');
    const scenes = (editor.document.studio && editor.document.studio.scenes || []).filter(scene => scene.id !== roomId).concat({id: roomId, name: name.trim()});
    editor.document.setStudio({scenes}); this.refreshLabels();
  }
  setStartScene() { this.editor.document.setStudio({startRoomId: this.editor.roomId}); this.editor.toast('Escenario inicial guardado en la configuración del proyecto.'); }
  refreshLabels() {
    const editor = this.editor, entries = editor.getSceneEntries ? editor.getSceneEntries() : schema.studio.sceneEntries(editor.document);
    if (editor.roomSelect.appendChild) {
      editor.roomSelect.textContent = '';
      entries.forEach(entry => { const option = node('option', entry.name + (entry.initial ? ' · inicial' : ''), editor.roomSelect); option.value = String(entry.index); });
      editor.roomSelect.value = String(schema.studio.ROOM_IDS.indexOf(editor.roomId));
    }
    Array.from(editor.roomSelect.options || []).forEach(option => {
      const entry = entries.find(item => item.index === Number(option.value));
      if (entry) option.textContent = entry.name + (entry.initial ? ' · inicial' : '');
    });
    if (editor.shell) editor.shell.refresh();
    if (editor.renderAssets) editor.renderAssets();
  }
  // Called inside the caller's transaction so the complete starting scene is
  // persisted and undone together, including its runtime environment.
  createSceneBase(roomId) {
    const document = this.editor.document, studio = document.studio || {};
    const ground = document.addPrimitive(roomId, 'plane', '#87939a');
    document.setProperty(ground, 'name', 'Suelo del nivel');
    document.setTransform(ground, {position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [30, 30, 1]});
    document.setBehaviors(ground, [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport')]);
    const spawn = document.addPrimitive(roomId, 'cylinder', '#51ebd2');
    document.setProperty(spawn, 'name', 'Inicio del nivel');
    document.setTransform(spawn, {position: [0, 0.02, 5], scale: [0.45, 0.03, 0.45]});
    document.setBehaviors(spawn, [Object.assign(schema.defaultBehavior('collision'), {enabled: false})]);
    const camera = document.addPrimitive(roomId, 'box', '#67dbe8');
    document.setProperty(camera, 'name', 'Cámara principal');
    document.setTransform(camera, {position: [0, 1.6, 5], scale: [0.2, 0.14, 0.28]});
    document.setBehaviors(camera, [Object.assign(schema.defaultBehavior('collision'), {enabled: false})]);
    document.setStudio({
      environments: (studio.environments || []).filter(item => item.roomId !== roomId).concat(schema.studio.defaultEnvironment(roomId)),
      spawns: (studio.spawns || []).filter(item => item.roomId !== roomId).concat({objectId: spawn.userData.editorId, roomId}),
      entities: (studio.entities || []).filter(item => item.roomId !== roomId).concat({id: uid('entity'), objectId: camera.userData.editorId, roomId, type: 'camera', fov: 55})
    });
    return ground;
  }
  async newScene(options = {}) {
    const editor = this.editor, document = editor.document;
    if (!editor.active) throw new Error('Abre el editor para crear un nivel.');
    if (editor.creatingScene) throw new Error('Termina de crear el nivel actual antes de crear otro.');
    if (editor.loadingProject || editor.busy || editor.importingFiles || editor.pastingObject || document.transaction || editor.transform && editor.transform.dragging) throw new Error('Termina la operación actual antes de crear un nivel.');
    if (editor.ctx.studio && editor.ctx.studio.room) throw new Error('Sal de la sala compartida antes de crear un nivel.');
    editor.creatingScene = true;
    const generation = editor.projectGeneration, previousRoom = editor.roomId;
    try {
    let creation = null;
    if (options.name === undefined && options.defaults !== false && editor.sceneCreationDialog) {
      creation = await editor.sceneCreationDialog.request();
      if (!creation) return;
      if (!editor.active || editor.projectGeneration !== generation || editor.roomId !== previousRoom) throw new Error('El proyecto cambió. Vuelve a crear el escenario desde el proyecto actual.');
      if (creation.kind === 'template') {
        editor.creatingScene = false;
        if (creation.templateId.startsWith('included:')) return await this.createStudyVariant(creation.templateId.slice(9), {name: creation.name});
        const template = (document.studio && document.studio.templates || []).find(item => 'saved:' + item.id === creation.templateId);
        if (!template) throw new Error('La plantilla guardada ya no está disponible.');
        return await this.createTemplateScene(template, {name: creation.name});
      }
      options = Object.assign({}, options, {name: creation.name});
    }
    const scenes = clone(document.studio && document.studio.scenes || []);
    if (!scenes.some(scene => scene.id === editor.roomId)) scenes.push({id: editor.roomId, name: this.nameScene(editor.roomId)});
    const used = new Set(scenes.map(scene => scene.id));
    // A legacy project can contain authored rooms without Studio labels. Those
    // rooms remain occupied even when their models have not been loaded yet.
    schema.studio.ROOM_IDS.forEach(id => { if (schema.studio.hasSceneContent(document, id)) used.add(id); });
    const roomId = schema.studio.ROOM_IDS.find(id => !used.has(id));
    if (!roomId) throw new Error('Este formato admite diez salas. Duplica el proyecto para crear otro conjunto de escenarios.');
    const name = options.name !== undefined ? options.name : editor.shell && editor.shell.requestSceneName ? await editor.shell.requestSceneName({title: 'Nuevo nivel', value: 'Nuevo nivel', confirmLabel: 'Crear nivel'}) : window.prompt('Nombre del nuevo escenario', 'Nuevo escenario');
    if (!name || !name.trim()) return;
    if (name.trim().length > 160) throw new Error('El nombre admite hasta 160 caracteres.');
    if (!editor.active || editor.projectGeneration !== generation || editor.roomId !== previousRoom) throw new Error('El proyecto o el nivel cambió. Vuelve a crear el nivel desde el escenario actual.');
    editor.toast('Creando nivel…');
    const previousAuthoringRoom = editor.authoringRoomId;
    editor.authoringRoomId = roomId;
    try { await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(roomId)); }
    finally { editor.authoringRoomId = previousAuthoringRoom; }
    if (editor.roomId !== roomId || editor.projectGeneration !== generation) throw new Error('No se pudo activar la sala nueva. El escenario anterior conserva sus cambios.');
    let failure;
    let completed = false;
    await editor.perform(() => {
      document.begin();
      try {
        document.resetRoom(roomId);
        document.getObjects(roomId).filter(object => document.isNative(object)).forEach(object => document.setProperty(object, 'visible', false));
        if (options.defaults !== false) this.createSceneBase(roomId);
        document.setStudio({scenes: scenes.concat({id: roomId, name: name.trim()})});
        document.commit();
        completed = true;
      } catch (error) { document.cancel(); failure = error; throw error; }
    });
    if (failure) throw failure;
    if (!completed) throw new Error('No se pudo completar la creación. Vuelve a intentarlo al terminar la carga actual.');
    if (editor.entities) editor.entities.sync();
    if (editor.home) editor.home();
    this.refreshLabels(); editor.toast('Nivel «' + name.trim() + '» creado. Pulsa Guardar para conservarlo en el proyecto.');
    if (creation && creation.kind === 'guided' && editor.sceneGuide) editor.sceneGuide.open();
    return roomId;
    } finally { editor.creatingScene = false; }
  }
  async createTemplateScene(template, options = {}) {
    const editor = this.editor, document = editor.document, before = document.capture(), undoLength = document.undoStack.length, redo = document.redoStack.slice(), previousRoom = editor.roomId;
    try {
      const roomId = await this.newScene({name: options.name || template.name}); if (!roomId) return;
      await this.placeTemplate(template, {preservePosition: true});
      document.undoStack.splice(undoLength); document.undoStack.push(before); if (editor.entities) editor.entities.sync(); editor.home(); return roomId;
    } catch (error) { document.transaction = null; document._restore(before); document.undoStack.splice(undoLength); document.redoStack.splice(0, document.redoStack.length, ...redo); if (editor.roomId !== previousRoom) await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(previousRoom)); throw error; }
  }
  async newProject(name) {
    this.assertStudyReady(); const editor = this.editor, generation = editor.projectGeneration;
    if (editor.creatingProject) throw new Error('Termina de crear el proyecto actual antes de crear otro.');
    editor.creatingProject = true;
    try {
      const creation = editor.sceneCreationDialog ? await editor.sceneCreationDialog.request({mode: 'project', name}) : {kind: 'empty', name: name || 'Nuevo proyecto'};
      if (!creation) return null;
      this.assertStudyReady(); editor.creatingStudy = true;
      const prepared = creation.kind === 'template' ? await this.compileStudyProject([creation.templateId.slice(9)], {name: creation.name}) : await compileBlankProject({name: creation.name, nativeDocument: editor.document});
      if (generation !== editor.projectGeneration) throw new Error('El proyecto cambió durante la preparación. Vuelve a crear el proyecto.');
      if (!editor.projectTabs) await editor.keepCurrentProject();
      const saved = await editor.projectClient.createProject(prepared.name, prepared.document);
      if (generation !== editor.projectGeneration) throw new Error('El proyecto se creó. Ábrelo desde la biblioteca de proyectos.');
      await editor.applyServerProject(saved, {roomId: schema.studio.ROOM_IDS[0]});
      if (editor.entities) editor.entities.sync(); editor.home(); this.refreshLabels();
      if (creation.kind === 'guided' && editor.sceneGuide) editor.sceneGuide.open();
      return saved;
    } finally { editor.creatingStudy = false; editor.creatingProject = false; }
  }
  addLineMonitor() { if (!this.editor.monitorWidgets) throw new Error('El catálogo de widgets se está preparando.'); return this.editor.monitorWidgets.add(); }
  async duplicateScene() {
    const editor = this.editor, document = editor.document;
    if (editor.creatingScene) throw new Error('Termina de crear el nivel actual antes de duplicar otro.');
    const snapshots = document.getObjects(editor.roomId).filter(object => object.parent === editor.root && object.visible).map(object => document.captureObject(object));
    const linkedStudio = this.linkedStudio(snapshots, true);
    const sourceEnvironment = (document.studio && document.studio.environments || []).find(item => item.roomId === editor.roomId);
    const environment = clone(sourceEnvironment || schema.studio.defaultEnvironment(editor.roomId));
    if (!sourceEnvironment && !document.getObjects(editor.roomId).filter(object => document.isNative(object)).every(object => !object.visible)) environment.sky = 'native';
    const before = document.capture(), historyLength = document.undoStack.length;
    try {
      const roomId = await this.newScene({defaults: false}); if (!roomId) return;
      if (snapshots.length) await this.placeTemplate({objects: snapshots, linkedStudio}, {preservePosition: true});
      document.setStudio({environments: (document.studio.environments || []).filter(item => item.roomId !== roomId).concat(Object.assign(environment, {roomId}))});
      if (editor.entities) editor.entities.sync();
      document.undoStack.splice(historyLength); document.undoStack.push(before);
    } catch (error) { document.transaction = null; document._restore(before); document.undoStack.splice(historyLength); throw error; }
  }
  async createIndustrialExamples() {
    const editor = this.editor, document = editor.document, before = document.capture(), historyLength = document.undoStack.length;
    const previousRoom = editor.roomId;
    try {
      const roomId = await this.newScene({name: 'Laboratorio industrial · Ejemplos'});
      if (!roomId) return;
      let result, failure;
      await editor.perform(() => {
        document.begin();
        try { result = this.populateIndustrialExamples(roomId); document.commit(); }
        catch (error) { document.cancel(); failure = error; throw error; }
      });
      if (failure) throw failure;
      if (!result) throw new Error('No se pudo completar el laboratorio de ejemplos.');
      document.undoStack.splice(historyLength); document.undoStack.push(before);
      if (editor.entities) editor.entities.sync();
      editor.home();
      this.refreshLabels(); editor.toast('Laboratorio creado: ' + result.cells.length + ' configuraciones. La primera es la L rectangular a 90°. Pulsa Probar para operar y Guardar para conservarlo.');
      return {roomId, cells: result.cells.map(cell => ({id: cell.id, title: cell.title, mode: cell.mode, objectIds: cell.objects.map(object => object.userData.editorId)}))};
    } catch (error) {
      document.transaction = null; document._restore(before); document.undoStack.splice(historyLength);
      if (editor.roomId !== previousRoom) await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(previousRoom));
      throw error;
    }
  }
  applyIndustrialAging(options = {}) {
    const editor = this.editor, report = applyIndustrialAging(editor.document, editor.roomId, undefined, options);
    editor.materials.invalidate(); editor.wearPaint.invalidate(); editor.industrialVisuals.invalidate(); editor.updateStatus();
    return report;
  }
  studyScenes() { return clone(STUDY_SCENES); }
  availableStudyRoom() {
    const editor = this.editor, document = editor.document, used = new Set((document.studio && document.studio.scenes || []).map(scene => scene.id)); used.add(editor.roomId);
    return schema.studio.ROOM_IDS.find(id => !used.has(id) && !schema.studio.hasSceneContent(document, id)) || null;
  }
  assertStudyReady() {
    const editor = this.editor;
    if (!editor.active || editor.loadingProject || editor.busy || editor.importingFiles || editor.pastingObject || editor.creatingStudy || editor.creatingScene || editor.document.loading || editor.document.transaction || editor.transform && editor.transform.dragging) throw new Error('Abre el editor y termina la operación actual antes de preparar la escena.');
    if (editor.ctx.studio && editor.ctx.studio.room) throw new Error('Sal de la sala compartida antes de crear un escenario de estudio.');
  }
  async compileStudyProject(ids, options = {}) { return compileStudyProject(ids, Object.assign({}, options, {nativeDocument: this.editor.document})); }
  populateStudyScene(id, roomId = this.editor.roomId, options = {}) {
    if (!this.editor.active || roomId !== this.editor.roomId) throw new Error('Abre el nivel en el editor antes de configurar la práctica.');
    const built = buildStudyScene(this.editor.document, roomId, id, Object.assign({scene: this.editor.hooks.renderScene}, options));
    return studySceneReport(this.editor.document, built, roomId);
  }
  async integrateRobotics() {
    this.assertStudyReady(); const editor = this.editor;
    return editor.perform(() => {
      const result = retrofitCediRobotics(editor.document, editor.roomId, {scene: editor.hooks.renderScene, refitRobotCells: true});
      if (editor.entities) editor.entities.sync(); editor.renderTree(); editor.renderInspector();
      const message = result.changed ? result.robots.length + ' robots y ' + result.vehicles.length + ' vehículos integrados. Pulsa Probar para operar.' : result.warnings.length ? 'No se agregaron equipos.' : 'La escena ya está equipada.';
      editor.toast(message + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''));
      return result;
    });
  }
  async addWarehouseMissionExperience(options = {}) {
    this.assertStudyReady(); const editor = this.editor;
    return editor.perform(() => {
      const result = addWarehouseMissionExperience(editor.document, editor.roomId, options);
      if (editor.entities) editor.entities.sync(); editor.renderTree(); editor.renderInspector();
      editor.lastWarehouseMissionReport = result;
      editor.toast(result.changed ? 'Almacén listo: 3 misiones progresivas, pallets y ubicaciones asignadas. Guarda y pulsa Probar.' : 'Esta sala ya contiene la práctica de almacén. Pulsa Probar para continuar.');
      return result;
    });
  }
  async createStudyVariant(id, options = {}) {
    this.assertStudyReady(); const definition = studyScene(id);
    if (!this.availableStudyRoom()) return this.createStudyProject([id], options);
    const editor = this.editor, document = editor.document, before = document.capture(), historyLength = document.undoStack.length, redoBefore = document.redoStack.slice(), previousRoom = editor.roomId, generation = editor.projectGeneration;
    let createdRoom;
    try {
      createdRoom = await this.newScene({name: options.name || definition.title});
      if (!createdRoom) throw new Error('No se pudo crear la sala de estudio.');
      editor.creatingStudy = true; let report, failure;
      await editor.perform(() => {
        if (editor.projectGeneration !== generation || editor.roomId !== createdRoom) throw new Error('El proyecto cambió durante la creación.');
        document.begin();
        try { report = this.populateStudyScene(id, createdRoom, options); document.commit(); }
        catch (error) { document.cancel(); failure = error; throw error; }
      });
      if (failure) throw failure; if (!report) throw new Error('No se completó la escena de estudio.');
      document.undoStack.splice(historyLength); document.undoStack.push(before);
      if (editor.entities) editor.entities.sync(); editor.home(); this.refreshLabels();
      const result = {destination: 'scene', roomId: createdRoom, reports: [report]}; editor.lastStudyReport = result;
      editor.toast('«' + definition.title + '» lista. Probar ejecuta la práctica; una acción Deshacer elimina la variante completa. Guarda para conservarla.'); return result;
    } catch (error) {
      if (editor.projectGeneration === generation) {
        document.transaction = null; document._restore(before); document.undoStack.splice(historyLength); document.redoStack.splice(0, document.redoStack.length, ...redoBefore);
        if (editor.roomId !== previousRoom) await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(previousRoom));
      }
      throw error;
    } finally { editor.creatingStudy = false; }
  }
  async createStudyProject(ids, options = {}) {
    this.assertStudyReady(); const editor = this.editor, generation = editor.projectGeneration;
    editor.creatingStudy = true;
    try {
      const prepared = await this.compileStudyProject(ids, options);
      if (generation !== editor.projectGeneration) throw new Error('El proyecto cambió durante la preparación.');
      // Complete detached preparation precedes either persistence operation.
      // A builder failure cannot save or partially replace the active project.
      await editor.keepCurrentProject();
      if (generation !== editor.projectGeneration) throw new Error('El proyecto cambió antes de guardar la práctica.');
      const saved = await editor.projectClient.createProject(prepared.name, prepared.document);
      if (generation !== editor.projectGeneration) throw new Error('La práctica quedó guardada como «' + saved.name + '». Ábrela desde Otros proyectos; el proyecto activo cambió.');
      const source = {capture: editor.document.capture(), undo: editor.document.undoStack.slice(), redo: editor.document.redoStack.slice(), roomId: editor.roomId,
        currentProject: editor.currentProject, projectName: editor.projectName, dirty: editor.dirty, entries: editor.entries, historicalRevision: editor.historicalRevision};
      try { await editor.applyServerProject(saved, {roomId: schema.studio.ROOM_IDS[0]}); }
      catch (error) {
        editor.document.transaction = null; editor.document._restore(source.capture); editor.document.undoStack.splice(0, editor.document.undoStack.length, ...source.undo); editor.document.redoStack.splice(0, editor.document.redoStack.length, ...source.redo);
        ['currentProject', 'projectName', 'dirty', 'entries', 'historicalRevision'].forEach(key => { editor[key] = source[key]; });
        if (editor.roomId !== source.roomId) await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(source.roomId));
        if (editor.entities) editor.entities.sync(); this.refreshLabels();
        throw new Error('El proyecto «' + saved.name + '» quedó guardado. No se pudo abrir; el proyecto anterior se restauró. Ábrelo desde Otros proyectos. ' + error.message);
      }
      if (editor.entities) editor.entities.sync(); editor.home(); this.refreshLabels();
      const result = {destination: 'project', projectId: saved.id, revision: saved.revision, name: saved.name, reports: prepared.reports}; editor.lastStudyReport = result;
      editor.toast('Proyecto «' + saved.name + '» creado y guardado con ' + prepared.reports.length + ' escenas. El proyecto anterior sigue disponible en Otros proyectos.'); return result;
    } finally { editor.creatingStudy = false; }
  }
  populateIndustrialExamples(roomId = this.editor.roomId, options = {}) {
    if (!this.editor.active || roomId !== this.editor.roomId) throw new Error('Abre el nivel en el editor antes de configurar los ejemplos.');
    return buildIndustrialLab(this.editor.document, roomId, {scene: this.editor.hooks.renderScene, continuous: options.continuous !== false, robotized: options.robotized !== false});
  }
  populateCediScenario(roomId = this.editor.roomId, kind = 'sorting', options = {}) {
    if (!this.editor.active || roomId !== this.editor.roomId) throw new Error('Abre el nivel en el editor antes de configurar el CEDI.');
    return buildIndustrialCediLevel(this.editor.document, roomId, {kind, scene: this.editor.hooks.renderScene, continuous: options.continuous !== false, robotized: options.robotized !== false});
  }
  async createCediExamples() {
    const editor = this.editor, document = editor.document;
    if (!editor.active || editor.loadingProject || document.transaction || editor.transform && editor.transform.dragging) throw new Error('Abre el editor y termina la operación actual antes de crear los CEDI.');
    const definitions = [{kind: 'sorting', title: 'CEDI · Clasificación y consolidación', continuous: true, expectedUnits: 0},
      {kind: 'packing', title: 'CEDI · Packing y transferencias', continuous: true, expectedUnits: 0}];
    const scenes = document.studio && document.studio.scenes || [];
    const missing = definitions.filter(item => !scenes.some(scene => scene.name === item.title));
    const occupied = new Set(scenes.map(scene => scene.id)); occupied.add(editor.roomId);
    schema.studio.ROOM_IDS.forEach(id => { if (schema.studio.hasSceneContent(document, id)) occupied.add(id); });
    if (schema.studio.ROOM_IDS.filter(id => !occupied.has(id)).length < missing.length) throw new Error('No hay dos niveles libres para estos CEDI. Crea otro proyecto para conservar los escenarios actuales.');
    const before = document.capture(), historyLength = document.undoStack.length, previousRoom = editor.roomId;
    const scenarios = [];
    try {
      for (const definition of definitions) {
        const existing = scenes.find(scene => scene.name === definition.title);
        if (existing) { scenarios.push(Object.assign({roomId: existing.id, existing: true}, definition)); continue; }
        const roomId = await this.newScene({name: definition.title});
        if (!roomId) throw new Error('No se pudo crear el nivel CEDI.');
        let built, failure;
        await editor.perform(() => {
          document.begin();
          try { built = this.populateCediScenario(roomId, definition.kind); document.commit(); }
          catch (error) { document.cancel(); failure = error; throw error; }
        });
        if (failure) throw failure;
        if (!built) throw new Error('No se completó la configuración del CEDI.');
        scenarios.push(Object.assign({roomId, sourceIds: built.sources.map(object => object.userData.editorId),
          receiverIds: built.receivers.map(object => object.userData.editorId), controllerIds: built.controllers.map(object => object.userData.editorId),
          objectIds: built.objects.map(object => object.userData.editorId)}, definition));
      }
      if (missing.length) { document.undoStack.splice(historyLength); document.undoStack.push(before); }
      if (editor.entities) editor.entities.sync();
      editor.home(); this.refreshLabels();
      editor.toast('CEDI listos: doble alimentación/clasificación y packing con L rectangular. Selecciona el nivel y pulsa Probar.');
      return {scenarios};
    } catch (error) {
      document.transaction = null; document._restore(before); document.undoStack.splice(historyLength);
      if (editor.roomId !== previousRoom) await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(previousRoom));
      throw error;
    }
  }
  /** Explicit rebuild used for an authorized refresh of the two named example
   * levels. Existing projects are never upgraded on load or by Create's reuse
   * path. Both replacements form one undo action; failure restores both rooms.
   */
  async refreshCediExamples(options = {}) {
    const editor = this.editor, document = editor.document;
    if (!editor.active || editor.loadingProject || editor.creatingScene || document.transaction || editor.transform && editor.transform.dragging)
      throw new Error('Abre el editor y termina la operación actual antes de actualizar los ejemplos.');
    const definitions = [{kind: 'sorting', title: 'CEDI · Clasificación y consolidación'}, {kind: 'packing', title: 'CEDI · Packing y transferencias'}];
    if (options.includeLab) definitions.push({kind: 'lab', title: 'Laboratorio industrial · Ejemplos'});
    const scenes = document.studio && document.studio.scenes || [];
    const targets = definitions.map(definition => {
      const matches = scenes.filter(scene => scene.name === definition.title);
      if (matches.length !== 1 || !schema.studio.ROOM_IDS.includes(matches[0].id)) throw new Error('No se encontró un único nivel «' + definition.title + '».');
      return Object.assign({roomId: matches[0].id}, definition);
    });
    if (new Set(targets.map(item => item.roomId)).size !== targets.length) throw new Error('Los ejemplos deben ocupar niveles distintos.');
    const before = document.capture(), historyLength = document.undoStack.length, previousRoom = editor.roomId;
    const scenarios = []; editor.creatingScene = true;
    try {
      for (const target of targets) {
        await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(target.roomId));
        if (editor.roomId !== target.roomId) throw new Error('No se pudo activar el nivel que se va a actualizar.');
        let built, failure;
        await editor.perform(() => {
          document.begin();
          try {
            document.resetRoom(target.roomId);
            document.getObjects(target.roomId).filter(object => document.isNative(object)).forEach(object => document.setProperty(object, 'visible', false));
            this.createSceneBase(target.roomId);
            built = target.kind === 'lab' ? this.populateIndustrialExamples(target.roomId, options) : this.populateCediScenario(target.roomId, target.kind, {continuous: options.continuous === true});
            // Refreshing an existing example is not a request to change which
            // scene opens first, even though creating a new lab selects it.
            if (before.studio) document.setStudio({startRoomId: before.studio.startRoomId});
            document.commit();
          } catch (error) { document.cancel(); failure = error; throw error; }
        });
        if (failure) throw failure;
        if (!built) throw new Error('No se pudo completar el nuevo CEDI.');
        const networks = built.lines || built.cells;
        scenarios.push(Object.assign({}, target, {continuous: options.continuous === true, expectedUnits: built.expectedUnits || 0, expectedLoads: built.expectedLoads || 0,
          coverage: built.coverage, expectedReceiverUnits: built.expectedReceiverUnits, expectedReceiverLoads: built.expectedReceiverLoads,
          sourceIds: networks.flatMap(line => line.sources.map(object => object.userData.editorId)), receiverIds: networks.flatMap(line => line.receivers.map(object => object.userData.editorId)),
          controllerIds: networks.map(line => line.controller.userData.editorId), objectIds: built.objects.map(object => object.userData.editorId),
          lines: networks.map(line => ({id: line.id, title: line.title, mode: line.mode, controllerId: line.controller.userData.editorId,
            memberIds: line.memberIds, monitorId: line.monitor && line.monitor.userData.editorId,
            sourceIds: line.sources.map(object => object.userData.editorId), receiverIds: line.receivers.map(object => object.userData.editorId),
            expectedUnits: line.expectedUnits, expectedLoads: line.expectedLoads, expectedReceiverUnits: line.expectedReceiverUnits,
            expectedReceiverLoads: line.expectedReceiverLoads, sourceExpectations: line.sourceExpectations, routingCoverage: line.routingCoverage}))}));
      }
      document.undoStack.splice(historyLength); document.undoStack.push(before);
      await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(targets[0].roomId));
      if (editor.entities) editor.entities.sync();
      editor.home(); this.refreshLabels();
      return {scenarios};
    } catch (error) {
      document.transaction = null; document._restore(before); document.undoStack.splice(historyLength);
      if (editor.roomId !== previousRoom) await editor.hooks.gotoRoom(schema.studio.ROOM_IDS.indexOf(previousRoom));
      throw error;
    } finally { editor.creatingScene = false; }
  }
  configureEnvironment() { if (this.editor.shell) this.editor.shell.openWorkspace('environment'); }
  async addEntity(type) {
    const editor = this.editor, document = editor.document;
    const result = await editor.perform(() => {
      document.begin();
      try {
        const object = document.addPrimitive(editor.roomId, type === 'pointLight' ? 'sphere' : 'box', type === 'pointLight' ? '#ffd166' : '#67dbe8');
        document.setProperty(object, 'name', type === 'pointLight' ? 'Luz puntual' : 'Cámara');
        document.setTransform(object, {position: type === 'pointLight' ? [editor.orbit.target.x, Math.max(2, editor.orbit.target.y), editor.orbit.target.z] : editor.camera.position.toArray(),
          quaternion: type === 'camera' ? editor.camera.quaternion.toArray() : [0, 0, 0, 1], scale: type === 'pointLight' ? [0.12, 0.12, 0.12] : [0.2, 0.14, 0.28]});
        document.setStudio({entities: (document.studio && document.studio.entities || []).concat({id: uid('entity'), objectId: object.userData.editorId, roomId: editor.roomId, type, color: '#ffffff', intensity: 1, range: 8, fov: 55})});
        document.commit(); return object;
      } catch (error) { document.cancel(); throw error; }
    });
    if (editor.entities) editor.entities.sync();
    if (editor.shell) editor.shell.openWorkspace(type === 'camera' ? 'cameras' : 'environment');
    return result;
  }
  addLight() { return this.addEntity('pointLight'); }
  addCamera() { return this.addEntity('camera'); }
  addSpawn() {
    const editor = this.editor, document = editor.document;
    return editor.perform(() => {
      document.begin();
      try {
        const object = document.addPrimitive(editor.roomId, 'cylinder', '#51ebd2');
        document.setProperty(object, 'name', 'Punto de aparición');
        document.setTransform(object, {position: [editor.orbit.target.x, 0.02, editor.orbit.target.z], scale: [0.45, 0.03, 0.45]});
        document.setBehaviors(object, [Object.assign(schema.defaultBehavior('collision'), {enabled: false})]);
        document.setStudio({spawns: (document.studio && document.studio.spawns || []).concat({objectId: object.userData.editorId, roomId: editor.roomId})});
        document.commit(); editor.select(object); return object;
      } catch (error) { document.cancel(); throw error; }
    });
  }
  addInteractionZone() { const editor = this.editor; return editor.perform(() => { const object = editor.document.addPrimitive(editor.roomId, 'box', '#51ebd2'); editor.document.setTransform(object, {scale: [1, 0.05, 1]}); editor.document.setInteraction(object, {type: 'message', text: 'Zona de interacción: edita este mensaje en el inspector.'}); return object; }); }
  addWidget(kind = 'counter') {
    const labels = {text: 'Texto', counter: 'Contador de entradas', indicator: 'Indicador', progress: 'Barra de progreso', button: 'Botón de mando'};
    if (!Object.prototype.hasOwnProperty.call(labels, kind)) throw new Error('Este tipo de widget no es compatible.');
    const editor = this.editor, name = window.prompt('Nombre del widget', labels[kind]); if (!name) return;
    const target = this.objects()[0], position = editor.orbit.target.clone(); position.y = Math.max(1.4, position.y);
    const widget = {id: uid('widget'), name, roomId: editor.roomId, kind, text: name, objectId: target ? target.userData.editorId : '', variable: 'entryCount', presentation: 'world', position: position.toArray(), color: '#51ebd2', visible: true, maximum: 100};
    editor.document.setStudio({widgets: (editor.document.studio && editor.document.studio.widgets || []).concat(widget)});
    if (editor.shell) editor.shell.openWorkspace('interface');
  }
  addMission() {
    const editor = this.editor, name = window.prompt('Objetivo de misión', 'Clasificar 20 productos'); if (!name) return;
    const mission = {id: uid('mission'), name, roomId: editor.roomId, description: name, start: 'automatic', help: 'Configura reglas de clasificación en una unión/desvío y confirma sus salidas.', steps: [{name: 'Salidas clasificadas mediante reglas', event: 'classification-confirmed', objectId: editor.selected ? editor.selected.userData.editorId : '', target: 20, failEvent: ''}]};
    editor.document.setStudio({missions: (editor.document.studio && editor.document.studio.missions || []).concat(mission)});
    if (editor.shell) editor.shell.openWorkspace('logic');
  }
  connect() { if (this.editor.shell) this.editor.shell.openWorkspace('connections'); }
  openWorkspace(id, container) {
    if (!container) return;
    if (this.graphicsSettings) { this.graphicsSettings.dispose(); this.graphicsSettings = null; }
    container.textContent = ''; const editor = this.editor, document = editor.document;
    const studio = document.studio || {version: 1};
    if (['interface', 'ui', 'interfaz'].includes(id)) {
      node('h2', 'Interfaz · widgets', container); node('p', 'Los widgets del mundo 3D funcionan en escritorio y WebXR. Vincula un objeto y una variable real.', container); button(container, '+ Widget', () => this.addWidget());
      (studio.widgets || []).filter(item => item.roomId === editor.roomId).forEach(widget => {
        const form = node('form', undefined, container); form.className = 'studio-card'; form.addEventListener('submit', event => event.preventDefault());
        const name = field(form, 'Nombre', widget.name), kind = select(form, 'Tipo', [{value: 'text', label: 'Texto'}, {value: 'counter', label: 'Contador'}, {value: 'indicator', label: 'Indicador'}, {value: 'progress', label: 'Barra de progreso'}, {value: 'button', label: 'Botón'}], widget.kind);
        const target = select(form, 'Objeto', [{label: 'Sin vínculo', value: ''}].concat(document.getObjects(editor.roomId).filter(object => document.getBehaviors(object).some(component => schema.simulationTypes.includes(component.type))).map(object => ({label: object.name || object.userData.editorId, value: object.userData.editorId}))), widget.objectId);
        const variable = field(form, 'Variable', widget.variable), text = field(form, 'Texto', widget.text), maximum = field(form, 'Máximo', widget.maximum, 'number');
        const action = select(form, 'Acción del botón', [{value: 'start', label: 'Marcha'}, {value: 'stop', label: 'Parar'}, {value: 'pause', label: 'Pausa'}, {value: 'powerOn', label: 'Encender'}, {value: 'powerOff', label: 'Apagar'}, {value: 'insertBox', label: 'Insertar caja'}, {value: 'speedUp', label: 'Subir velocidad'}, {value: 'speedDown', label: 'Bajar velocidad'}], widget.action);
        const presentation = select(form, 'Presentación', [{value: 'world', label: 'Mundo 3D y VR'}, {value: 'desktop', label: 'Escritorio'}, {value: 'both', label: 'Escritorio y mundo 3D'}], widget.presentation), color = field(form, 'Color', widget.color, 'color');
        const position = widget.position.map((n, i) => field(form, 'Posición ' + 'XYZ'[i] + ' (m)', n, 'number'));
        button(form, 'Aplicar', () => this.guard(() => { document.setStudio({widgets: studio.widgets.map(item => item.id === widget.id ? Object.assign({}, item, {name: name.value, kind: kind.value, objectId: target.value, variable: variable.value, text: text.value, maximum: Number(maximum.value), action: action.value, presentation: presentation.value, color: color.value, position: position.map(input => Number(input.value))}) : item)}); this.openWorkspace(id, container); }));
        button(form, 'Eliminar widget', () => { document.setStudio({widgets: studio.widgets.filter(item => item.id !== widget.id)}); this.openWorkspace(id, container); });
      }); return;
    }
    if (['logic', 'missions', 'logic-missions', 'logica'].includes(id)) {
      node('h2', 'Lógica y misiones', container); node('p', 'Los pasos avanzan con eventos reales. classification-confirmed se emite al confirmar la salida de una regla coincidente.', container); button(container, '+ Misión', () => this.addMission());
      (studio.missions || []).filter(item => item.roomId === editor.roomId).forEach(mission => {
        const form = node('form', undefined, container); form.className = 'studio-card'; form.addEventListener('submit', event => event.preventDefault());
        const name = field(form, 'Objetivo', mission.name), help = field(form, 'Ayuda', mission.help), start = select(form, 'Inicio', [{value: 'automatic', label: 'Al ejecutar el escenario'}, {value: 'manual', label: 'Manual desde Mi progreso'}], mission.start);
        const steps = mission.steps.map(step => ({name: field(form, 'Paso', step.name), event: select(form, 'Evento de éxito', ['classification-confirmed', 'package-exit', 'package-transfer', 'sensor-detected', 'processor-complete', 'product-picked', 'product-released'], step.event), objectId: field(form, 'ID del equipo (vacío = cualquiera)', step.objectId), target: field(form, 'Cantidad requerida', step.target, 'number'), failEvent: field(form, 'Evento de fallo (opcional)', step.failEvent)}));
        button(form, 'Aplicar misión', () => this.guard(() => { document.setStudio({missions: studio.missions.map(item => item.id === mission.id ? Object.assign({}, item, {name: name.value, help: help.value, start: start.value, steps: steps.map(row => ({name: row.name.value, event: row.event.value, objectId: row.objectId.value, target: Number(row.target.value), failEvent: row.failEvent.value}))}) : item)}); this.openWorkspace(id, container); }));
        button(form, '+ Paso', () => { document.setStudio({missions: studio.missions.map(item => item.id === mission.id ? Object.assign({}, item, {steps: item.steps.concat({name: 'Siguiente paso', event: 'package-exit', target: 1, objectId: '', failEvent: ''})}) : item)}); this.openWorkspace(id, container); });
        button(form, 'Eliminar misión', () => { document.setStudio({missions: studio.missions.filter(item => item.id !== mission.id)}); this.openWorkspace(id, container); });
      }); return;
    }
    if (id === 'connections') {
      node('h2', 'Conectar equipos por puertos', container); const assembly = editor.assembly, objects = assembly.records();
      const options = objects.map(object => ({label: object.name || object.userData.editorId, value: object.userData.editorId}));
      const source = select(container, 'Equipo de salida', options, editor.selected && editor.selected.userData.editorId), output = select(container, 'Puerto de salida', ['output', 'branch'], 'output');
      const target = select(container, 'Equipo de entrada', options), input = select(container, 'Puerto de entrada', ['input', 'branch'], 'input');
      const status = node('p', 'Selecciona dos equipos. Se alineará el equipo de entrada mediante el ensamble existente.', container);
      let preview = null;
      container.addEventListener('studio-workspace-close', () => { if (preview) document.cancel(); preview = null; }, {once: true});
      button(container, 'Evaluar y previsualizar', () => this.guard(() => {
        const from = document.getObject(source.value), to = document.getObject(target.value);
        const pair = assembly.pair(to, input.value, from, output.value);
        if (!pair || !assembly.available(pair)) {
          const check = assembly.portCompatibility(assembly.worldPort(from, output.value), assembly.worldPort(to, input.value));
          status.textContent = check.reasons.length ? check.reasons.map(reason => reason.message).join(' ') : 'Puerto ocupado o pose incompatible. Para una L usa una curva; para una T usa un mecanismo de transferencia o desvío y su rama receptora. Una unión coordinada necesita reservar la zona común.';
          return;
        }
        if (preview) { document.cancel(); preview = null; }
        document.begin(); assembly.align(from, output.value, to, input.value); preview = {from, to}; editor.select(to); status.textContent = 'Vista previa alineada. Confirma para registrar la conexión o cancela para restaurar.';
      }));
      button(container, 'Confirmar conexión', () => this.guard(() => { if (!preview) throw new Error('Evalúa primero la conexión.'); const pair = assembly.pair(preview.to, input.value, preview.from, output.value); if (!pair || !assembly.available(pair)) throw new Error('El puerto ya no está disponible.'); assembly.connect(pair); document.commit(); preview = null; editor.syncNative(); status.textContent = 'Conexión registrada. El flujo valida espacio y recepción de cada carga.'; }));
      button(container, 'Cancelar', () => { if (preview) document.cancel(); preview = null; status.textContent = 'Vista previa cancelada.'; });
      button(container, 'Desconectar seleccionado', () => editor.perform(() => assembly.disconnect(editor.selected))); return;
    }
    if (id === 'environment' || id === 'cameras') {
      node('h2', id === 'cameras' ? 'Cámaras del escenario' : 'Entorno e iluminación', container);
      node('p', id === 'cameras' ? 'Las cámaras conservan posición, orientación y campo de visión. Usa el gizmo del marcador para componer cada toma.' : 'El cielo y la iluminación se guardan para este nivel. Puedes añadir luces puntuales; los materiales se editan por pieza en Apariencia.', container);
      if (id === 'environment') {
        if (editor.appendGraphicsSettings) this.graphicsSettings = editor.appendGraphicsSettings(container);
        const roomId = editor.roomId, generation = editor.projectGeneration;
        const saved = (studio.environments || []).find(item => item.roomId === editor.roomId);
        const resolved = editor.entities && editor.entities.environment && editor.entities.environment.getConfig();
        const environment = saved || resolved || Object.assign(schema.studio.defaultEnvironment(editor.roomId), {sky: 'native'});
        const form = node('form', undefined, container); form.className = 'studio-card'; form.addEventListener('submit', event => event.preventDefault());
        node('h3', 'Cielo y luz del nivel', form);
        const sky = select(form, 'Cielo', [{value: 'day', label: 'Cielo de día'}, {value: 'color', label: 'Color uniforme'}, {value: 'native', label: 'Entorno original de la sala'}], environment.sky);
        const inputs = {skyColor: field(form, 'Color del cielo', environment.skyColor, 'color'), horizonColor: field(form, 'Color del horizonte', environment.horizonColor, 'color'),
          groundColor: field(form, 'Color inferior del cielo', environment.groundColor, 'color'), sunColor: field(form, 'Color de luz solar', environment.sunColor, 'color'),
          sunIntensity: field(form, 'Intensidad solar', environment.sunIntensity, 'number'), ambientIntensity: field(form, 'Luz de relleno', environment.ambientIntensity, 'number')};
        ['sunIntensity', 'ambientIntensity'].forEach(key => { inputs[key].min = 0; inputs[key].max = 5; inputs[key].step = 0.1; });
        node('h3', 'Calidad de imagen y sombras', form);
        const renderQuality = select(form, 'Calidad de imagen', [{value: 'performance', label: 'Rendimiento'}, {value: 'balanced', label: 'Equilibrada'}, {value: 'high', label: 'Alta'}], environment.renderQuality || 'balanced'); renderQuality.name = 'renderQuality';
        const shadows = field(form, 'Sombras del nivel', '', 'checkbox'); shadows.name = 'shadows'; shadows.checked = environment.shadows !== false;
        inputs.exposure = field(form, 'Exposición', environment.exposure === undefined ? 1 : environment.exposure, 'number'); inputs.exposure.min = .4; inputs.exposure.max = 2; inputs.exposure.step = .05;
        node('h3', 'Sonido del nivel', form);
        const machineSounds = field(form, 'Sonidos de las máquinas', '', 'checkbox'); machineSounds.name = 'machineSounds'; machineSounds.checked = environment.machineSounds !== false;
        inputs.machineVolume = field(form, 'Volumen de máquinas', environment.machineVolume === undefined ? .25 : environment.machineVolume, 'number');
        const ambientPreset = select(form, 'Ambiente sonoro', [{value: 'off', label: 'Apagado'}, {value: 'warehouse', label: 'Bodega'}, {value: 'factory', label: 'Fábrica'}, {value: 'ventilation', label: 'Ventilación'}], environment.ambientPreset || 'off'); ambientPreset.name = 'ambientPreset';
        inputs.ambientSound = field(form, 'Archivo de ambiente (ruta o importId, opcional)', environment.ambientSound || ''); inputs.ambientSound.placeholder = 'Ruta de audio o importId';
        inputs.ambientVolume = field(form, 'Volumen de ambiente', environment.ambientVolume === undefined ? .12 : environment.ambientVolume, 'number');
        ['machineVolume', 'ambientVolume'].forEach(key => { inputs[key].min = 0; inputs[key].max = 1; inputs[key].step = .01; });
        Object.keys(inputs).forEach(key => { inputs[key].name = key; });
        if (typeof editor.createAudioZone === 'function') button(form, '+ Zona de sonido', () => this.guard(() => editor.createAudioZone()));
        button(form, 'Aplicar entorno', () => this.guard(() => {
          if (editor.roomId !== roomId || editor.projectGeneration !== generation) throw new Error('El nivel cambió. Abre de nuevo Entorno para editar el nivel actual.');
          const config = Object.assign({}, environment, {roomId, sky: sky.value, renderQuality: renderQuality.value, shadows: shadows.checked, machineSounds: machineSounds.checked, ambientPreset: ambientPreset.value});
          Object.keys(inputs).forEach(key => { config[key] = inputs[key].type === 'number' ? Number(inputs[key].value) : key === 'ambientSound' ? inputs[key].value.trim() : inputs[key].value; });
          document.setStudio({environments: (document.studio && document.studio.environments || []).filter(item => item.roomId !== roomId).concat(config)});
          if (editor.entities) editor.entities.sync(); editor.toast('Entorno actualizado para este nivel.');
        }));
      }
      button(container, id === 'cameras' ? '+ Cámara desde esta vista' : '+ Luz puntual', () => this.guard(() => id === 'cameras' ? this.addCamera() : this.addLight()));
      (studio.entities || []).filter(entity => entity.roomId === editor.roomId && entity.type === (id === 'cameras' ? 'camera' : 'pointLight')).forEach(entity => {
        const marker = document.getObject(entity.objectId); if (!marker) return;
        const form = node('form', undefined, container); form.className = 'studio-card'; form.addEventListener('submit', event => event.preventDefault());
        node('h3', marker.name, form); button(form, 'Seleccionar marcador', () => editor.select(marker));
        const inputs = entity.type === 'pointLight' ? {color: field(form, 'Color de luz', entity.color, 'color'), intensity: field(form, 'Intensidad', entity.intensity, 'number'), range: field(form, 'Alcance (m, 0 = ilimitado)', entity.range, 'number')} : {fov: field(form, 'Campo de visión (°)', entity.fov, 'number')};
        button(form, 'Aplicar', () => this.guard(() => {
          const patch = {}; Object.keys(inputs).forEach(key => { patch[key] = key === 'color' ? inputs[key].value : Number(inputs[key].value); });
          document.setStudio({entities: (document.studio.entities || []).map(item => item.id === entity.id ? Object.assign({}, item, patch) : item)});
          if (editor.entities) editor.entities.sync();
        }));
        if (entity.type === 'camera') {
          button(form, 'Usar esta vista', () => this.guard(() => { if (!editor.entities) throw new Error('Las cámaras se están preparando.'); editor.entities.useCamera(entity.id); }));
          button(form, 'Vista previa', () => this.guard(() => {
            if (!editor.entities) throw new Error('Las cámaras se están preparando.');
            const region = node('div', undefined, form); editor.entities.showPreview(entity.id, region);
            container.addEventListener('studio-workspace-close', () => editor.entities.stopPreview(), {once: true});
          }));
        }
        button(form, entity.type === 'pointLight' ? 'Eliminar luz' : 'Eliminar cámara', () => this.guard(() => editor.perform(() => {
          document.begin();
          try { document.setStudio({entities: document.studio.entities.filter(item => item.id !== entity.id)}); document.remove(marker); document.commit(); }
          catch (error) { document.cancel(); throw error; }
          if (editor.entities) editor.entities.sync(); this.openWorkspace(id, container);
        })));
      }); return;
    }
    if (['results', 'console', 'signals'].includes(id)) { node('h2', 'Resultados y señales', container); button(container, 'Abrir monitor de variables, eventos y registros', () => editor.simulationPanel.toggle(true)); return; }
    node('p', 'Este espacio de trabajo está en desarrollo.', container);
  }
}
