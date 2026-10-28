import {compileBlankProject} from './StudySceneProject.js';
import publicScenes from '../../shared/public-scenes.js';
import PublicSceneLibrary from './PublicSceneLibrary.js';

const ROOMS = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];

/** Server-backed scene selection. Public projections contain one authorized
 * room, never a hidden copy of the owner's complete private project. */
export default class ProjectAccessView {
  constructor(editor) { this.editor = editor; this.user = null; this.generation = 0; this.identityGeneration = 0; }
  get staticPublic() { return Boolean(this.editor.staticPublic); }
  get enabled() { return this.staticPublic || Boolean(this.editor.serverCapabilities && this.editor.serverCapabilities.privateProjects); }
  canEdit() {
    if (this.staticPublic) return false;
    if (!this.enabled) return true;
    const user = this.editor.ctx.studio ? this.editor.ctx.studio.client.user : this.user;
    const access = this.editor.currentProject && this.editor.currentProject.access;
    return Boolean(user && user.permissions && user.permissions.editor && (!access || access.canEdit === true));
  }
  canVisit(roomId) {
    if (!this.enabled) return true;
    if (this.editor.accessLoadFailed && !this.editor.loadingProject) return false;
    // Creating a level prepares its destination before the scene metadata is
    // committed. This one room is reachable only during an authorized edit.
    if (this.editor.active && this.editor.creatingScene && this.editor.authoringRoomId === roomId && ROOMS.includes(roomId) && this.canEdit()) return true;
    const editor = this.editor, allowed = editor.loadingAllowedRoomIds || editor.currentProject && editor.currentProject.allowedRoomIds;
    if (allowed) return allowed.includes(roomId);
    const scenes = editor.document.studio && editor.document.studio.scenes;
    return !scenes || !scenes.length || scenes.some(scene => scene.id === roomId || scene.roomId === roomId);
  }
  async publicRoomScene(roomId) {
    if (!ROOMS.includes(roomId)) return null;
    const catalog = await this.publicCatalog();
    return catalog.previewAllExamples ? catalog.scenes.find(scene => scene.original === true && scene.roomId === roomId) : catalog.scenes.find(scene => scene.roomId === roomId);
  }
  async visitPublicRoom(roomId) {
    const editor = this.editor, previous = editor.currentProject;
    if (!ROOMS.includes(roomId) || !previous || !previous.publicSceneId) return false;
    const scope = this.identityGeneration, generation = ++this.generation, catalog = await this.publicCatalog();
    if (scope !== this.identityGeneration || generation !== this.generation || editor.currentProject !== previous || !catalog.previewAllExamples) return false;
    if (!catalog.scenes.some(scene => scene.id === previous.publicSceneId && scene.original === true)) return false;
    const target = catalog.scenes.find(scene => scene.original === true && scene.roomId === roomId);
    if (!target) return false;
    const result = await this.publicProject(target.id);
    if (scope !== this.identityGeneration || generation !== this.generation || editor.currentProject !== previous) return false;
    if (editor.active) editor.leave();
    await editor.applyServerProject(result.project, {roomId, accessGeneration: scope});
    editor.accessLoadFailed = false; editor.projectSync.stop(); editor.dirty = false;
    return true;
  }
  async initialize(parameters) {
    const editor = this.editor, scope = this.identityGeneration;
    if (this.staticPublic) {
      this.user = null;
      editor.initialIdentity = {user: null, configured: false, capabilities: {}, staticPublic: true};
      editor.projectClient.identityProvider = () => null;
      const rawId = parameters.get('project') || '';
      const roomScene = await this.publicRoomScene(parameters.get('room'));
      if (scope !== this.identityGeneration) return false;
      await this.loadPublic(parameters.get('scene') || (rawId.startsWith('public-') ? rawId.slice(7) : roomScene && roomScene.id));
      return true;
    }
    const identity = await editor.projectClient.request('GET', '/studio/me');
    if (scope !== this.identityGeneration) return false;
    this.user = identity.user || null;
    editor.initialIdentity = identity;
    editor.projectClient.identityProvider = () => this.user && this.user.id;
    const rawId = parameters.get('project') || this.requestedProjectId;
    const explicitId = rawId && !/^(public-|library-)/.test(rawId) ? rawId : null;
    const libraryId = parameters.get('libraryScene') || (rawId && rawId.startsWith('library-') ? rawId.slice(8) : null);
    if (explicitId && !this.user && !/^(public-|library-)/.test(explicitId)) this.requestedProjectId = explicitId;
    if (explicitId && this.user && !/^public-|^library-/.test(explicitId)) {
      try { const project = await editor.projectClient.getProject(explicitId); if (scope !== this.identityGeneration) return false; await editor.applyServerProject(project, {roomId: parameters.get('room'), accessGeneration: scope}); return true; }
      catch (error) { editor.toast(error.message); }
    }
    if (editor.editorEnabled && this.user && this.user.permissions.editor && !explicitId && !libraryId && !(rawId && rawId.startsWith('public-')) && !parameters.get('scene')) {
      const result = await editor.projectClient.listProjects(); const list = Array.isArray(result) ? result : result.projects || [];
      if (scope !== this.identityGeneration) return false;
      let remembered; try { remembered = localStorage.getItem(editor.scopedStorageKey('hello-webxr-active-project')); } catch (_) { /* Optional browser state. */ }
      const project = list.find(value => value.id === remembered && (!value.access || value.access.canEdit)) || list.find(value => !value.access || value.access.canEdit);
      if (project) { const saved = await editor.projectClient.getProject(project.id); if (scope !== this.identityGeneration) return false; await editor.applyServerProject(saved, {accessGeneration: scope}); return true; }
      const blank = await compileBlankProject({nativeDocument: editor.document, name: 'Nuevo proyecto'});
      if (scope !== this.identityGeneration) return false;
      await editor.applyServerProject({name: blank.name, revision: 0, document: blank.document, access: {canEdit: true, role: 'owner'}}, {accessGeneration: scope});
      editor.currentProject = null; editor.dirty = false; return true;
    }
    if (libraryId && this.user) {
      const result = await editor.projectClient.request('GET', '/library/scenes/' + encodeURIComponent(libraryId));
      if (scope !== this.identityGeneration) return false;
      await editor.applyServerProject(result.project, {accessGeneration: scope}); return true;
    }
    const roomScene = await this.publicRoomScene(parameters.get('room'));
    if (scope !== this.identityGeneration) return false;
    await this.loadPublic(parameters.get('scene') || (rawId && rawId.startsWith('public-') ? rawId.slice(7) : roomScene && roomScene.id)); return true;
  }
  async loadPublic(id) {
    const editor = this.editor, generation = ++this.generation;
    const catalog = await this.publicCatalog(); this.catalog = catalog.scenes || [];
    const scene = this.catalog.find(value => value.id === id) || this.catalog[0];
    if (!scene) throw new Error('No hay escenas públicas disponibles. Inicia sesión para abrir tus proyectos.');
    const result = await this.publicProject(scene.id);
    if (generation !== this.generation) return false;
    if (editor.active) editor.leave();
    await editor.applyServerProject(result.project, {roomId: scene.roomId});
    editor.accessLoadFailed = false;
    editor.projectSync.stop(); editor.dirty = false;
    return true;
  }
  async publicCatalog() {
    if (!this.staticPublic) return this.editor.projectClient.request('GET', '/public/scenes');
    if (!this.staticCatalog) this.staticCatalog = fetch(new URL('assets/public-scenes/catalog.json', document.baseURI).href, {credentials: 'omit'}).then(async response => {
      if (!response.ok) throw new Error('No se pudo cargar el catálogo de ejemplos incluidos.');
      const value = await response.json();
      if (!value || !Array.isArray(value.scenes) || value.scenes.length > 64 || value.scenes.some(scene => !/^[a-z0-9-]{1,80}$/.test(scene.id) || !ROOMS.includes(scene.roomId))) throw new Error('Catálogo público inválido.');
      return value;
    }).catch(error => {this.staticCatalog = null; throw error;});
    return this.staticCatalog;
  }
  async publicProject(id) {
    if (!this.staticPublic) return this.editor.projectClient.request('GET', '/public/scenes/' + encodeURIComponent(id));
    const catalog = await this.publicCatalog(), scene = catalog.scenes.find(value => value.id === id);
    if (!scene) throw new Error('Esta escena no está incluida en la publicación pública.');
    const response = await fetch(new URL('assets/public-scenes/' + scene.id + '.json', document.baseURI).href, {credentials: 'omit'});
    if (!response.ok) throw new Error('No se pudo cargar el ejemplo público. Actualiza la publicación y vuelve a intentarlo.');
    const result = await response.json(), project = result && result.project;
    if (!project || project.publicSceneId !== scene.id || !project.document || !project.document.rooms || Object.keys(project.document.rooms).length !== 1 || !project.document.rooms[scene.roomId] || (project.document.imports || []).length) throw new Error('El ejemplo público no es una proyección válida.');
    project.access = {role: 'public', canEdit: false, canShare: false}; project.allowedRoomIds = [scene.roomId];
    return result;
  }
  async accountChanged(user, options = {}) {
    const old = this.user && this.user.id; this.user = user || null;
    if (old === (this.user && this.user.id) && !options.reload) return;
    this.disposeGallery();
    this.generation++; this.identityGeneration++; const editor = this.editor;
    const canvas = editor.ctx.renderer && editor.ctx.renderer.domElement; if (canvas) canvas.style.visibility = 'hidden';
    editor.projectSync.stop(); editor.clearObjectClipboard();
    if (editor.sceneGuide) editor.sceneGuide.close();
    if (editor.monitorWidgets) editor.monitorWidgets.close();
    if (editor.sceneCreationDialog) editor.sceneCreationDialog.dispose();
    if (editor.sharePanel) { editor.sharePanel.hidden = true; if (editor.sharing && editor.sharing.host) { editor.sharing.host.remove(); editor.sharing.host = null; } if (editor.shareLinkInput) editor.shareLinkInput.value = ''; }
    if (editor.projectLibrary) { const library = editor.projectLibrary; library.close(); library.projects = []; library.selected = null; if (library.list) library.list.textContent = ''; if (library.details) library.details.textContent = ''; }
    if (editor.projectTabs) editor.projectTabs.syncIdentity();
    if (editor.active) editor.leave();
    if (editor.returnButton) editor.returnButton.hidden = true;
    try { if (!user || options.reload) {
      // Hide a previous identity's world immediately, before the network read.
      editor.document.rooms.forEach(entry => { if (entry.root) entry.root.visible = false; });
      await this.loadPublic();
    } else if (editor.editorEnabled && !options.preserveWorld) {
      const parameters = new URL(window.location).searchParams;
      if (!this.requestedProjectId) { parameters.delete('scene'); parameters.delete('libraryScene'); if (/^(public-|library-)/.test(parameters.get('project') || '')) parameters.delete('project'); }
      await this.initialize(parameters);
    }
    if (canvas) canvas.style.visibility = '';
    } catch (error) { editor.accessLoadFailed = true; throw error; }
  }
  disposeGallery() {
    this.galleryGeneration = (this.galleryGeneration || 0) + 1;
    if (this.sceneLibrary) this.sceneLibrary.dispose(); this.sceneLibrary = null;
  }
  async gallery(host, studio) {
    this.disposeGallery(); const generation = this.galleryGeneration, scope = this.identityGeneration;
    const publicCatalog = await this.publicCatalog();
    if (!host.isConnected || generation !== this.galleryGeneration || scope !== this.identityGeneration) return;
    const entries = (publicCatalog.scenes || []).map(scene => ({scene, included: false}));
    if (studio.client.user && !publicCatalog.previewAllExamples) {
      const result = await this.editor.projectClient.request('GET', '/library/scenes');
      if (!host.isConnected || generation !== this.galleryGeneration || scope !== this.identityGeneration) return;
      (result.scenes || []).forEach(scene => { if (!entries.some(value => value.scene.id === scene.id)) entries.push({scene, included: true}); });
    }
    this.sceneLibrary = new PublicSceneLibrary(host, studio, entries, {
      currentId: this.editor.currentProject && (this.editor.currentProject.publicSceneId || this.editor.currentProject.librarySceneId),
      requiresLogin: !studio.client.user && !this.staticPublic && !publicCatalog.previewAllExamples,
      open: async (entry, library) => {
        if (library.disposed || generation !== this.galleryGeneration || scope !== this.identityGeneration) return;
        const scene = entry.scene, current = this.editor.currentProject;
        if (current && (current.publicSceneId === scene.id || current.librarySceneId === scene.id)) { studio.close(); return; }
        const result = entry.included ? await this.editor.projectClient.request('GET', '/library/scenes/' + encodeURIComponent(scene.id)) : await this.publicProject(scene.id);
        if (library.disposed || !host.isConnected || generation !== this.galleryGeneration || scope !== this.identityGeneration) return;
        if (this.editor.active) await this.editor.leave();
        if (library.disposed || generation !== this.galleryGeneration || scope !== this.identityGeneration) return;
        await this.editor.applyServerProject(result.project, {roomId: scene.roomId, accessGeneration: scope});
        if (!library.disposed && generation === this.galleryGeneration && scope === this.identityGeneration) studio.close();
      }
    });
    this.sceneLibrary.focus(); return this.sceneLibrary;
  }
}
