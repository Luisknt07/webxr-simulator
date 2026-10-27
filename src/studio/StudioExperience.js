import * as THREE from 'three';
import StudioClient, {StudioRoomConnection} from './StudioClient.js';
import StudioTools from './StudioTools.js';
import EducationRuntime from './EducationRuntime.js';
import {createAvatar, avatarBadge, DEFAULT_AVATAR} from './Avatar.js';
import {captureSimulation, restoreSimulation} from './SimulationCheckpoint.js';
import SharedGrabs from './SharedGrabs.js';
import RemotePresentation from './RemotePresentation.js';
import AdminWorkspace from './AdminWorkspace.js';
import ImmersiveStudioMenu from './ImmersiveStudioMenu.js';

const ROOM_IDS = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];
function el(tag, text, parent, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; if (parent) parent.appendChild(node); return node; }
function button(parent, text, action, className) { const node = el('button', text, parent, className); node.type = 'button'; node.addEventListener('click', action); return node; }
function input(parent, label, type = 'text', value = '') { const row = el('label', label, parent), node = el('input', undefined, row); node.type = type; node.value = value; return node; }
function select(parent, label, options, value) { const row = el('label', label, parent), node = el('select', undefined, row); options.forEach(option => { const item = el('option', option.label || option, node); item.value = option.value || option; }); node.value = value; return node; }

export default class StudioExperience {
  constructor(editor, vrButton) {
    this.editor = editor; this.ctx = editor.ctx; this.client = new StudioClient(); this.ctx.studio = this;
    this.client.onSessionChange = error => this.invalidateAccount(error);
    editor.projectClient.identityProvider = () => this.client.user && this.client.user.id;
    editor.projectClient.onSessionChange = error => this.invalidateAccount(error);
    this.tools = new StudioTools(editor); this.education = new EducationRuntime(editor, this.client); this.administration = new AdminWorkspace(this); this.avatars = new Map(); this.roomRevision = 0;
    this.originalEnter = editor.enter.bind(editor);
    editor.enter = () => { if (this.room) { this.message('Sal de la sala compartida para editar el proyecto.'); return; } if (this.client.configured && (!this.client.user || !this.client.user.permissions.editor)) { this.open('account'); return; } this.close(); return this.originalEnter(); };
    this.build(vrButton); this.bindSimulation(); this.sharedGrabs = new SharedGrabs(this); this.presentation = new RemotePresentation();
    this.immersiveMenu = new ImmersiveStudioMenu(this);
    const startRuntime = editor.startRuntime.bind(editor);
    editor.startRuntime = () => { if (this.sharedGrabs) this.sharedGrabs.detach(); startRuntime(); this.applySpawn(); };
    const applyProject = editor.applyServerProject.bind(editor);
    editor.applyServerProject = async (project, ...options) => {
      await this.education.saveProgress();
      if (this.client.user && this.education.pending.size && editor.currentProject && editor.currentProject.id !== project.id) throw new Error('El progreso está pendiente de guardar. Reintenta desde Mi progreso antes de cambiar de proyecto.');
      const result = await applyProject(project, ...options); this.tools.refreshLabels(); await this.education.restoreProgress(); return result;
    };
    this.ready = this.initialize();
    window.addEventListener('pagehide', () => { this.connection.stop(); this.education.saveProgress(); });
    this.connection = new StudioRoomConnection(this.client, {interval: 250, getPose: () => this.pose(), onRoom: room => this.receiveRoom(room), onEvents: (events, room) => this.applyEvents(events, room), onError: error => { this.roomError = error.message; this.message('Sala: ' + error.message); }});
  }
  async initialize() {
    try {
      const identity = this.editor.initialIdentity ? await Promise.resolve(this.editor.initialIdentity) : await this.client.me();
      if (identity) { this.client.user = identity.user || null; this.client.capabilities = identity.capabilities; this.client.configured = identity.configured; }
      this.online = !(identity && identity.staticPublic);
      if (identity && identity.staticPublic) this.connectionError = 'Esta publicación pública es estática. Las cuentas, proyectos privados y sesiones compartidas requieren el servidor de Studio.';
    }
    catch (error) { this.online = false; this.connectionError = error.message; }
    if (this.client.configured && (!this.client.user || !this.client.user.permissions.editor) && this.editor.active) { this.editor.leave(); this.open('account'); }
    this.identity();
    const studio = this.editor.document.studio;
    const requestedRoom = new URL(window.location).searchParams.get('room');
    if (!this.editor.editorEnabled && !ROOM_IDS.includes(requestedRoom) && studio && ROOM_IDS.includes(studio.startRoomId) && ROOM_IDS.indexOf(studio.startRoomId) !== this.ctx.room) await this.editor.hooks.gotoRoom(ROOM_IDS.indexOf(studio.startRoomId));
    this.tools.refreshLabels(); await this.education.restoreProgress().catch(error => this.message(error.message));
    this.applySpawn();
    const invitation = new URL(window.location).searchParams.get('room');
    if (invitation && !ROOM_IDS.includes(invitation) && this.client.user) await this.joinRoom(invitation);
  }
  identity() {
    this.education.accountChanged();
    this.applyPreferences();
    this.identityData = {user: this.client.user}; this.user = this.client.user;
    if (this.editor.accessView) this.editor.accessView.user = this.client.user || null;
    if (this.editor.projectTabs) this.editor.projectTabs.syncIdentity();
    this.accountButton.textContent = ''; if (this.client.user) { this.accountButton.appendChild(avatarBadge(this.client.user.avatar)); this.accountButton.appendChild(document.createTextNode(this.client.user.displayName)); }
    else this.accountButton.textContent = this.editor.staticPublic ? 'Vista pública' : 'Iniciar sesión';
    if (this.editor.shell) this.editor.shell.refresh();
    if (this.immersiveMenu) this.immersiveMenu.identityChanged();
  }
  applyPreferences(value) {
    let preferences = value || this.client.user && this.client.user.preferences;
    if (!preferences) { try { preferences = JSON.parse(localStorage.getItem('hello-studio-preferences') || 'null'); } catch (_) { /* Preferences are optional. */ } }
    preferences = preferences || {handedness: this.ctx.handedness || 'right', locomotion: 'smooth'};
    const explicit = new URL(window.location).searchParams.get('handedness');
    const hand = !value && ['left', 'right'].includes(explicit) ? explicit : preferences.handedness;
    if (['left', 'right'].includes(hand)) {
      if (this.ctx.raycontrol && this.ctx.raycontrol.changeHandedness) this.ctx.raycontrol.changeHandedness(hand);
      if (this.ctx.desktopControllerData && this.ctx.desktopControllerData.inputSource) this.ctx.desktopControllerData.inputSource.handedness = hand;
      this.ctx.handedness = hand;
    }
    this.ctx.studioLocomotion = ['teleport', 'smooth'].includes(preferences.locomotion) ? preferences.locomotion : 'smooth';
  }
  async reconnectAccountService() {
    if (this.accountServicePending) return this.accountServicePending;
    const editor = this.editor, client = this.client, user = client.user || null;
    const epoch = this.accountServiceEpoch || 0, accessEpoch = editor.accessView && editor.accessView.identityGeneration;
    const current = () => (this.accountServiceEpoch || 0) === epoch && !this.loggingOut && !client.logoutPending && !client.authenticationPending &&
      (client.user || null) === user && (!editor.accessView || editor.accessView.identityGeneration === accessEpoch);
    const stale = () => Object.assign(new Error('La cuenta cambió durante la conexión. Vuelve a abrir el acceso.'), {code: 'session_changed'});
    const pending = (async () => {
      if (!current()) throw stale();
      const origin = new URL(window.location.href).origin;
      for (const base of [client.base || '/api/studio', editor.projectClient && editor.projectClient.base || '/api']) {
        if (new URL(base, window.location.href).origin !== origin) throw new Error('Las cuentas deben conectarse al mismo servidor de esta aplicación.');
      }
      // Use the pure request: checkStorageHealth()/health() also mutate live
      // upload capabilities before identity or stale-response checks finish.
      const health = await editor.projectClient.request('GET', '/health');
      if (!current()) throw stale();
      if (!health || health.storage !== 'sqlite' || !health.capabilities || health.capabilities.privateProjects !== true) throw new Error('Este sitio no ofrece el servidor de cuentas de Studio.');
      // A separate read-only client cannot resurrect the live user when a
      // delayed /me response arrives after logout or another login.
      const probe = new StudioClient(client.base || '/api/studio'); probe.user = user;
      const identity = await probe.me();
      if (!current()) throw stale();
      if (!identity || typeof identity.configured !== 'boolean' || !Object.prototype.hasOwnProperty.call(identity, 'user') ||
        identity.user !== null && (!identity.user || typeof identity.user.id !== 'string' || !identity.user.permissions || typeof identity.user.permissions !== 'object')) throw new Error('El servidor no devolvió una identidad de Studio válida.');
      if (user && (!identity.user || identity.user.id !== user.id)) throw stale();
      editor.serverCapabilities = health.capabilities; editor.serverLimits = health.limits || {}; editor.storageAvailable = true;
      if (editor.projectClient) { editor.projectClient.assetUploadAvailable = health.capabilities.assetUpload === true; if (health.limits && Number.isSafeInteger(health.limits.maxAssetBytes) && health.limits.maxAssetBytes > 0) editor.projectClient.maxAssetBytes = health.limits.maxAssetBytes; }
      editor.staticPublic = false; editor.initialIdentity = identity;
      client.user = identity.user; client.configured = identity.configured; client.capabilities = identity.capabilities;
      this.online = true; this.connectionError = '';
      if (identity.user) await this.authenticated({immersive: true});
      else if (this.accountButton) this.accountButton.textContent = 'Iniciar sesión';
      return {online: true, user: client.user, identity};
    })();
    this.accountServicePending = pending;
    try { return await pending; }
    finally { if (this.accountServicePending === pending) this.accountServicePending = null; }
  }
  clearAccountContext() {
    this.accountServiceEpoch = (this.accountServiceEpoch || 0) + 1;
    const editor = this.editor;
    if (this.administration) this.administration.close();
    if (this.connection) this.connection.stop(); if (this.sharedGrabs) this.sharedGrabs.detach(); if (this.presentation) this.presentation.clear();
    this.room = null; this.roomRevision = 0; this.pendingRoomState = null; this.client.user = null;
    if (this.drawer) { this.close(); this.drawer.textContent = ''; this.content = null; }
    this.avatars.forEach(avatar => { if (avatar.parent) avatar.parent.remove(avatar); avatar.userData.dispose(); }); this.avatars.clear();
    if (editor.active) editor.leave();
    if (editor.projectSync) editor.projectSync.stop(); if (editor.clearObjectClipboard) editor.clearObjectClipboard();
    this.education.accountChanged();
    // Hide the previous identity's private world before any network request.
    if (editor.accessView && editor.accessView.enabled && editor.document.rooms) editor.document.rooms.forEach(entry => { if (entry.root) entry.root.visible = false; });
    const reset = editor.accessView && editor.accessView.enabled ? editor.accessView.accountChanged(null) : Promise.resolve();
    this.identity(); return reset;
  }
  async authenticated(options = {}) {
    const editor = this.editor, user = this.client.user;
    if (editor.accessView && editor.accessView.enabled) await editor.accessView.accountChanged(user, {preserveWorld: Boolean(options.immersive || this.ctx.vrMode)});
    this.identity(); await this.education.restoreProgress();
  }
  async logout() {
    // Dispatch with the old account header, then immediately remove private UI.
    this.loggingOut = true;
    try { const request = this.client.logout(), reset = this.clearAccountContext(); this.close(); await Promise.all([request, reset]); this.identity(); this.message('Sesión cerrada.'); }
    finally { this.loggingOut = false; }
  }
  invalidateAccount(error) {
    if (this.invalidating || this.loggingOut) return;
    this.invalidating = true;
    Promise.resolve(this.clearAccountContext()).then(() => this.client.me()).then(async () => { await this.authenticated(); this.open('account'); }).catch(() => this.open('account')).finally(() => { this.invalidating = false; this.message(error && error.message || 'La sesión cambió.'); });
  }
  applySpawn(force = false) {
    if (this.editor.active || this.ctx.vrMode && !force || this.room) return;
    const spawn = (this.editor.document.studio && this.editor.document.studio.spawns || []).find(item => item.roomId === this.editor.roomId);
    const marker = spawn && this.editor.document.getObject(spawn.objectId); if (!marker) return;
    marker.updateWorldMatrix(true, false);
    const position = marker.getWorldPosition(new THREE.Vector3());
    if (!this.ctx.vrMode) { this.ctx.camera.position.set(0, 1.6, 0); this.ctx.camera.quaternion.set(0, 0, 0, 1); }
    this.ctx.cameraRig.position.copy(position); this.ctx.cameraRig.quaternion.copy(marker.getWorldQuaternion(new THREE.Quaternion()));
  }
  build(vrButton) {
    this.header = el('nav', undefined, document.body, 'studio-header'); this.header.setAttribute('aria-label', 'HELLO Studio');
    const brand = el('a', undefined, this.header, 'studio-brand'); brand.href = '/'; el('strong', 'HELLO', brand); el('span', '/ STUDIO', brand);
    const actions = el('div', undefined, this.header, 'studio-header-actions'); this.accountButton = button(actions, 'Iniciar sesión', () => this.open(this.client.user ? 'personal' : 'account'), 'studio-account');
    this.flightButton = button(actions, 'Vuelo dron', () => this.setDesktopFlight(!this.ctx.desktopFlight), 'studio-flight');
    this.flightButton.setAttribute('aria-pressed', 'false'); this.flightButton.title = 'Volar en escritorio · WASD · Q subir · E bajar · Ctrl acelerar';
    if (this.editor.appendAudioControls) this.editor.appendAudioControls(actions);
    actions.appendChild(vrButton); vrButton.classList.add('studio-vr');
    this.menuButton = button(actions, 'Menú ☰', () => this.drawer.hidden ? this.open('personal') : this.close()); this.menuButton.setAttribute('aria-expanded', 'false');
    this.shade = el('div', undefined, document.body, 'studio-shade'); this.shade.hidden = true; this.shade.addEventListener('click', () => this.close());
    this.drawer = el('aside', undefined, document.body, 'studio-drawer'); this.drawer.hidden = true; this.drawer.setAttribute('role', 'dialog'); this.drawer.setAttribute('aria-label', 'Mi espacio'); this.drawer.setAttribute('aria-modal', 'true');
    this.drawer.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') this.close(); if (event.key === 'Tab') { const buttons = Array.from(this.drawer.querySelectorAll('button,input,select,a')).filter(node => !node.disabled && !node.hidden); const first = buttons[0], last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } });
    this.notice = el('output', undefined, document.body, 'studio-notice'); this.notice.hidden = true;
    this.controls = button(document.body, '⌘ Controles', () => this.open('controls'), 'studio-controls');
    this.controls.hidden = true;
    this.contextHint = el('output', undefined, document.body, 'studio-context'); this.contextHint.hidden = true;
  }
  message(text) { this.notice.textContent = text; this.notice.hidden = false; clearTimeout(this.noticeTimer); this.noticeTimer = setTimeout(() => { this.notice.hidden = true; }, 6500); }
  setDesktopFlight(enabled) {
    if (this.ctx.vrMode) return;
    this.editor.hooks.clearKeyboard(); this.ctx.desktopFlight = Boolean(enabled);
    if (this.ctx.desktopLook && this.ctx.desktopLook.reset) this.ctx.desktopLook.reset();
    if (this.flightButton) { this.flightButton.setAttribute('aria-pressed', String(this.ctx.desktopFlight)); this.flightButton.textContent = this.ctx.desktopFlight ? 'Vuelo dron · activo' : 'Vuelo dron'; }
    const touch = this.ctx.mobileNavigation && this.ctx.mobileNavigation.active;
    this.message(this.ctx.desktopFlight ? touch ? 'Vuelo táctil: usa Subir y Bajar. El mando izquierdo avanza en la dirección de la cámara.' : 'Vuelo dron · WASD para avanzar y desplazar · Q subir · E bajar · Ctrl acelerar · clic para mirar · Esc libera el mouse.' : 'Vuelo dron desactivado. Se mantiene tu posición y el modo de desplazamiento elegido en Ajustes.');
  }
  async guard(action) { if (this.busy) return; this.busy = true; try { return await action(); } catch (error) { this.message(error.message); } finally { this.busy = false; } }
  close() { if (this.graphicsSettings) { this.graphicsSettings.dispose(); this.graphicsSettings = null; } if (this.avatarCleanup) { this.avatarCleanup(); this.avatarCleanup = null; } this.drawer.hidden = true; this.shade.hidden = true; this.menuButton.setAttribute('aria-expanded', 'false'); this.menuButton.focus(); }
  open(page = 'personal') {
    if (this.ctx.vrMode && this.immersiveMenu) {
      if (this.administration) this.administration.close();
      // Delayed account/network events may change an already open menu, but
      // only the controller shortcut opens it while the user is in the world.
      if (this.immersiveMenu.opened) return this.immersiveMenu.open(page === 'personal' ? 'home' : page);
      return;
    }
    if (page === 'users' && this.client.user && this.client.user.permissions.manageUsers && this.administration.openModal) return this.guard(() => this.users());
    if (this.administration) this.administration.close();
    if (!this.client.user && ['avatar', 'sessions', 'rooms', 'progress', 'users', 'classroom'].includes(page)) page = 'account';
    this.editor.hooks.unlock(); this.editor.hooks.clearKeyboard(); this.close(); this.page = page; this.drawer.textContent = ''; this.drawer.hidden = false; this.shade.hidden = false; this.menuButton.setAttribute('aria-expanded', 'true');
    const head = el('div', undefined, this.drawer, 'studio-drawer-head'); el('h1', ({account: this.client.user ? 'Mi cuenta' : 'Iniciar sesión', avatar: 'Mi avatar', sessions: 'Sesiones guardadas', rooms: 'Sesiones multiusuario', progress: 'Mi progreso', settings: 'Ajustes', controls: 'Controles', scenes: 'Escenarios', classroom: 'Mis prácticas', users: 'Administración'})[page] || 'Mi espacio', head); const closer = button(head, '×', () => this.close()); closer.setAttribute('aria-label', 'Cerrar panel');
    this.content = el('div', undefined, this.drawer, 'studio-drawer-content');
    if (page === 'account') this.account(); else if (page === 'avatar') this.avatar(); else if (page === 'sessions') this.guard(() => this.sessions()); else if (page === 'rooms') this.rooms(); else if (page === 'progress') this.progress(); else if (page === 'settings') this.settings(); else if (page === 'controls') this.help(); else if (page === 'users') this.guard(() => this.users()); else if (page === 'classroom') this.guard(() => this.classroom()); else if (page === 'scenes') this.guard(() => this.scenes()); else this.personal();
    closer.focus();
  }
  needAccount() { if (!this.client.user) { this.open('account'); this.message('Inicia sesión para sincronizar esta información.'); return true; } return false; }
  personal() {
    const content = this.content, user = this.client.user;
    const identity = el('div', undefined, content, 'studio-person'); identity.appendChild(avatarBadge(user ? user.avatar : DEFAULT_AVATAR)); el('strong', user ? user.displayName : 'Invitado', identity);
    el('p', user ? 'Perfil guardado en este servidor de Studio.' : 'Puedes explorar. Inicia sesión para guardar progreso y participar en salas.', content, 'studio-muted');
    if (user && this.editor.simulationPaused && !this.room) button(content, '▶ Reanudar simulación', () => { this.editor.simulationPaused = false; this.close(); }, 'studio-primary');
    button(content, '▦   Escenarios   ›', () => this.open('scenes'), 'studio-action');
    const entries = user ? [['◎', 'Mi avatar', 'avatar'], ['♧', 'Sesiones multiusuario', 'rooms'], ['▣', 'Sesiones guardadas', 'sessions'], ['▥', 'Mi progreso', 'progress'], ['▤', 'Mis prácticas y evaluaciones', 'classroom']] : [];
    entries.forEach(([icon, label, page]) => button(content, icon + '   ' + label + '   ›', () => this.open(page), 'studio-action'));
    el('hr', undefined, content);
    if (user && user.permissions.editor) button(content, '◇   Mis proyectos   ›', () => this.guard(() => this.openProjects()), 'studio-action');
    button(content, '⚙   Ajustes   ›', () => this.open('settings'), 'studio-action');
    if (user && user.permissions.manageUsers) button(content, '♙   Administración   ›', () => this.open('users'), 'studio-action');
    button(content, '?   Controles y ayuda   ›', () => this.open('controls'), 'studio-action');
    if (user) {
      const quota = user.quota || {}; el('p', 'Cuota: ' + (quota.maxProjects === undefined ? 2 : quota.maxProjects) + ' proyectos · ' + Number(((quota.storageBytes === undefined ? 20971520 : quota.storageBytes) / 1048576).toFixed(1)) + ' MiB. El administrador puede ampliarla.', content, 'studio-muted');
      el('p', 'Los archivos de cuentas normales se eliminan tras más de 30 días sin ingresar.', content, 'studio-muted');
      button(content, 'Cerrar sesión', () => this.guard(() => this.logout()));
    }
    else button(content, 'Iniciar sesión', () => this.open('account'), 'studio-primary');
  }
  openEditor() { if (this.needAccount()) return; if (!this.client.user.permissions.editor) { this.message('Tu cuenta no tiene permiso de edición.'); return; } if (this.editor.editorEnabled) { this.close(); return this.editor.enter(); } const url = new URL('/editor', window.location), project = this.editor.currentProject; if (project && project.id && !/^(public-|library-)/.test(project.id) && (!project.access || project.access.canEdit === true)) { url.searchParams.set('project', project.id); if (ROOM_IDS.includes(this.editor.roomId)) url.searchParams.set('room', this.editor.roomId); } window.location.assign(url.href); }
  async openProjects() {
    if (this.needAccount()) return;
    if (!this.editor.editorEnabled) return this.openEditor();
    const access = this.editor.accessView;
    if (access && access.enabled && !access.canEdit()) await access.initialize(new URLSearchParams());
    await this.openEditor(); if (this.editor.projectLibrary) this.editor.projectLibrary.open();
  }
  async scenes() {
    const content = this.content, access = this.editor.accessView;
    if (access && access.enabled) return access.gallery(content, this);
    el('p', 'El catálogo público requiere el servidor de proyectos. Puedes explorar el escenario actual.', content, 'studio-muted');
  }
  account(register = false) {
    if (this.client.user) { this.personal(); return; }
    if (this.editor.staticPublic) {
      el('p', this.connectionError, this.content, 'studio-muted');
      button(this.content, 'Explorar escenarios públicos', () => this.open('scenes'), 'studio-primary');
      return;
    }
    const form = el('form', undefined, this.content, 'studio-form');
    el('p', register ? 'Crea una cuenta en este servidor. Los proyectos existentes se conservan.' : 'Tu ubicación en el escenario se conserva al iniciar sesión.', form, 'studio-muted');
    if (!this.online) el('p', this.connectionError || 'Cuentas no disponibles en esta copia estática.', form, 'studio-error');
    const username = input(form, 'Usuario', 'text'); username.autocomplete = 'username'; username.required = true;
    const displayName = register ? input(form, 'Nombre visible', 'text') : null;
    const code = register ? input(form, 'Código del docente o de registro · si lo recibiste', 'text') : null;
    if (code) { code.autocomplete = 'off'; code.maxLength = 80; }
    const password = input(form, 'Contraseña', 'password'); password.autocomplete = register ? 'new-password' : 'current-password'; password.required = true; password.minLength = 12;
    if (register) el('p', 'Usa al menos 12 caracteres. Tu cuenta incluye hasta 2 proyectos privados y 20 MiB. Tras más de 30 días sin ingresar se eliminan sus archivos. El docente puede proporcionarte un código de registro.', form, 'studio-muted');
    const submit = el('button', register ? 'Crear cuenta' : 'Entrar', form, 'studio-primary'); submit.type = 'submit'; submit.disabled = !this.online;
    form.addEventListener('submit', event => { event.preventDefault(); this.guard(async () => { if (register) await this.client.register(username.value, password.value, displayName.value || username.value, code.value); else await this.client.login(username.value, password.value); password.value = ''; if (code) code.value = ''; await this.client.me(); await this.authenticated(); this.open('personal'); if (this.editor.editorEnabled && this.client.user.permissions.editor) this.editor.enter(); }); });
    button(this.content, register ? 'Ya tengo una cuenta' : 'Crear una cuenta', () => { this.content.textContent = ''; this.account(!register); });
  }
  async users() {
    if (this.needAccount()) return;
    if (!this.client.user.permissions.manageUsers) throw new Error('Esta cuenta no administra los permisos.');
    return this.administration.openModal ? this.administration.openModal() : this.administration.open(this.content);
  }
  beforeImmersiveMenuOpen() {
    this.close();
    if (this.administration) this.administration.close();
    if (this.editor.simulation && this.editor.simulation.onInputModeChange) this.editor.simulation.onInputModeChange();
    if (this.ctx.editorXylophone && this.ctx.editorXylophone.releaseHeld) this.ctx.editorXylophone.releaseHeld();
    if (this.ctx.teleport) { this.ctx.teleport.onHoverLeave(); this.ctx.teleport.active = false; }
    this.ctx.goto = null;
  }
  onVRChange(active) {
    if (active) {
      this.close(); if (this.administration) this.administration.close();
      this.editor.projectLibrary.close();
      if (this.editor.sceneGuide) this.editor.sceneGuide.close();
      if (this.editor.monitorWidgets) this.editor.monitorWidgets.close();
      if (this.editor.sceneCreationDialog) this.editor.sceneCreationDialog.dispose();
      if (this.editor.sharePanel) this.editor.sharePanel.hidden = true;
      if (this.editor.conveyorViewer && this.editor.conveyorViewer.close) this.editor.conveyorViewer.close();
      if (this.editor.simulationPanel) this.editor.simulationPanel.toggle(false);
      if (this.editor.shell) {
        this.editor.shell.closeMenus();
        if (this.editor.shell.sceneCatalog) this.editor.shell.sceneCatalog.close();
      }
      document.querySelectorAll('.ed-scene-name-dialog[open]').forEach(dialog => dialog.dispatchEvent(new Event('cancel', {cancelable: true})));
    }
    if (this.immersiveMenu) this.immersiveMenu.setVR(active);
  }
  async classroom() {
    if (this.needAccount()) return;
    const content = this.content, userId = this.client.user.id, result = await this.client.classroom();
    if (this.content !== content || !this.client.user || this.client.user.id !== userId) return;
    const groups = result.groups || [];
    if (!groups.length) el('p', 'Todavía no perteneces a un grupo de prácticas. El docente puede agregarte con tu usuario.', content, 'studio-muted');
    groups.forEach(group => {
      el('h2', group.name, content); if (group.description) el('p', group.description, content, 'studio-muted');
      group.assignments.forEach(assignment => {
        const card = el('article', undefined, content, 'studio-card'); el('strong', assignment.title, card); el('p', assignment.instructions, card);
        if (assignment.dueAt) el('p', 'Entrega: ' + new Date(assignment.dueAt).toLocaleString(), card, 'studio-muted');
        if (assignment.evaluation) { el('p', 'Calificación: ' + assignment.evaluation.score + ' / 100', card); if (assignment.evaluation.feedback) el('p', assignment.evaluation.feedback, card); }
        else el('p', 'Sin evaluación del docente.', card, 'studio-muted');
        if (assignment.projectAccessible) button(card, 'Abrir proyecto de la práctica', () => this.guard(async () => { const project = await this.editor.projectClient.getProject(assignment.projectId); if (this.editor.editorEnabled && (!project.access || project.access.canEdit)) await this.editor.openServerProject(project); else { if (this.editor.active) this.editor.leave(); await this.editor.applyServerProject(project); } this.close(); }));
        if (assignment.templateId) el('p', 'Ejemplo de referencia: ' + assignment.templateId, card, 'studio-muted');
      });
    });
  }
  avatar() {
    if (this.needAccount()) return;
    const user = this.client.user, config = Object.assign({}, user.avatar), content = this.content;
    el('p', 'Avatar 3D para salas compartidas. La imagen de perfil se mantiene por separado.', content, 'studio-muted');
    const preview = el('div', undefined, content, 'studio-avatar-preview'); const renderer = new THREE.WebGLRenderer({alpha: true, antialias: true}); renderer.setPixelRatio(1); renderer.setSize(340, 260); renderer.outputEncoding = THREE.sRGBEncoding; preview.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 340 / 260, 0.1, 20); camera.position.set(1.3, 0, -2.2); camera.lookAt(0, -0.55, 0); scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.5)); let avatar = null;
    const render = () => { if (avatar) { scene.remove(avatar); avatar.userData.dispose(); } avatar = createAvatar(config); scene.add(avatar); renderer.render(scene, camera); }; render();
    const base = select(content, 'Avatar base', ['capsule', 'robot', 'explorer'], config.base); base.addEventListener('change', () => { config.base = base.value; render(); });
    [['bodyColor', 'Cuerpo'], ['accentColor', 'Detalles'], ['skinColor', 'Cabeza']].forEach(([key, label]) => { const control = input(content, label, 'color', config[key]); control.addEventListener('input', () => { config[key] = control.value; render(); }); });
    button(content, 'Guardar avatar', () => this.guard(async () => { await this.client.updateProfile({avatar: config}); this.identity(); this.message('Avatar guardado en tu perfil.'); }), 'studio-primary');
    const displayName = input(content, 'Nombre visible', 'text', user.displayName); button(content, 'Guardar nombre', () => this.guard(async () => { await this.client.updateProfile({displayName: displayName.value}); this.identity(); this.message('Nombre guardado.'); }));
    this.avatarCleanup = () => { avatar.userData.dispose(); renderer.dispose(); };
  }
  async sessions() {
    if (this.needAccount()) return;
    const content = this.content;
    el('p', 'Las sesiones reanudan una ejecución y su posición. Guardar proyecto conserva la configuración del editor.', content, 'studio-muted');
    button(content, 'Guardar ejecución actual', () => this.guard(() => this.saveSession()), 'studio-primary');
    const checkpoints = await this.client.listCheckpoints(); if (this.content !== content) return;
    if (!checkpoints.length) el('p', 'Todavía no hay ejecuciones guardadas.', content);
    checkpoints.forEach(checkpoint => { const card = el('div', undefined, content, 'studio-card'); el('strong', checkpoint.name, card); el('p', new Date(checkpoint.createdAt).toLocaleString() + ' · revisión ' + checkpoint.projectRevision, card, 'studio-muted'); button(card, 'Reanudar', () => this.guard(async () => { const saved = await this.client.getCheckpoint(checkpoint.id); await this.loadExecution(saved.projectId, saved.projectRevision, saved.roomId, saved.state); this.close(); this.message('Ejecución reanudada.'); }), 'studio-primary'); button(card, 'Eliminar sesión', () => this.guard(async () => { await this.client.deleteCheckpoint(checkpoint.id); this.open('sessions'); })); });
  }
  captureExecution(shared = false) {
    if (this.editor.active) throw new Error('Pulsa Probar antes de guardar una ejecución.');
    if (!this.editor.currentProject || this.editor.dirty) throw new Error('Guarda primero la configuración del proyecto.');
    if (/^(public-|library-)/.test(this.editor.currentProject.id) || ['public', 'template'].includes(this.editor.currentProject.access && this.editor.currentProject.access.role)) throw new Error('Crea un proyecto propio desde este ejemplo antes de guardar una ejecución o crear una sala.');
    return {format: 'hello-studio-execution', version: 1, simulation: captureSimulation(this.editor.simulation, {allowHeld: shared, analyticsHistorySamples: shared ? 2 : undefined}), paused: !!this.editor.simulationPaused,
      camera: {position: this.ctx.cameraRig.position.toArray(), quaternion: this.ctx.cameraRig.quaternion.toArray(),
        headPosition: this.ctx.camera ? this.ctx.camera.position.toArray() : undefined, headQuaternion: this.ctx.camera ? this.ctx.camera.quaternion.toArray() : undefined}};
  }
  async saveSession() {
    if (this.needAccount()) return;
    if (this.room) throw new Error('Sal de la sala para guardar una sesión individual. El anfitrión puede guardar el estado compartido desde Salas.');
    const project = this.editor.currentProject, state = this.captureExecution();
    const name = window.prompt('Nombre de la sesión', project.name + ' · ' + new Date().toLocaleTimeString()); if (!name) return;
    this.message('Guardando ejecución…'); await this.client.saveCheckpoint({name, projectId: project.id, projectRevision: project.revision, roomId: this.editor.roomId, version: 1, state}); this.message('Ejecución guardada en SQLite.'); if (this.page === 'sessions') this.open('sessions');
  }
  async loadExecution(projectId, revision, roomId, state) {
    if (this.room) throw new Error('Sal de la sala compartida antes de reanudar otra ejecución.');
    if (!state || state.format !== 'hello-studio-execution' || state.version !== 1) throw new Error('La sesión usa un formato incompatible.');
    const project = await this.editor.projectClient.getProject(projectId);
    if (project.revision !== revision) throw new Error('El proyecto cambió desde esta sesión. Restaura su revisión original antes de reanudar.');
    if (this.editor.dirty) await this.editor.keepCurrentProject();
    if (this.editor.active) this.editor.leave(); await this.editor.applyServerProject(project);
    const index = ROOM_IDS.indexOf(roomId); if (index < 0) throw new Error('Sala de la sesión no compatible.'); if (this.ctx.room !== index) await this.editor.hooks.gotoRoom(index);
    restoreSimulation(this.editor.simulation, state.simulation); this.editor.simulationPaused = !!state.paused;
    // A late join or resumed checkpoint must not award historical events again.
    if (this.education && this.education.seenEvents) (this.editor.simulation.events || []).forEach(event => this.education.seenEvents.add(event.id));
    if (state.camera && Array.isArray(state.camera.position) && state.camera.position.length === 3 && state.camera.position.every(Number.isFinite)) this.ctx.cameraRig.position.fromArray(state.camera.position);
    if (state.camera && Array.isArray(state.camera.quaternion) && state.camera.quaternion.length === 4 && state.camera.quaternion.every(Number.isFinite) && Math.abs(Math.hypot(...state.camera.quaternion) - 1) < 0.01) this.ctx.cameraRig.quaternion.fromArray(state.camera.quaternion).normalize();
    if (!this.ctx.vrMode && this.ctx.camera && state.camera) {
      if (Array.isArray(state.camera.headPosition) && state.camera.headPosition.length === 3 && state.camera.headPosition.every(Number.isFinite)) this.ctx.camera.position.fromArray(state.camera.headPosition);
      if (Array.isArray(state.camera.headQuaternion) && state.camera.headQuaternion.length === 4 && state.camera.headQuaternion.every(Number.isFinite) && Math.abs(Math.hypot(...state.camera.headQuaternion) - 1) < 0.01) this.ctx.camera.quaternion.fromArray(state.camera.headQuaternion).normalize();
    }
  }
  progress() {
    const content = this.content; el('p', this.education.progressStatus, content, 'studio-muted');
    this.education.missions().forEach(mission => { const progress = this.education.getProgress(mission), card = el('div', undefined, content, 'studio-card'); el('strong', mission.name, card); el('p', mission.description, card); const step = mission.steps[progress.step]; el('p', progress.status === 'completed' ? '✓ Completada' : progress.status === 'failed' ? '✕ Evaluación fallida' : step ? step.name + ' · ' + progress.count + ' / ' + step.target : progress.status, card); if (mission.help) el('p', mission.help, card, 'studio-muted'); if (this.education.incompatible.has(mission.id)) { el('p', 'La misión cambió: el avance guardado pertenece a otra versión.', card, 'studio-muted'); button(card, 'Reiniciar progreso para esta versión', () => this.guard(async () => { await this.education.resetMissionVersion(mission); this.open('progress'); })); } else if (progress.status !== 'active' && progress.status !== 'completed') button(card, 'Iniciar / reintentar', () => { this.education.startMission(mission); this.open('progress'); }); });
    if (!this.education.missions().length) el('p', 'Este escenario todavía no tiene misiones configuradas.', content);
    button(content, 'Guardar / reintentar', () => this.guard(async () => { await this.education.saveProgress(); this.open('progress'); }));
  }
  settings() {
    if (this.editor.appendGraphicsSettings) this.graphicsSettings = this.editor.appendGraphicsSettings(this.content);
    const prefs = this.client.user ? this.client.user.preferences : {handedness: this.ctx.handedness || 'right', locomotion: this.ctx.studioLocomotion || 'smooth'};
    const hand = select(this.content, 'Mano preferida', [{label: 'Derecha', value: 'right'}, {label: 'Izquierda', value: 'left'}], prefs.handedness);
    const movement = select(this.content, 'Desplazamiento', [{label: 'Caminar con teclado, táctil o stick izquierdo', value: 'smooth'}, {label: 'Solo teletransporte XR', value: 'teleport'}], prefs.locomotion);
    el('p', 'Los ajustes se aplican sin cambiar tu ubicación. El teletransporte utiliza los mandos y el suelo habilitado del escenario.', this.content, 'studio-muted');
    button(this.content, 'Aplicar ajustes', () => this.guard(async () => { const preferences = {handedness: hand.value, locomotion: movement.value}; if (this.client.user) await this.client.updateProfile({preferences}); this.applyPreferences(preferences); try { localStorage.setItem('hello-studio-preferences', JSON.stringify(preferences)); } catch (_) { /* Server profile remains durable. */ } const url = new URL(window.location); url.searchParams.set('handedness', hand.value); window.history.replaceState(null, '', url.href); this.message('Ajustes aplicados.'); }), 'studio-primary');
  }
  help() {
    if (this.editor.appendAudioControls) this.editor.appendAudioControls(this.content);
    el('p', 'Sonido: comienza con la primera interacción. El botón superior permite silenciarlo y el deslizador ajusta equipos y ambientes de este dispositivo, sin cambiar el escenario.', this.content, 'studio-muted');
    el('p', 'Escritorio: WASD o flechas para desplazarte. Haz clic en la vista para mirar con el mouse suavizado; Esc libera el mouse. Apunta con el círculo central y pulsa para interactuar o coger una caja. La rueda acerca o aleja una caja sostenida.', this.content);
    el('p', 'Pantalla táctil: usa el mando izquierdo para caminar y desliza el derecho para mirar. Apunta con el círculo central y pulsa Accionar. Coger / soltar y los botones de distancia permiten colocar una caja; en Vuelo aparecen Subir y Bajar.', this.content);
    el('p', 'Vehículos: apunta al vehículo y pulsa para subir, o acércate y pulsa F. WASD conduce; Q/E eleva; R/T inclina; Z/X retrae/extiende; J/L desplaza lateralmente; U/O gira la torreta. P alterna el freno; Espacio frena; G toma un pallet con las horquillas introducidas; K deposita; H bocina; F baja con el vehículo detenido. En móvil aparece una consola táctil. En VR: stick izquierdo conduce, derecho maneja la hidráulica; pulsa el stick derecho para cambiar de modo; grip derecho toma/deposita y B baja. La consola 3D permite encender, arrancar, frenar y rearmar. Las funciones disponibles dependen de cada tipología.', this.content);
    button(this.content, this.ctx.desktopFlight ? 'Desactivar vuelo dron' : 'Activar vuelo dron', () => { this.setDesktopFlight(!this.ctx.desktopFlight); this.open('controls'); }, 'studio-action');
    el('p', 'Vuelo dron: WASD avanza según la cámara, Q sube, E baja y Ctrl acelera. Conserva tu posición al cambiar de modo. El botón superior permite activarlo o volver al desplazamiento de Ajustes.', this.content);
    el('p', 'WebXR: stick izquierdo para caminar y derecho para girar 30°; centra el stick derecho entre giros. Apunta y pulsa el gatillo para accionar a distancia, o acerca la punta del mando al frente de un botón físico y retírala para volver a pulsarlo. El grip permite agarrar y soltar productos. Puedes teletransportarte apuntando al suelo habilitado con la mano preferida. X izquierdo o A derecho abren el menú; Salir de RV termina la sesión del visor. El seguimiento de manos sin mandos no está implementado.', this.content);
    el('p', 'Editor: Q sube, E baja. Botón derecho orbita, botón central desplaza y rueda acerca o aleja la cámara. Arrastrar un equipo mueve su línea conectada; Ctrl + arrastrar separa solo ese módulo. Shift + clic selecciona varios objetos. Espacio cambia entre mover, rotar y escalar.', this.content);
  }
  rooms() {
    if (this.needAccount()) return;
    const content = this.content;
    if (this.room) {
      el('strong', this.room.name, content); el('p', 'Código: ' + this.room.code, content, 'studio-room-code');
      el('p', 'Rol: ' + this.room.role + ' · ' + (this.roomError || 'Conectado'), content, 'studio-muted');
      const participants = el('div', undefined, content); this.participantList = participants; this.renderParticipants();
      button(content, 'Copiar invitación', () => this.guard(async () => { const url = new URL('/', window.location); url.searchParams.set('room', this.room.code); await navigator.clipboard.writeText(url.href); this.message('Invitación copiada.'); }));
      if (this.room.role === 'host') { button(content, 'Guardar estado de sala', () => this.guard(() => this.publishRoom()), 'studio-primary'); button(content, 'Pausar / reanudar sala', () => this.guard(() => this.connection.action({type: 'simulation', action: this.editor.simulationPaused ? 'resume' : 'pause'}))); button(content, 'Reiniciar sala', () => this.guard(() => this.connection.action({type: 'simulation', action: 'reset'}))); }
      el('p', 'Simulación compartida con autoridad del anfitrión. Los participantes pueden accionar controles y agarrar cargas con reserva exclusiva. Los observadores tienen acceso de lectura.', content, 'studio-muted');
      button(content, 'Salir de la sala', () => this.guard(async () => { await this.leaveRoom(); this.open('personal'); }));
      return;
    }
    el('p', 'Comparte la ejecución guardada del proyecto. El anfitrión mantiene abierta esta aplicación y controla el reloj.', content, 'studio-muted');
    button(content, 'Crear sala con este escenario', () => this.guard(async () => { const state = this.captureExecution(), project = this.editor.currentProject; const room = await this.client.createRoom({name: project.name, projectId: project.id, projectRevision: project.revision, roomId: this.editor.roomId, state}); await this.attachRoom(room); this.open('rooms'); }), 'studio-primary');
    const form = el('form', undefined, content, 'studio-form'), code = input(form, 'Código de invitación'); const role = select(form, 'Entrar como', [{label: 'Participante', value: 'participant'}, {label: 'Observador', value: 'observer'}], 'participant'); const submit = el('button', 'Unirse', form, 'studio-primary'); submit.type = 'submit'; form.addEventListener('submit', event => { event.preventDefault(); this.guard(async () => { await this.joinRoom(code.value, role.value); this.open('rooms'); }); });
  }
  async joinRoom(code, role) { const room = await this.client.joinRoom(code.trim(), role); await this.attachRoom(room); }
  async attachRoom(room) {
    if (this.room) await this.leaveRoom();
    await this.loadExecution(room.projectId, room.projectRevision, room.roomId, room.state);
    this.room = room; this.roomRevision = room.revision; this.editor.simulationPaused = room.role === 'host' ? !!room.state.paused : true; this.appliedEvents = new Set();
    this.connection.connect(room); this.lastPublish = performance.now(); this.editor.toast('Sala conectada · ' + room.code);
  }
  async leaveRoom() { if (this.sharedGrabs) this.sharedGrabs.detach(); if (this.presentation) this.presentation.clear(); await this.connection.leave(); this.room = null; this.roomRevision = 0; this.pendingRoomState = null; this.editor.simulationPaused = false; this.avatars.forEach(avatar => { if (avatar.parent) avatar.parent.remove(avatar); avatar.userData.dispose(); }); this.avatars.clear(); }
  pose() { if (!this.room) return null; const camera = this.ctx.camera; camera.updateWorldMatrix(true, false); return {position: camera.getWorldPosition(new THREE.Vector3()).toArray(), quaternion: camera.getWorldQuaternion(new THREE.Quaternion()).toArray()}; }
  async receiveRoom(room) {
    if (!this.room) return;
    const needsState = room.state && room.revision !== this.roomRevision;
    if (needsState && this.room.role !== 'host') { if (this.sharedGrabs && this.sharedGrabs.holding) this.pendingRoomState = room.state; else this.applyRemoteState(room.state); }
    this.roomRevision = room.revision; this.room = room; this.roomError = null;
    if (this.sharedGrabs) this.sharedGrabs.receiveRoom(room);
    const live = new Set();
    room.participants.forEach(person => {
      if (person.id === this.client.user.id || !person.online || !person.pose) return;
      live.add(person.id); const key = JSON.stringify(person.avatar); let avatar = this.avatars.get(person.id);
      if (avatar && avatar.userData.avatarKey !== key) { avatar.parent.remove(avatar); avatar.userData.dispose(); this.avatars.delete(person.id); avatar = null; }
      if (!avatar) { avatar = createAvatar(person.avatar); avatar.userData.avatarKey = key; this.editor.root.add(avatar); this.avatars.set(person.id, avatar); }
      avatar.position.fromArray(person.pose.position); avatar.quaternion.fromArray(person.pose.quaternion);
    });
    this.avatars.forEach((avatar, id) => { if (!live.has(id)) { avatar.parent.remove(avatar); avatar.userData.dispose(); this.avatars.delete(id); } });
    this.renderParticipants();
  }
  renderParticipants() { if (!this.participantList || !this.participantList.isConnected || !this.room) return; this.participantList.textContent = ''; this.room.participants.forEach(person => el('p', person.displayName + ' · ' + person.role + (person.online ? ' · conectado' : ' · desconectado'), this.participantList)); }
  applyRemoteState(state) {
    if (this.presentation) this.presentation.before(this.editor.simulation);
    restoreSimulation(this.editor.simulation, state.simulation, {reuse: true});
    if (this.presentation) this.presentation.after(this.editor.simulation);
    if (this.education) (this.editor.simulation.events || []).forEach(event => this.education.event(event));
    this.editor.simulationPaused = true;
  }
  async applyEvents(events, roomUpdate) {
    for (const event of events) {
      if (this.appliedEvents.has(event.sequence)) continue;
      const payload = event.payload;
      if (this.sharedGrabs) await this.sharedGrabs.applyEvent(event, roomUpdate);
      if (event.type === 'action' && payload && this.room.role === 'host') {
        this.applyingNetwork = true;
        try { if (payload.type === 'control') this.rawCommand(payload.objectId, payload.action, payload.value, payload.scope); else if (payload.type === 'simulation') { if (payload.action === 'reset') { if (this.sharedGrabs) this.sharedGrabs.detach(); this.editor.startRuntime(); } this.editor.simulationPaused = payload.action === 'pause'; } }
        catch (error) { this.message('Acción de sala rechazada: ' + error.message); }
        finally { this.applyingNetwork = false; }
      }
      this.appliedEvents.add(event.sequence); if (this.appliedEvents.size > 4000) this.appliedEvents.delete(this.appliedEvents.values().next().value);
    }
  }
  async publishRoom() { if (!this.room || this.room.role !== 'host' || this.publishing) return; this.publishing = true; try { await this.connection.save(this.captureExecution(true)); } finally { this.publishing = false; } }
  bindSimulation() {
    const simulation = this.editor.simulation; this.rawCommand = simulation.command.bind(simulation);
    simulation.command = (id, action, value, scope) => { if (!this.room || this.applyingNetwork) return this.rawCommand(id, action, value, scope); if (this.room.role === 'observer') { this.message('El observador tiene acceso de lectura.'); return false; } this.connection.action({type: 'control', objectId: id, action, value, scope}).catch(error => this.message(error.message)); return true; };
  }
  tick() {
    this.header.hidden = this.editor.active || this.ctx.vrMode; this.controls.hidden = true;
    if (this.ctx.vrMode && !this.drawer.hidden) this.close();
    this.education.tick();
    if (this.sharedGrabs) {
      this.sharedGrabs.tick();
      if (this.pendingRoomState && !this.sharedGrabs.holding && this.room && this.room.role !== 'host') { const state = this.pendingRoomState; this.pendingRoomState = null; try { this.applyRemoteState(state); } catch (error) { this.message(error.message); } }
    }
    const now = performance.now();
    if (this.presentation && this.room && this.room.role !== 'host') this.presentation.tick(this.editor.simulation);
    if (this.room && this.room.role === 'host' && now - this.lastPublish > 750) { this.lastPublish = now; this.publishRoom().catch(error => this.message('Estado compartido pendiente: ' + error.message)); }
    const data = this.ctx.desktopControllerData;
    const current = data && data.currentIntersection, hit = current && (current.intersection || current);
    let object = hit && hit.object; while (object && !object.userData.editorId) object = object.parent;
    this.contextHint.hidden = !object || this.editor.active || this.ctx.vrMode || !this.drawer.hidden;
    if (object && !this.contextHint.hidden) { const action = this.ctx.mobileNavigation && this.ctx.mobileNavigation.active ? 'Pulsa Accionar' : 'Clic para interactuar'; this.contextHint.textContent = object.name ? object.name + ' · ' + action : action; }
  }
}
