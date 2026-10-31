import * as THREE from 'three';

const WIDTH = 1024, HEIGHT = 960, PAGE_SIZE = 6;
const ROOM_IDS = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];
const C = {bg: '#10212d', card: '#203a49', active: '#326276', text: '#eef8fc', dim: '#aac4d2', accent: '#83ecd4', dark: '#082b28', error: '#ffb9b9'};
let serial = 0;
const short = (text, length = 58) => { const value = String(text === undefined ? '' : text); return value.length > length ? value.slice(0, length - 1) + '…' : value; };
function helper(object) { Object.assign(object.userData, {editorHelper: true, editorRuntimeHelper: true, editorNonCollidable: true, studioImmersiveMenu: true}); object.frustumCulled = false; object.renderOrder = 10000; return object; }

/** Native world-space Studio UI. Its bounded canvas is a temporary render
 * resources; credentials never enter scene data, preferences, logs or exports. */
export default class ImmersiveStudioMenu {
  constructor(studio, options = {}) {
    this.studio = studio; this.editor = studio.editor; this.ctx = studio.ctx; this.client = studio.client; this.options = options;
    this.stateName = 'studio-immersive-menu-' + (++serial); this.active = false; this.opened = false; this.disposed = false;
    this.page = 'home'; this.regions = []; this.presses = new Map(); this.hovers = new Map(); this.padButtons = new WeakMap();
    this.fields = {username: '', password: '', code: ''}; this.keyboardField = ''; this.keyboardMode = 'letters'; this.shift = false;
    this.items = []; this.listPage = 0; this.generation = 0; this.busy = false; this.notice = ''; this.error = ''; this.dirty = true;
    this.position = new THREE.Vector3(); this.headQuaternion = new THREE.Quaternion(); this.rotation = new THREE.Matrix4();
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3(); this.target = new THREE.Vector3(); this.lastTime = 0;
    this.controllerDisconnected = data => { this.release(data && data.controller); this.hovers.delete(data && data.controller); this.clearCredentials(); this.dirty = true; };
    if (this.ctx.raycontrol && this.ctx.raycontrol.addEventListener) this.ctx.raycontrol.addEventListener('controllerDisconnected', this.controllerDisconnected);
  }

  ensureResources() {
    if (this.group) return true;
    const dom = this.ctx.document || (typeof document !== 'undefined' ? document : null);
    if (!dom || !dom.createElement || !this.ctx.scene) return false;
    const create = (width, height, meshWidth, meshHeight, name) => {
      const canvas = dom.createElement('canvas'); canvas.width = width; canvas.height = height;
      const drawing = canvas.getContext && canvas.getContext('2d'); if (!drawing) return null;
      const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding; texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
      const material = new THREE.MeshBasicMaterial({map: texture, toneMapped: false, depthTest: false, depthWrite: false});
      const mesh = helper(new THREE.Mesh(new THREE.PlaneBufferGeometry(meshWidth, meshHeight), material)); mesh.name = name;
      return {canvas, drawing, texture, mesh};
    };
    const panel = create(WIDTH, HEIGHT, 1.12, 1.05, 'Menú inmersivo · pantalla');
    if (!panel) return false;
    this.surface = panel; this.canvas = panel.canvas; this.drawing = panel.drawing; this.texture = panel.texture;
    this.panel = panel.mesh; this.group = helper(new THREE.Group()); this.group.name = 'SMART-TWIN Simulator · interfaz VR';
    this.group.visible = false; this.panel.visible = false;
    this.group.add(this.panel); this.ctx.scene.add(this.group);
    this.state = {xrMenu: true, vrOnly: true, controller: 'both', raycaster: true, captureSelect: true, consumeSelect: true,
      colliderMesh: this.panel, isSelectable: (hit, controller) => this.valid(hit, controller),
      onHover: (hit, pressed, controller) => this.hover(hit, controller), onHoverLeave: (hit, pressed, controller) => this.hover(null, controller),
      onSelectStart: (hit, controller) => this.press(hit, controller), onSelectEnd: (hit, controller) => this.release(controller), onSelectCancel: (hit, controller) => this.release(controller)};
    this.installState(); this.dirty = true; return true;
  }
  installState() {
    const ray = this.ctx.raycontrol; if (!ray || !this.state) return;
    if (!ray.states[this.stateName]) ray.addState(this.stateName, this.state);
    if (ray.states[this.stateName] === this.state && this.opened) ray.activateState(this.stateName);
  }
  cancelWorldInput() {
    const ray = this.ctx.raycontrol; if (!ray) return;
    (ray.controllers || []).forEach(data => { if (ray.cancelSelect) ray.cancelSelect(data); if (ray.clearHover) ray.clearHover(data); data.currentIntersection = null; data.prevIntersection = null; data.intersections = {}; });
    if (this.editor.hooks && this.editor.hooks.clearKeyboard) this.editor.hooks.clearKeyboard();
  }
  setVR(enabled) {
    if (this.disposed) return;
    enabled = Boolean(enabled);
    if (this.active === enabled) return;
    this.active = enabled; this.padButtons = new WeakMap();
    // Entering/re-entering VR never opens a panel or allocates a floating label.
    // Only a fresh X/A press creates the menu, once the XR pose is available.
    if (!enabled) { this.ctx.xrExitPending = false; this.close(); this.releaseResources(); }
  }
  headPose() {
    const renderer = this.ctx.renderer, camera = this.ctx.camera;
    const xrCamera = renderer && renderer.xr && renderer.xr.isPresenting && renderer.xr.getCamera ? renderer.xr.getCamera(camera) : null;
    if (xrCamera && xrCamera.matrixWorld) {
      this.position.setFromMatrixPosition(xrCamera.matrixWorld); this.rotation.extractRotation(xrCamera.matrixWorld); this.headQuaternion.setFromRotationMatrix(this.rotation);
    } else if (camera) { camera.updateWorldMatrix(true, false); camera.getWorldPosition(this.position); camera.getWorldQuaternion(this.headQuaternion); }
    return Boolean(camera || xrCamera);
  }
  placePanel() {
    if (!this.panel || !this.headPose()) return;
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuaternion); this.forward.y = 0;
    if (this.forward.lengthSq() < .01) this.forward.set(0, 0, -1); this.forward.normalize();
    this.target.copy(this.position).addScaledVector(this.forward, 1.35); this.target.y = this.position.y - .08;
    this.panel.position.copy(this.target); this.panel.lookAt(this.position); this.panel.updateWorldMatrix(true, false);
  }
  open(page = 'home') {
    if (!this.active || !this.ctx.vrMode || this.disposed || !this.ensureResources()) return;
    if (this.studio.beforeImmersiveMenuOpen) this.studio.beforeImmersiveMenuOpen();
    this.cancelWorldInput(); this.opened = true; this.ctx.studioMenuOpen = true; this.group.visible = true; this.panel.visible = true; this.installState();
    this.placePanel(); this.navigate(page === 'personal' ? 'home' : page);
  }
  close() {
    this.generation++; this.opened = false; this.ctx.studioMenuOpen = false; this.clearCredentials(); this.items = []; this.privateProject = null;
    this.regions = []; this.presses.clear(); this.hovers.clear(); this.error = ''; this.notice = ''; this.cancelWorldInput();
    if (this.panel) { this.panel.visible = false; this.drawing.fillStyle = C.bg; this.drawing.fillRect(0, 0, WIDTH, HEIGHT); this.texture.needsUpdate = true; }
    if (this.group) this.group.visible = false;
    const ray = this.ctx.raycontrol; if (ray && this.state && ray.states[this.stateName] === this.state) ray.deactivateState(this.stateName);
    this.dirty = true;
  }
  clearCredentials() { this.fields.username = ''; this.fields.password = ''; this.fields.code = ''; this.keyboardField = ''; this.shift = false; this.keyboardMode = 'letters'; }
  identityChanged() {
    this.generation++; this.clearCredentials(); this.items = []; this.privateProject = null; this.listPage = 0;
    if (this.opened) { this.page = 'home'; this.dirty = true; }
  }
  valid(hit, controller) {
    const object = hit && (hit.actualObject || hit.object), data = this.ctx.raycontrol && this.ctx.raycontrol.controllers.find(value => value.controller === controller);
    return Boolean(this.active && this.ctx.vrMode && this.group && this.group.visible && hit && hit.uv && hit.distance <= 5 &&
      object === this.panel && this.opened && object.visible && (!data || !data.desktop && data.enabled !== false));
  }
  regionAt(hit) {
    if (!hit || !hit.uv) return null; const x = hit.uv.x * WIDTH, y = (1 - hit.uv.y) * HEIGHT;
    return this.regions.slice().reverse().find(region => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height) || null;
  }
  hover(hit, controller) { const region = hit && this.valid(hit, controller) && this.regionAt(hit), key = region && region.key || ''; if (this.hovers.get(controller) !== key) { key ? this.hovers.set(controller, key) : this.hovers.delete(controller); this.dirty = true; } }
  press(hit, controller) {
    if (!this.valid(hit, controller) || this.presses.has(controller)) return;
    const region = this.regionAt(hit); if (!region || region.disabled || this.busy && !['close', 'home', 'exit-vr'].includes(region.key)) return;
    const held = Array.from(this.presses.values()).some(key => key === region.key); this.presses.set(controller, region.key); this.pressedUntil = this.lastTime + .12; this.pressedKey = region.key; this.dirty = true;
    if (held) return;
    const data = this.ctx.raycontrol && this.ctx.raycontrol.controllers.find(value => value.controller === controller), gamepad = data && data.inputSource && data.inputSource.gamepad;
    try { const pulse = gamepad && gamepad.hapticActuators && gamepad.hapticActuators[0]; if (pulse && pulse.pulse) Promise.resolve(pulse.pulse(.18, 25)).catch(() => {}); } catch (_) { /* Optional haptics never block an action. */ }
    try { const result = region.action && region.action(); if (result && result.catch) result.catch(error => { this.error = short(error.message, 100); this.fields.password = ''; this.dirty = true; }); }
    catch (error) { this.error = short(error.message, 100); this.fields.password = ''; this.dirty = true; }
  }
  release(controller) { if (this.presses.delete(controller)) this.dirty = true; }

  navigate(page) {
    this.generation++; this.page = page; this.error = ''; this.notice = ''; this.listPage = 0; this.items = []; this.privateProject = null;
    if (!['account', 'register', 'rooms'].includes(page)) this.clearCredentials(); this.dirty = true;
    if (['account', 'register'].includes(page) && !this.editor.staticPublic && !this.client.user) this.keyboardField = 'username';
    if (page === 'scenes' || page === 'projects' || page === 'users' || page === 'progress' || page === 'classroom') this.loadList(page);
  }
  async loadList(page) {
    const generation = this.generation, owner = this.client.user && this.client.user.id; this.loading = true; this.dirty = true;
    try {
      if (page !== 'scenes' && !owner) throw new Error('Inicia sesión para consultar esta información.');
      let items = [];
      if (page === 'scenes') {
        const access = this.editor.accessView;
        const results = await Promise.all([access && access.publicCatalog ? access.publicCatalog() : this.editor.projectClient.request('GET', '/public/scenes'), owner ? this.editor.projectClient.request('GET', '/library/scenes') : Promise.resolve({scenes: []})]);
        items = (results[0].scenes || []).map(scene => ({key: 'public:' + scene.id, label: scene.name, detail: 'Público', scene, kind: 'public'})).concat((results[1].scenes || []).map(scene => ({key: 'library:' + scene.id, label: scene.name, detail: scene.collection || 'Ejemplo incluido', scene, kind: 'library'})));
      } else if (page === 'projects') items = (await this.editor.projectClient.listProjects()).map(project => ({key: project.id, label: project.name, detail: project.access && project.access.canEdit ? 'Proyecto autorizado · edición en escritorio' : 'Proyecto autorizado · consulta', project, kind: 'project'}));
      else if (page === 'users') {
        if (!this.client.user.permissions.manageUsers) throw new Error('Sólo el superadministrador puede consultar usuarios.');
        const result = await this.client.request('GET', '/admin/users'); items = result.users.map(user => ({key: user.id, label: user.displayName + ' · ' + user.username, detail: (user.quota && user.quota.projects || 0) + ' proyectos · ' + Number((user.quota && user.quota.usedBytes || 0) / 1048576).toFixed(1) + ' MiB · ' + (user.superadmin ? 'Superadministrador' : user.role === 'creator' ? 'Creador' : 'Explorador')}));
      } else if (page === 'classroom') {
        const result = await this.client.classroom(); (result.groups || []).forEach(group => (group.assignments || []).forEach(assignment => items.push({key: assignment.id, label: assignment.title, detail: group.name + (assignment.evaluation ? ' · Nota ' + assignment.evaluation.score + '/100' : ' · Pendiente de evaluación')})));
      } else if (page === 'progress') items = this.studio.education.missions().map(mission => ({key: mission.id, label: mission.name, detail: this.studio.education.getProgress(mission).status === 'completed' ? 'Completada' : 'En curso'}));
      if (generation !== this.generation || owner !== (this.client.user && this.client.user.id)) return;
      this.items = items;
    } catch (error) { if (generation === this.generation) this.error = short(error.message, 100); }
    finally { if (generation === this.generation) { this.loading = false; this.dirty = true; } }
  }
  async run(action) {
    if (this.busy) return; this.busy = true; this.error = ''; this.dirty = true;
    try { return await action(); }
    catch (error) { this.error = short(error.message, 100); this.fields.password = ''; this.dirty = true; }
    finally { this.busy = false; this.dirty = true; }
  }
  async exitVR() {
    if (this.exiting || !this.active || !this.ctx.vrMode) return;
    const xr = this.ctx.renderer && this.ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
    if (!session || typeof session.end !== 'function') { this.error = 'No se encontró una sesión de RV activa. Vuelve a intentarlo.'; this.dirty = true; return; }
    this.exiting = true; this.ctx.xrExitPending = true; this.error = ''; this.clearCredentials(); this.dirty = true;
    try { await session.end(); }
    catch (_) { if (this.active && this.opened) this.error = 'No se pudo salir de RV. Pulsa Salir de RV para reintentarlo.'; }
    finally { this.exiting = false; this.ctx.xrExitPending = false; this.dirty = true; }
    // Session-end restores the renderer, desktop, controllers and mirror.
    // Never simulate an exit by changing vrMode here.
  }
  async authenticate(register = false) {
    if (this.editor.staticPublic) { this.clearCredentials(); this.error = 'Las cuentas requieren el servidor de SMART-TWIN Simulator. Puedes explorar los dos ejemplos públicos.'; this.dirty = true; return; }
    const username = this.fields.username.trim(), password = this.fields.password, code = this.fields.code.trim();
    if (!username || !password) { this.error = 'Escribe usuario y contraseña con el teclado del panel.'; this.dirty = true; return; }
    return this.run(async () => {
      try {
        if (register) await this.client.register(username, password, username, code); else await this.client.login(username, password);
        if (this.studio.loggingOut || this.client.logoutPending) return;
        await this.client.me();
        if (this.studio.loggingOut || this.client.logoutPending) return;
        await this.studio.authenticated({immersive: true}); this.clearCredentials();
        if (this.active && this.opened) { this.navigate('home'); this.notice = 'Sesión iniciada.'; }
      } finally { this.fields.password = ''; this.fields.code = ''; }
    });
  }
  async reconnectAccount() {
    return this.run(async () => {
      if (!this.studio.reconnectAccountService) throw new Error('El acceso necesita la versión conectada al servidor de SMART-TWIN Simulator.');
      const generation = this.generation;
      await this.studio.reconnectAccountService();
      if (!this.active || !this.opened || generation !== this.generation) return;
      this.clearCredentials(); this.navigate(this.client.user ? 'home' : 'account');
      this.notice = this.client.user ? 'Sesión disponible.' : 'Conexión disponible. Escribe tu usuario y contraseña.';
    });
  }
  async chooseItem(item) {
    if (!['public', 'library', 'project', 'room'].includes(item.kind)) return;
    return this.run(async () => {
      if (this.studio.room) throw new Error('Sal de la sala compartida antes de cambiar de escenario.');
      if (this.editor.dirty) throw new Error('Conserva tus cambios desde el editor antes de abrir otro escenario.');
      const generation = this.generation, owner = this.client.user && this.client.user.id;
      let project, roomId;
      if (item.kind === 'public' || item.kind === 'library') { const access = this.editor.accessView; const result = item.kind === 'public' && access && access.publicProject ? await access.publicProject(item.scene.id) : await this.editor.projectClient.request('GET', '/' + item.kind + '/scenes/' + encodeURIComponent(item.scene.id)); project = result.project; roomId = item.scene.roomId; }
      else if (item.kind === 'project') {
        project = await this.editor.projectClient.getProject(item.project.id);
        const scenes = project.document.studio && project.document.studio.scenes || [];
        if (scenes.length > 1) {
          if (generation !== this.generation || owner !== (this.client.user && this.client.user.id)) return;
          this.privateProject = project; this.page = 'projectScenes'; this.listPage = 0;
          this.items = scenes.map(scene => ({key: scene.id, label: scene.name, detail: project.name, roomId: scene.id, kind: 'room'})); return;
        }
      } else { project = this.privateProject; roomId = item.roomId; }
      if (generation !== this.generation || owner !== (this.client.user && this.client.user.id) || !project) return;
      await this.editor.applyServerProject(project, {roomId}); this.close();
    });
  }
  keyboard(value) {
    if (!this.keyboardField) return;
    const key = this.keyboardField, maximum = key === 'password' ? 256 : key === 'code' ? 80 : 40;
    if (value === 'delete') this.fields[key] = this.fields[key].slice(0, -1);
    else if (value === 'clear') this.fields[key] = '';
    else if (value === 'shift') this.shift = !this.shift;
    else if (value === 'symbols') this.keyboardMode = this.keyboardMode === 'letters' ? 'symbols' : 'letters';
    else if (value === 'done') {
      if (key === 'username') this.keyboardField = 'password';
      else if (key === 'password' && this.page === 'register') this.keyboardField = 'code';
      else { this.keyboardField = ''; this.dirty = true; return this.authenticate(this.page === 'register'); }
    }
    else if (this.fields[key].length < maximum) this.fields[key] += this.shift ? value.toUpperCase() : value;
    this.dirty = true;
  }

  text(value, x, y, size = 28, color = C.text, weight = '') { const d = this.drawing; d.fillStyle = color; d.textAlign = 'left'; d.font = weight + ' ' + size + 'px Arial'; d.fillText(String(value), x, y); }
  button(key, label, x, y, width, height, action, options = {}) {
    const d = this.drawing, active = Array.from(this.hovers.values()).includes(key), pressed = Array.from(this.presses.values()).includes(key) || this.pressedKey === key && this.lastTime < this.pressedUntil;
    const disabled = options.disabled || this.busy && !['close', 'home', 'exit-vr'].includes(key), accent = options.accent;
    d.fillStyle = disabled ? '#253640' : pressed ? '#437686' : active ? C.active : options.danger ? '#603841' : accent ? C.accent : C.card; d.fillRect(x, y + (pressed ? 3 : 0), width, height);
    if (d.strokeRect) { d.lineWidth = active || options.selected ? 3 : 1; d.strokeStyle = active || options.selected ? C.accent : '#527084'; d.strokeRect(x, y + (pressed ? 3 : 0), width, height); }
    d.textAlign = 'center'; d.fillStyle = disabled ? '#8198a6' : accent && !active && !pressed ? C.dark : C.text; d.font = (options.bold ? 'bold ' : '') + (options.size || 28) + 'px Arial'; d.fillText(short(label, Math.max(5, Math.floor(width / ((options.size || 28) * .56)))), x + width / 2, y + height / 2 + 10 + (pressed ? 3 : 0));
    this.regions.push({key, x, y, width, height, action, disabled});
  }
  field(key, label, y) {
    this.text(label, 46, y - 10, 25, C.dim); const value = key === 'password' ? '•'.repeat(Math.min(this.fields.password.length, 30)) : this.fields[key];
    this.button('field:' + key, value || 'Seleccionar para escribir', 46, y, 932, 64, () => { this.keyboardField = key; this.dirty = true; }, {selected: this.keyboardField === key, size: 28});
  }
  paintKeyboard(y) {
    const rows = this.keyboardMode === 'letters' ? ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm-_'] : ['!@#$%^&*()', '[]{}<>+=/' + String.fromCharCode(92), '.,:;?~`|"', "'_ -"];
    rows.forEach((row, index) => { const keys = Array.from(row), width = 83, gap = 10, total = keys.length * (width + gap) - gap, x = (WIDTH - total) / 2;
      keys.forEach((value, at) => this.button('key:' + index + ':' + at, this.shift ? value.toUpperCase() : value, x + at * (width + gap), y + index * 61, width, 52, () => this.keyboard(value), {size: 29}));
    });
    const next = this.keyboardField === 'username' || this.keyboardField === 'password' && this.page === 'register';
    [['shift', 'Mayús'], ['symbols', this.keyboardMode === 'letters' ? 'Símbolos' : 'Letras'], ['delete', 'Borrar'], ['clear', 'Vaciar'], ['done', next ? 'Siguiente' : this.page === 'register' ? 'Crear cuenta' : 'Entrar']].forEach(([key, label], index) => this.button('key:' + key, label, 46 + index * 187, y + 250, 176, 54, () => this.keyboard(key), {size: 24, accent: key === 'done'}));
  }
  paintList() {
    const pages = Math.max(1, Math.ceil(this.items.length / PAGE_SIZE)); this.listPage = Math.min(this.listPage, pages - 1);
    if (this.loading) this.text('Cargando información…', 46, 220, 31, C.dim);
    else if (!this.items.length) this.text('No hay elementos disponibles.', 46, 220, 31, C.dim);
    this.items.slice(this.listPage * PAGE_SIZE, (this.listPage + 1) * PAGE_SIZE).forEach((item, index) => {
      const y = 165 + index * 96;
      this.button('item:' + item.key, item.label, 46, y, 932, 58, () => this.chooseItem(item), {size: 29});
      this.text(short(item.detail, 78), 58, y + 83, 23, C.dim);
    });
    this.button('previous', '← Anterior', 46, 785, 260, 59, () => { this.listPage = Math.max(0, this.listPage - 1); this.dirty = true; }, {disabled: this.listPage === 0});
    this.text((this.listPage + 1) + ' / ' + pages + ' · ' + this.items.length + ' elementos', 352, 826, 26, C.dim);
    this.button('next', 'Siguiente →', 718, 785, 260, 59, () => { this.listPage = Math.min(pages - 1, this.listPage + 1); this.dirty = true; }, {disabled: this.listPage >= pages - 1});
    if (this.page === 'scenes' && !this.client.user) this.text('Inicia sesión para ver todos los ejemplos y tus proyectos.', 46, 880, 26, C.dim);
    if (this.page === 'users') this.text('La edición de cuotas se realiza en el modal de escritorio.', 46, 880, 25, C.dim);
  }
  paintHome() {
    const user = this.client.user; this.text(user ? 'Hola, ' + short(user.displayName, 35) : 'Explora como invitado o inicia sesión.', 46, 180, 32, C.dim);
    const actions = [['scenes', 'Escenarios', () => this.navigate('scenes')]];
    if (user) actions.push(['projects', 'Mis proyectos', () => this.navigate('projects')], ['classroom', 'Mis prácticas', () => this.navigate('classroom')], ['progress', 'Mi progreso', () => this.navigate('progress')]);
    else actions.push(['account', 'Iniciar sesión', () => this.navigate('account')]);
    actions.push(['settings', 'Sonido y controles', () => this.navigate('settings')], ['controls', 'Controles del visor', () => this.navigate('controls')]);
    if (user && user.permissions.manageUsers) actions.push(['users', 'Usuarios · resumen', () => this.navigate('users')]);
    if (user) actions.push(['logout', 'Cerrar sesión', () => this.run(async () => { await this.studio.logout(); if (this.active && this.opened) { this.navigate('home'); this.notice = 'Sesión cerrada.'; } })]);
    actions.forEach(([key, label, action], index) => this.button(key, label, 46, 225 + index * 83, 932, 64, action, {accent: key === 'account'}));
    this.text('X (izquierdo) / A (derecho): abrir o cerrar el menú.', 46, 902, 25, C.dim);
  }
  paintAccount() {
    const register = this.page === 'register';
    if (this.client.user) { this.page = 'home'; this.paintHome(); return; }
    if (this.editor.staticPublic) {
      this.text('Publicación pública sin servidor de cuentas.', 46, 215, 31, C.dim);
      this.text('Los proyectos privados requieren SMART-TWIN Simulator con servidor.', 46, 275, 26, C.dim);
      this.text('Usa el enlace HTTPS del servidor o túnel para iniciar sesión.', 46, 330, 25, C.dim);
      this.button('reconnect-account', this.busy ? 'Comprobando conexión…' : 'Reintentar conexión de cuentas', 46, 385, 932, 66, () => this.reconnectAccount(), {accent: true});
      this.button('public-scenes', 'Explorar escenarios públicos', 46, 480, 932, 66, () => this.navigate('scenes'));
      return;
    }
    this.field('username', 'Usuario', 190); this.field('password', 'Contraseña', 300); if (register) this.field('code', 'Código de registro · si lo recibiste', 410);
    const keyboardY = register ? 508 : 425;
    if (this.keyboardField) { this.text('Teclado · ' + (this.keyboardField === 'password' ? 'contraseña oculta' : this.keyboardField === 'code' ? 'código' : 'usuario'), 46, keyboardY - 18, 24, C.dim); this.paintKeyboard(keyboardY); }
    else { this.text('Selecciona un campo y apunta a las teclas con el mando.', 46, keyboardY + 16, 27, C.dim); this.text('Pulsa el gatillo para escribir. La contraseña siempre se oculta.', 46, keyboardY + 60, 25, C.dim); }
    const y = register ? 852 : 795;
    this.button('authenticate', this.busy ? 'Conectando…' : register ? 'Crear cuenta' : 'Iniciar sesión', 46, y, 552, 64, () => this.authenticate(register), {accent: true});
    this.button('account-mode', register ? 'Ya tengo cuenta' : 'Crear cuenta', 620, y, 358, 64, () => { this.clearCredentials(); this.navigate(register ? 'account' : 'register'); }, {size: 26});
  }
  paintSettings() {
    const audio = this.editor.industrialAudio, volume = audio ? audio.volume : .7;
    this.text('Sonido del dispositivo', 46, 190, 32); this.text('Volumen ' + Math.round(volume * 100) + '%', 46, 244, 28, C.dim);
    this.button('mute', audio && audio.muted ? 'Activar sonido' : 'Silenciar sonido', 46, 275, this.ctx.voicePanel ? 445 : 932, 66, () => this.run(async () => { if (audio) { audio.setMuted(!audio.muted); if (!audio.muted && audio.activate) await audio.activate(); } this.dirty = true; }));
    if (this.ctx.voicePanel) this.button('voice-assistant', 'Voz e instrucciones', 514, 275, 464, 66, () => {this.close(); this.ctx.voicePanel.open();}, {size: 25});
    this.button('volume-down', '− Volumen', 46, 365, 445, 66, () => { if (audio) audio.setVolume(Math.max(0, volume - .1)); this.dirty = true; });
    this.button('volume-up', '+ Volumen', 514, 365, 464, 66, () => { if (audio) audio.setVolume(Math.min(1, volume + .1)); this.dirty = true; });
    if(this.editor.projectModules)this.button('project-modules','Módulos y niveles del proyecto',46,435,932,46,()=>this.navigate('modules'),{size:25});
    this.text('Controles en realidad virtual', 46, 522, 28);
    this.text('Stick izquierdo: caminar · Derecho: giro de 30°', 46, 565, 25, C.dim);
    this.button('movement', this.ctx.studioLocomotion === 'teleport' ? 'Movimiento: solo teletransporte' : 'Movimiento: stick izquierdo y teletransporte', 46, 585, 932, 64, () => this.setPreferences({locomotion: this.ctx.studioLocomotion === 'teleport' ? 'smooth' : 'teleport'}), {size: 25});
    this.button('hand', 'Mano preferida: ' + (this.ctx.handedness === 'left' ? 'izquierda' : 'derecha'), 46, 665, 932, 66, () => this.setPreferences({handedness: this.ctx.handedness === 'left' ? 'right' : 'left'}));
    this.button('recenter', 'Recentrar el menú frente a mí', 46, 765, 932, 66, () => this.placePanel());
    const graphics = this.ctx.graphics;
    if (graphics && graphics.getXRClarity && graphics.setXRClarity) this.button('xr-clarity', graphics.getXRClarity() === 'sharp' ? 'Nitidez: más detalle en los bordes' : 'Nitidez: priorizar rendimiento', 46, 845, 932, 64, () => {
      graphics.setXRClarity(graphics.getXRClarity() === 'sharp' ? 'balanced' : 'sharp'); this.dirty = true;
    }, {size: 25});
  }
  setPreferences(change) {
    return this.run(async () => {
      const preferences = Object.assign({handedness: this.ctx.handedness || 'right', locomotion: this.ctx.studioLocomotion || 'smooth'}, change);
      if (this.client.user) await this.client.updateProfile({preferences}); this.studio.applyPreferences(preferences); this.notice = 'Ajustes aplicados.';
    });
  }
  paintModules(){
    const manager=this.editor.projectModules,profile=manager&&manager.profile;
    if(!profile||!profile.modules.length){this.text('Este proyecto utiliza su experiencia principal.',46,220,29,C.dim);return;}
    const rows=profile.modules.filter(row=>row.viewerEnabled&&(profile.mode!=='specialized'||row.id===profile.selectedModuleId)),metadata=manager.availableModules();
    const all=profile.mode!=='specialized';this.text(all?'Selecciona los contenidos que deseas explorar.':'Proyecto especializado en un módulo.',46,185,27,C.dim);
    if(all)this.button('module-all','Todos los módulos disponibles',46,225,932,64,()=>this.run(async()=>{await manager.selectModule('');this.dirty=true;}));
    const pages=Math.max(1,Math.ceil(rows.length/6));this.listPage=Math.min(this.listPage,pages-1);
    rows.slice(this.listPage*6,this.listPage*6+6).forEach((row,index)=>{const meta=metadata.find(item=>item.id===row.id),label=(manager.activeModuleId===row.id?'● ':'')+(meta&&meta.title||row.id);this.button('module:'+row.id,label,46,320+index*83,932,64,()=>this.run(async()=>{await manager.selectModule(row.id);this.dirty=true;}),{accent:manager.activeModuleId===row.id,size:28});});
    if(pages>1){this.button('module-prev','Anterior',46,835,445,58,()=>{this.listPage=Math.max(0,this.listPage-1);this.dirty=true;});this.button('module-next','Siguiente',514,835,464,58,()=>{this.listPage=Math.min(pages-1,this.listPage+1);this.dirty=true;});}
    if(!rows.length)this.text('No hay módulos habilitados para esta vista.',46,350,28,C.dim);
  }
  paintControls() {
    const lines = ['X (izquierdo) / A (derecho): abrir o cerrar el menú.', 'Salir de RV: botón rojo en la parte superior del menú.', 'Stick izquierdo: caminar según la dirección de la mirada.', 'Stick derecho: girar 30°; céntralo para volver a girar.', 'Gatillo: seleccionar a distancia y usar el teclado.', 'Botones físicos: acerca la punta del mando al frente.', 'Retira el mando antes de volver a pulsar por contacto.', 'Grip lateral: agarrar y soltar productos.', 'Teletransporte: apunta al suelo con tu mano preferida.', 'El menú pausa las interacciones y el desplazamiento.', 'Puedes iniciar sesión sin salir de la realidad virtual.', 'El botón del sistema Meta pertenece al visor.'];
    lines.forEach((line, index) => this.text(line, 46, 183 + index * 51, index === 0 ? 26 : 24, index === 0 ? C.accent : C.text));
    this.button('recenter', 'Recentrar este menú', 46, 795, 932, 65, () => this.placePanel());
  }
  paint() {
    if (!this.drawing || !this.opened) return; this.regions = [];
    const d = this.drawing; d.fillStyle = C.bg; d.fillRect(0, 0, WIDTH, HEIGHT); d.fillStyle = '#1a3443'; d.fillRect(0, 0, WIDTH, 126);
    const names = {home: 'SMART-TWIN Simulator', account: 'Iniciar sesión', register: 'Crear cuenta', scenes: 'Escenarios', projects: 'Mis proyectos', projectScenes: 'Escenarios del proyecto', settings: 'Ajustes del visor', controls: 'Controles VR', users: 'Usuarios · resumen', classroom: 'Mis prácticas', progress: 'Mi progreso'};
    this.text(names[this.page] || 'SMART-TWIN Simulator', 46, 70, this.page === 'home' ? 32 : 35, C.text, 'bold'); this.text(this.busy ? 'Procesando…' : 'Apunta y pulsa el gatillo', 46, 110, 22, C.dim);
    this.button('exit-vr', this.exiting ? 'Saliendo…' : 'Salir de RV', 500, 28, 184, 64, () => this.exitVR(), {size: 23, danger: true, disabled: this.exiting});
    this.button('close', '×', 886, 24, 92, 72, () => this.close(), {size: 42});
    if (this.page !== 'home') this.button('home', '← Menú', 704, 28, 158, 64, () => this.navigate('home'), {size: 25});
    if (this.page === 'home') this.paintHome(); else if (this.page === 'account' || this.page === 'register') this.paintAccount(); else if (this.page === 'settings') this.paintSettings(); else if (this.page === 'modules') this.paintModules(); else if (this.page === 'controls') this.paintControls(); else this.paintList();
    if (this.error || this.notice) { d.fillStyle = '#10212d'; d.fillRect(32, 918, WIDTH - 64, 38); this.text(short(this.error || this.notice, 90), 46, 945, 23, this.error ? C.error : C.accent); }
    this.texture.needsUpdate = true; this.dirty = false;
  }
  tick(delta = 0) {
    if (this.disposed || !this.active || !this.ctx.vrMode) return;
    const session = this.ctx.renderer && this.ctx.renderer.xr && this.ctx.renderer.xr.getSession && this.ctx.renderer.xr.getSession();
    if (session && session.visibilityState && session.visibilityState !== 'visible') { if (this.opened) this.close(); this.padButtons = new WeakMap(); return; }
    if (this.opened) this.installState();
    this.lastTime += Math.max(0, Number.isFinite(delta) ? delta : 0);
    const sources = this.ctx.raycontrol && this.ctx.raycontrol.controllers || [];
    let toggle = false;
    sources.forEach(data => {
      const source = data.inputSource, pad = source && source.gamepad;
      if (!source || data.desktop || !['left', 'right'].includes(source.handedness) || !pad || pad.mapping !== 'xr-standard' || !pad.buttons || !pad.buttons[4]) return;
      const pressed = Boolean(pad.buttons[4].pressed || pad.buttons[4].value > .6), previous = this.padButtons.get(source);
      // A held xylophone stick may suspend this hand's target ray. Its physical
      // face button still opens the menu; the opening hook releases that grip.
      this.padButtons.set(source, pressed); if (previous === false && pressed) toggle = true;
    });
    if (toggle) this.opened ? this.close() : this.open('home');
    if (this.pressedKey && this.lastTime >= this.pressedUntil && !this.presses.size) { this.pressedKey = ''; this.dirty = true; }
    if (this.opened && this.dirty) this.paint();
  }
  releaseResources() {
    const ray = this.ctx.raycontrol;
    if (ray && this.state && ray.states[this.stateName] === this.state) { ray.deactivateState(this.stateName); delete ray.states[this.stateName]; }
    if (this.surface) { const value = this.surface; value.mesh.geometry.dispose(); value.mesh.material.dispose(); value.texture.dispose(); value.canvas.width = value.canvas.height = 1; }
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    this.group = this.panel = this.surface = this.canvas = this.drawing = this.texture = this.state = null;
  }
  dispose() {
    if (this.disposed) return; this.close(); this.active = false; this.releaseResources(); this.padButtons = new WeakMap();
    if (this.ctx.raycontrol && this.ctx.raycontrol.removeEventListener) this.ctx.raycontrol.removeEventListener('controllerDisconnected', this.controllerDisconnected); this.disposed = true;
  }
}
