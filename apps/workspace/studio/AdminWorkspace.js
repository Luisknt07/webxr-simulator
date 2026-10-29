const el = (tag, text, parent, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; if (parent) parent.appendChild(node); return node; };
const action = (parent, label, handler) => { const node = el('button', label, parent); node.type = 'button'; node.onclick = handler; return node; };
const field = (parent, label, value = '', type = 'text') => { const row = el('label', label, parent), node = el('input', undefined, row); node.type = type; node.value = value; return node; };
const choose = (parent, label, rows, selected = '') => { const row = el('label', label, parent), select = el('select', undefined, row); rows.forEach(value => { const option = el('option', value.label, select); option.value = value.id; }); select.value = selected; return select; };
const bytes = n => Number((Number(n || 0) / 1048576).toFixed(2)) + ' MiB';
const date = n => n && Number.isFinite(new Date(n).getTime()) ? new Intl.DateTimeFormat('es-EC', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guayaquil'}).format(new Date(n)) : 'Sin actividad registrada';
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
const administrator = user => Boolean(user && (user.superadmin || user.permissions && user.permissions.manageUsers));
const roleName = user => administrator(user) ? 'Superadmin' : user.role === 'creator' ? 'Creador' : 'Explorador';

/** One owner console, opened on demand. No credential or report goes to localStorage. */
export default class AdminWorkspace {
  constructor(studio) { this.studio = studio; this.client = studio.client; this.generation = 0; this.detailGeneration = 0; this.userPage = 0; this.pageSize = 25; this.userQuery = ''; this.userRole = 'all'; this.userSort = 'name'; }
  authorized() { return Boolean(this.client.user && this.client.user.permissions && this.client.user.permissions.manageUsers); }
  scope() { return {generation: this.generation, userId: this.client.user && this.client.user.id}; }
  isScope(scope) { return Boolean(scope && this.authorized() && scope.generation === this.generation && scope.userId === this.client.user.id && this.host && this.host.isConnected); }
  assertScope(scope) { if (!this.isScope(scope)) throw Object.assign(new Error('La administración cambió de cuenta o se cerró. Vuelve a abrirla.'), {code: 'stale_admin_workspace'}); }
  async openModal(tab = 'users') {
    if (!this.authorized()) throw new Error('Sólo el superadministrador puede abrir esta sección.');
    if (this.studio.ctx && this.studio.ctx.vrMode) throw new Error('La administración completa se utiliza fuera de la sesión VR.');
    if (!this.modal) {
      this.previousFocus = document.activeElement;
      if (this.studio.close) this.studio.close();
      const overlay = this.modal = el('div', undefined, document.body, 'studio-admin-modal-overlay');
      const dialog = el('section', undefined, overlay, 'studio-admin-modal'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'studio-admin-modal-title');
      const header = el('header', undefined, dialog, 'studio-admin-modal-header'), title = el('div', undefined, header);
      el('span', 'SMART-TWIN Simulator · SUPERADMINISTRADOR', title, 'studio-admin-eyebrow'); const heading = el('h1', 'Administración', title); heading.id = 'studio-admin-modal-title';
      this.closeButton = action(header, 'Cerrar ×', () => this.close()); this.closeButton.setAttribute('aria-label', 'Cerrar administración');
      this.modalContent = el('div', undefined, dialog, 'studio-admin-modal-content');
      const footer = el('footer', 'Gestión de cuentas, recursos y prácticas · Hora de Ecuador', dialog, 'studio-admin-modal-footer'); footer.setAttribute('aria-live', 'polite');
      overlay.addEventListener('pointerdown', event => { if (event.target === overlay) this.close(); });
      overlay.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')).filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
        if (!controls.length) return; const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      if (document.body.classList) document.body.classList.add('studio-admin-modal-open');
      if (this.studio.editor && this.studio.editor.hooks) { this.studio.editor.hooks.unlock(); this.studio.editor.hooks.clearKeyboard(); }
      this.closeButton.focus();
    }
    return this.open(this.modalContent, tab);
  }
  close() {
    this.generation++; this.detailGeneration++; this.reportCache = null; this.users = []; this.userDirectory = null;
    if (this.host) this.host.textContent = '';
    if (this.modal) this.modal.remove(); this.modal = null; this.modalContent = null; this.host = null; this.body = null;
    if (document.body && document.body.classList) document.body.classList.remove('studio-admin-modal-open');
    const focus = this.previousFocus && this.previousFocus.isConnected !== false && (!this.previousFocus.getClientRects || this.previousFocus.getClientRects().length) ? this.previousFocus : this.studio.menuButton;
    if (focus && focus.focus && !(this.studio.ctx && this.studio.ctx.vrMode)) focus.focus(); this.previousFocus = null;
  }
  dispose() { this.close(); }
  async open(host, tab = 'users') {
    if (!this.authorized()) throw new Error('Sólo el superadministrador puede abrir esta sección.');
    const generation = ++this.generation; this.detailGeneration++; this.reportCache = null; this.host = host; host.textContent = ''; host.classList.add('studio-admin'); this.tab = tab;
    const scope = this.scope();
    const tabs = el('nav', undefined, host, 'studio-admin-tabs'); tabs.setAttribute('aria-label', 'Administración');
    [['users', 'Usuarios y cuotas'], ['groups', 'Grupos y prácticas'], ['codes', 'Códigos de acceso'], ['publication', 'Escenas públicas'], ['reports', 'Informes']].forEach(([key, name]) => { const button = action(tabs, name, () => this.studio.guard(() => this.open(host, key))); button.setAttribute('aria-pressed', String(tab === key)); });
    this.body = el('div', undefined, host, 'studio-admin-body'); const body = this.body; el('p', 'Cargando…', body);
    try {
      const result = await this.client.request('GET', '/admin/users'); if (generation !== this.generation || !this.isScope(scope)) return;
      this.users = result.users; this.policy = result.policy; body.textContent = '';
      if (tab === 'users') await this.usersView(body); else if (tab === 'codes') await this.codesView(body); else if (tab === 'groups') await this.groupsView(body); else if (tab === 'publication') await this.publicationView(body); else await this.reportsView(body);
    } catch (error) {
      if (this.isScope(scope)) { body.textContent = ''; el('h2', 'No se pudo cargar la administración', body); el('p', error.message, body, 'studio-admin-save-status is-error'); action(body, 'Reintentar', () => this.studio.guard(() => this.open(host, tab))); }
      throw error;
    }
  }
  async request(method, path, data) {
    const scope = this.scope(); this.assertScope(scope); const result = await this.client.request(method, '/admin' + path, data); this.assertScope(scope); return result;
  }
  secret(body, title, value) {
    const card = el('div', undefined, body, 'studio-card studio-admin-secret'); el('strong', title, card);
    const code = field(card, 'Código generado · cópialo para entregarlo al usuario', value); code.readOnly = true; code.autocomplete = 'off'; code.spellcheck = false;
    el('p', 'Se muestra sólo en esta respuesta. El servidor conserva únicamente su verificador seguro.', card, 'studio-muted');
    action(card, 'Copiar', () => { code.focus(); code.select(); if (navigator.clipboard) navigator.clipboard.writeText(value).catch(() => {}); });
  }
  async usersView(body) {
    const heading = el('div', undefined, body, 'studio-admin-section-heading');
    const title = el('div', undefined, heading); el('h2', 'Usuarios y almacenamiento', title); el('p', 'Busca una cuenta y selecciónala para consultar su actividad, recursos y permisos.', title, 'studio-muted');
    const actions = el('div', undefined, heading, 'studio-admin-row-actions');
    action(actions, 'Actualizar', () => this.studio.guard(() => this.open(this.host, 'users')));
    action(actions, 'Código de registro', () => this.studio.guard(() => this.open(this.host, 'codes')));
    const create = el('details', undefined, body, 'studio-admin-create'); el('summary', '＋ Crear usuario con código de acceso', create); const form = el('form', undefined, create, 'studio-form');
    const username = field(form, 'Usuario'), name = field(form, 'Nombre visible'); username.required = true;
    const role = choose(form, 'Permiso', [{id: 'creator', label: 'Creador'}, {id: 'viewer', label: 'Explorador'}], 'creator');
    const submit = el('button', 'Crear usuario', form); submit.type = 'submit';
    form.onsubmit = event => { event.preventDefault(); this.studio.guard(async () => { submit.disabled = true; try { const result = await this.request('POST', '/users', {username: username.value, displayName: name.value || username.value, role: role.value}); this.users.push(result.user); this.selectedUserId = result.user.id; this.userQuery = ''; this.userRole = 'all'; this.userDirectory.search.value = ''; this.userDirectory.role.value = 'all'; this.userPage = Math.floor(this.filteredUsers().findIndex(user => user.id === result.user.id) / this.pageSize); create.open = false; username.value = ''; name.value = ''; this.renderUserList(true); this.secret(this.userDirectory.detail, 'Acceso de ' + result.user.username, result.accessCode); } finally { submit.disabled = false; } }); };
    const directory = el('div', undefined, body, 'studio-admin-directory'), list = el('section', undefined, directory, 'studio-admin-user-list'), detail = el('section', undefined, directory, 'studio-admin-user-detail');
    list.setAttribute('aria-label', 'Lista de usuarios'); detail.setAttribute('aria-label', 'Información del usuario seleccionado');
    const filters = el('div', undefined, list, 'studio-admin-user-filters'), search = field(filters, 'Buscar usuario o nombre', this.userQuery, 'search'); search.autocomplete = 'off'; search.placeholder = 'Escribe para filtrar…';
    const filterRow = el('div', undefined, filters, 'studio-admin-grid');
    const filterRole = choose(filterRow, 'Acceso', [{id: 'all', label: 'Todos los permisos'}, {id: 'admin', label: 'Superadministradores'}, {id: 'creator', label: 'Creadores'}, {id: 'viewer', label: 'Exploradores'}], this.userRole);
    const sort = choose(filterRow, 'Ordenar por', [{id: 'name', label: 'Nombre · A–Z'}, {id: 'seen', label: 'Último acceso'}, {id: 'storage', label: 'Mayor espacio usado'}], this.userSort);
    const status = el('p', '', list, 'studio-admin-list-status'); status.setAttribute('aria-live', 'polite');
    const scroll = el('div', undefined, list, 'studio-admin-table-scroll'), table = el('table', undefined, scroll); table.setAttribute('aria-label', 'Cuentas de SMART-TWIN Simulator'); const head = el('thead', undefined, table), header = el('tr', undefined, head);
    ['Usuario', 'Acceso', 'Proyectos', 'Espacio'].forEach(text => { const cell = el('th', text, header); cell.scope = 'col'; }); const rows = el('tbody', undefined, table);
    const pagination = el('div', undefined, list, 'studio-admin-pagination'), previous = action(pagination, '← Anterior', () => { this.userPage--; this.renderUserList(true); }), page = el('span', '', pagination), next = action(pagination, 'Siguiente →', () => { this.userPage++; this.renderUserList(true); });
    const size = choose(pagination, 'Por página', [{id: '25', label: '25'}, {id: '50', label: '50'}, {id: '100', label: '100'}], String(this.pageSize));
    this.userDirectory = {list, detail, rows, status, search, role: filterRole, sort, previous, page, next, size};
    search.oninput = () => { this.userQuery = search.value; this.userPage = 0; this.renderUserList(true); };
    filterRole.onchange = () => { this.userRole = filterRole.value; this.userPage = 0; this.renderUserList(true); };
    sort.onchange = () => { this.userSort = sort.value; this.userPage = 0; this.renderUserList(true); };
    size.onchange = () => { this.pageSize = Number(size.value); this.userPage = 0; this.renderUserList(true); };
    this.renderUserList(true);
  }
  filteredUsers() {
    const text = fold(this.userQuery), result = this.users.filter(user => (!text || fold(user.username + ' ' + user.displayName).includes(text)) && (this.userRole === 'all' || this.userRole === 'admin' ? this.userRole === 'all' || administrator(user) : !administrator(user) && user.role === this.userRole));
    return result.sort((a, b) => this.userSort === 'storage' ? Number((b.quota || {}).usedBytes || 0) - Number((a.quota || {}).usedBytes || 0) || a.username.localeCompare(b.username) : this.userSort === 'seen' ? new Date((b.quota || {}).lastSeenAt || 0) - new Date((a.quota || {}).lastSeenAt || 0) || a.username.localeCompare(b.username) : String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), 'es', {sensitivity: 'base'}));
  }
  renderUserList(selectPage = false) {
    const view = this.userDirectory; if (!view) return;
    const filtered = this.filteredUsers(), totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize)); this.userPage = Math.max(0, Math.min(this.userPage, totalPages - 1));
    const shown = filtered.slice(this.userPage * this.pageSize, (this.userPage + 1) * this.pageSize);
    if (!shown.some(user => user.id === this.selectedUserId) && selectPage) this.selectedUserId = shown[0] && shown[0].id;
    view.rows.textContent = ''; view.status.textContent = filtered.length + ' de ' + this.users.length + ' usuarios' + (filtered.length ? ' · ' + (this.userPage * this.pageSize + 1) + '–' + (this.userPage * this.pageSize + shown.length) : '');
    view.previous.disabled = this.userPage === 0; view.next.disabled = this.userPage + 1 >= totalPages; view.page.textContent = (this.userPage + 1) + ' / ' + totalPages;
    shown.forEach(user => {
      const row = el('tr', undefined, view.rows); row.className = user.id === this.selectedUserId ? 'is-selected' : ''; row.dataset.userId = user.id;
      const select = () => { if (this.selectedUserId === user.id) return; this.selectedUserId = user.id; this.renderUserList(); this.renderUserDetail(); }; row.onclick = select;
      const name = el('td', undefined, row), button = action(name, '', select); button.className = 'studio-admin-user-name'; button.setAttribute('aria-current', user.id === this.selectedUserId ? 'true' : 'false');
      el('strong', user.displayName || user.username, button); el('span', '@' + user.username, button);
      el('td', roleName(user), row); const quota = user.quota || {}; el('td', String(quota.projects || 0) + (administrator(user) ? '' : ' / ' + (quota.maxProjects || 2)), row); el('td', bytes(quota.usedBytes), row);
    });
    if (!shown.length) { const row = el('tr', undefined, view.rows), empty = el('td', 'No hay usuarios con estos filtros.', row); empty.colSpan = 4; }
    if (selectPage || !view.detail.children.length) this.renderUserDetail();
  }
  renderUserDetail() {
    const view = this.userDirectory; if (!view) return; const token = ++this.detailGeneration; view.detail.textContent = '';
    const user = this.users.find(value => value.id === this.selectedUserId);
    if (!user) { el('h3', 'Selecciona un usuario', view.detail); el('p', 'Su información y sus recursos aparecerán aquí.', view.detail, 'studio-muted'); return; }
    const scope = this.scope(), quota = user.quota || {}, isAdmin = administrator(user), card = view.detail;
    const head = el('div', undefined, card, 'studio-admin-detail-heading'), avatar = el('span', (user.displayName || user.username).slice(0, 1).toLocaleUpperCase('es'), head, 'studio-admin-user-avatar'), identity = el('div', undefined, head); avatar.setAttribute('aria-hidden', 'true'); el('h2', user.displayName || user.username, identity); el('p', '@' + user.username + ' · ' + roleName(user), identity, 'studio-muted');
    const metrics = el('div', undefined, card, 'studio-admin-user-metrics');
    [['Proyectos propios', String(quota.projects || 0) + (isAdmin ? '' : ' / ' + (quota.maxProjects || 2))], ['Espacio utilizado', bytes(quota.usedBytes)], ['Disponible', isAdmin ? 'Administrador' : bytes(quota.remainingBytes)]].forEach(([label, value]) => { const item = el('div', undefined, metrics); el('span', label, item); el('strong', value, item); });
    const metadata = el('dl', undefined, card, 'studio-admin-account-data'); [['Último acceso', date(quota.lastSeenAt || user.lastSeenAt)]].concat(user.createdAt ? [['Creación de cuenta', date(user.createdAt)]] : [], [['Identificador', user.id]]).forEach(([key, value]) => { el('dt', key, metadata); el('dd', value, metadata); });
    const usage = el('details', undefined, card); el('summary', 'Desglose del almacenamiento', usage); const breakdown = el('dl', undefined, usage, 'studio-admin-account-data');
    [['Documentos e historial', 'documentBytes'], ['Archivos importados', 'assetBytes'], ['Ejecuciones guardadas', 'checkpointBytes'], ['Progreso', 'progressBytes'], ['Datos de simulación', 'telemetryBytes'], ['Salas compartidas', 'roomBytes']].forEach(([label, key]) => { el('dt', label, breakdown); el('dd', bytes(quota[key]), breakdown); });
    const form = el('form', undefined, card, 'studio-form studio-admin-user-quota'); el('h3', 'Permisos y capacidad', form);
    const fields = el('div', undefined, form, 'studio-admin-grid'), maxProjects = field(fields, 'Máximo de proyectos', quota.maxProjects === undefined ? 2 : quota.maxProjects, 'number'); maxProjects.min = 1; maxProjects.max = 10000; maxProjects.step = 1;
    const storage = field(fields, 'Almacenamiento · MiB', (quota.storageBytes === undefined ? 20971520 : quota.storageBytes) / 1048576, 'number'); storage.min = 1 / 1024; storage.step = 'any';
    const permission = choose(form, 'Acceso al editor', [{id: 'creator', label: 'Creador'}, {id: 'viewer', label: 'Explorador'}], user.role); permission.disabled = isAdmin;
    if (isAdmin) el('p', 'La cuenta superadministradora conserva sus permisos y está exenta de la cuota de cuentas normales.', form, 'studio-muted');
    const status = this.detailStatus = el('p', '', form, 'studio-admin-save-status'); status.setAttribute('role', 'status');
    const save = el('button', 'Guardar límites y permiso', form); save.type = 'submit'; save.className = 'studio-primary';
    form.onsubmit = event => { event.preventDefault(); this.studio.guard(async () => {
      save.disabled = true; let quotaSaved = false;
      try {
        this.assertScope(scope); const count = Number(maxProjects.value), amount = Number(storage.value) * 1048576;
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(amount) || count < 1 || count > 10000 || amount < 1024 || amount > 1099511627776) throw new Error('Indica límites válidos: de 1 a 10.000 proyectos y al menos 1 KiB.');
        const result = await this.request('PUT', '/users/' + encodeURIComponent(user.id) + '/quota', {maxProjects: count, storageBytes: amount}); quotaSaved = true;
        const role = permission.value; let updated = result.user || Object.assign({}, user, {quota: Object.assign({}, quota, result.quota || {maxProjects: count, storageBytes: amount})});
        this.users = this.users.map(value => value.id === user.id ? updated : value);
        if (role !== user.role) { const target = await this.client.setUserRole(user.id, role); this.assertScope(scope); if (target) updated = target; else updated.role = role; }
        this.assertScope(scope); this.users = this.users.map(value => value.id === user.id ? updated : value);
        this.renderUserList();
        if (token === this.detailGeneration) { this.renderUserDetail(); this.detailStatus.textContent = 'Límites y permiso guardados.'; this.detailStatus.className = 'studio-admin-save-status is-success'; }
        this.studio.message('Configuración de @' + user.username + ' guardada.');
      } catch (error) { if (this.isScope(scope) && token === this.detailGeneration) { status.textContent = (quotaSaved ? 'La cuota se guardó. No se pudo completar el cambio de permiso: ' : '') + error.message; status.className = 'studio-admin-save-status is-error'; this.renderUserList(); } }
      finally { if (this.isScope(scope) && token === this.detailGeneration) save.disabled = false; }
    }); };
    const resources = el('section', undefined, card, 'studio-admin-user-resources'); el('h3', 'Recursos y avances', resources); const reportHost = el('div', undefined, resources);
    const load = action(resources, 'Consultar proyectos, misiones y evaluaciones', () => this.studio.guard(async () => {
      load.disabled = true; reportHost.textContent = 'Cargando información…';
      try {
        const cached = this.reportCache && this.reportCache.get(user.id);
        const report = cached || (await this.request('GET', '/reports?userId=' + encodeURIComponent(user.id))).report; this.assertScope(scope);
        if (!this.reportCache) this.reportCache = new Map(); this.reportCache.set(user.id, report);
        if (token !== this.detailGeneration) return; reportHost.textContent = ''; const student = report.students.find(value => value.user.id === user.id);
        if (student) this.reportStudent(reportHost, student); else el('p', 'No hay actividad registrada para esta cuenta.', reportHost, 'studio-muted');
      } catch (error) { if (this.isScope(scope) && token === this.detailGeneration) reportHost.textContent = error.message; }
      finally { if (this.isScope(scope) && token === this.detailGeneration) load.disabled = false; }
    }));
    el('p', 'Las cuentas normales sin actividad durante más de 30 días pierden sus archivos según la política automática. La cuenta administradora y los proyectos protegidos se conservan.', card, 'studio-muted studio-admin-retention');
  }
  async codesView(body) {
    el('h2', 'Registro con códigos', body); const groups = (await this.request('GET', '/groups')).groups;
    const policy = el('label', undefined, body), checkbox = el('input', undefined, policy); checkbox.type = 'checkbox'; checkbox.checked = this.policy.invitationOnly; el('span', ' Exigir código para nuevas cuentas', policy);
    checkbox.onchange = () => this.studio.guard(() => this.request('PUT', '/policy', {invitationOnly: checkbox.checked}));
    const form = el('form', undefined, body, 'studio-form'), name = field(form, 'Nombre del código', 'Práctica'), group = choose(form, 'Grupo', [{id: '', label: 'Sin grupo'}].concat(groups.map(value => ({id: value.id, label: value.name}))), ''), uses = field(form, 'Usos permitidos', 1, 'number'), days = field(form, 'Vigencia · días', 7, 'number'); uses.min = 1; uses.max = 1000; days.min = 1; days.max = 90;
    const submit = el('button', 'Generar código', form); submit.type = 'submit'; form.onsubmit = event => { event.preventDefault(); this.studio.guard(async () => { const result = await this.request('POST', '/codes', {name: name.value, groupId: group.value || null, maxUses: Number(uses.value), days: Number(days.value), role: 'creator'}); this.secret(body, 'Código de registro', result.code); }); };
    const values = (await this.request('GET', '/codes')).codes;
    values.forEach(code => { const card = el('div', undefined, body, 'studio-card'); el('strong', code.name + ' · …' + code.hint, card); el('p', code.used + '/' + code.maxUses + ' usos · Vence: ' + date(code.expiresAt) + (code.revoked ? ' · Revocado' : ''), card, 'studio-muted'); const revoke = action(card, 'Revocar', () => this.studio.guard(async () => { await this.request('DELETE', '/codes/' + code.id, {}); revoke.disabled = true; })); revoke.disabled = !!code.revoked; });
  }
  async groupsView(body) {
    el('h2', 'Grupos de docencia', body); const form = el('form', undefined, body, 'studio-form'), name = field(form, 'Nombre del grupo'), description = field(form, 'Descripción'); name.required = true;
    const submit = el('button', 'Crear grupo', form); submit.type = 'submit'; form.onsubmit = event => { event.preventDefault(); this.studio.guard(async () => { await this.request('POST', '/groups', {name: name.value, description: description.value}); await this.open(this.host, 'groups'); }); };
    const groups = (await this.request('GET', '/groups')).groups;
    groups.forEach(group => {
      const card = el('article', undefined, body, 'studio-card'); el('h3', group.name, card); el('p', group.description, card, 'studio-muted');
      const members = el('details', undefined, card); el('summary', 'Participantes · ' + group.members.length, members); const checkboxes = [];
      this.users.forEach(user => { const row = el('label', undefined, members), input = el('input', undefined, row); input.type = 'checkbox'; input.checked = group.members.some(member => member.userId === user.id); el('span', ' ' + user.displayName + ' · ' + user.username, row); checkboxes.push({input, id: user.id}); });
      action(members, 'Guardar participantes', () => this.studio.guard(async () => { await this.request('PUT', '/groups/' + group.id + '/members', {userIds: checkboxes.filter(value => value.input.checked).map(value => value.id)}); this.studio.message('Grupo actualizado.'); }));
      const assignment = el('form', undefined, card, 'studio-form'), title = field(assignment, 'Nueva práctica'), instructions = field(assignment, 'Instrucciones'), template = field(assignment, 'Plantilla o ejemplo de referencia · opcional'); title.required = true;
      const add = el('button', 'Asignar práctica', assignment); add.type = 'submit'; assignment.onsubmit = event => { event.preventDefault(); this.studio.guard(async () => { await this.request('POST', '/groups/' + group.id + '/assignments', {title: title.value, instructions: instructions.value, templateId: template.value}); await this.open(this.host, 'groups'); }); };
      group.assignments.forEach(value => { el('p', value.title + ' · ' + value.instructions, card); });
      action(card, 'Abrir informe y evaluar', () => this.studio.guard(async () => { this.body.textContent = ''; await this.reportsView(this.body, group.id); }));
    });
  }
  reportStudent(parent, student) {
    if (!student) return;
    const details = el('details', undefined, parent); details.open = true; el('summary', student.user.displayName + ' · avances y recursos', details);
    el('p', student.completed + '/' + student.recordedMissions + ' misiones registradas completadas · ' + student.projects.length + ' proyectos · ' + student.checkpoints.total + ' ejecuciones guardadas', details);
    student.projects.forEach(project => { const row = el('div', undefined, details); el('span', project.name + ' · v' + project.revision + ' ', row); action(row, 'Abrir proyecto', () => this.studio.guard(async () => {
      const scope = this.scope(), editor = this.studio.editor, value = await editor.projectClient.getProject(project.id); this.assertScope(scope);
      this.close(); this.studio.close();
      if (editor.editorEnabled) {
        if (!editor.active && editor.canEditDocument()) editor.enter();
        if (editor.active) await editor.openServerProject(value); else await editor.applyServerProject(value);
        editor.enter();
      } else { await editor.applyServerProject(value); this.studio.openEditor(); }
    })); });
    student.progress.forEach(progress => el('p', progress.missionId + ' · ' + progress.status + ' · paso ' + progress.step + ' · ' + date(progress.updatedAt), details, 'studio-muted'));
    student.evaluations.forEach(value => el('p', value.title + ': ' + value.score + '/100 · ' + value.feedback, details));
  }
  async reportsView(body, groupId = '') {
    el('h2', 'Informes de prácticas', body); const groups = (await this.request('GET', '/groups')).groups;
    const group = choose(body, 'Grupo', [{id: '', label: 'Todos los usuarios'}].concat(groups.map(value => ({id: value.id, label: value.name}))), groupId);
    group.onchange = () => this.studio.guard(async () => { body.textContent = ''; await this.reportsView(body, group.value); });
    const report = (await this.request('GET', '/reports' + (groupId ? '?groupId=' + encodeURIComponent(groupId) : ''))).report;
    el('p', report.totals.users + ' participantes · ' + report.totals.projects + ' proyectos · ' + report.totals.completedMissions + ' misiones completadas', body);
    el('p', report.progressSource, body, 'studio-muted');
    action(body, 'Descargar informe JSON', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'})), a = el('a'); a.href = url; a.download = 'informe-practicas.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
    report.students.forEach(student => {
      const card = el('article', undefined, body, 'studio-card'); this.reportStudent(card, student);
      if (report.group && report.group.assignments.length) {
        const assignment = choose(card, 'Práctica a evaluar', report.group.assignments.map(value => ({id: value.id, label: value.title})), report.group.assignments[0].id), score = field(card, 'Calificación · 0 a 100', '', 'number'), feedback = field(card, 'Retroalimentación'); score.min = 0; score.max = 100; score.step = .1;
        action(card, 'Guardar evaluación', () => this.studio.guard(async () => { if (score.value === '') throw new Error('Indica una calificación.'); await this.request('PUT', '/evaluations', {assignmentId: assignment.value, userId: student.user.id, score: Number(score.value), feedback: feedback.value}); this.studio.message('Evaluación guardada.'); }));
      }
    });
  }
  async publicationView(body) {
    el('h2', 'Escenas disponibles al público', body); el('p', 'Sólo dos escenas pueden estar activas sin iniciar sesión. La publicación entrega una copia de la sala elegida, con sus recursos autorizados.', body, 'studio-muted');
    const result = await this.studio.editor.projectClient.request('GET', '/publication/scenes');
    const preview = field(body, 'Vista previa temporal de todos los ejemplos incluidos', '', 'checkbox'); preview.checked = result.previewAllExamples === true;
    el('p', 'Este modo sólo muestra ejemplos del sistema, no publica proyectos privados y conserva la selección inferior. Al desactivarlo vuelven las dos escenas seleccionadas. GitHub Pages se revierte regenerando con --restricted y desplegando esa publicación.', body, 'studio-muted');
    action(body, 'Aplicar modo de ejemplos', () => this.studio.guard(async () => {await this.studio.editor.projectClient.request('PUT', '/publication/scenes', {previewAllExamples: preview.checked}); this.studio.message('Modo público actualizado; la selección guardada se conserva.');}));
    const projects = await this.studio.editor.projectClient.listProjects();
    const rows = el('div', undefined, body), values = [];
    (result.scenes || []).forEach(scene => {
      const card = el('div', undefined, rows, 'studio-card'), enabled = field(card, 'Activa sin iniciar sesión', '', 'checkbox'); enabled.checked = scene.enabled !== false;
      el('strong', scene.name || scene.id, card); el('p', (scene.projectId || 'Plantilla del sistema') + ' · ' + scene.roomId, card, 'studio-muted'); values.push({scene, enabled});
    });
    action(body, 'Guardar selección pública', () => this.studio.guard(async () => { await this.studio.editor.projectClient.request('PUT', '/publication/scenes', {scenes: values.map(value => Object.assign({}, value.scene, {enabled: value.enabled.checked}))}); this.studio.message('Disponibilidad pública actualizada.'); }));
    const create = el('form', undefined, body, 'studio-form'), id = field(create, 'Identificador de publicación'), name = field(create, 'Título público'), project = choose(create, 'Proyecto', projects.map(value => ({id: value.id, label: value.name})), projects[0] && projects[0].id), room = el('select', undefined, create);
    const refresh = async () => { room.textContent = ''; if (!project.value) return; const data = await this.studio.editor.projectClient.getProject(project.value); Object.keys(data.document.rooms).forEach(value => { const option = el('option', value, room); option.value = value; }); }; project.onchange = () => this.studio.guard(refresh); await refresh();
    const add = el('button', 'Añadir publicación desactivada', create); add.type = 'submit'; create.onsubmit = event => { event.preventDefault(); this.studio.guard(async () => { await this.studio.editor.projectClient.request('PUT', '/publication/scenes', {scenes: values.map(value => Object.assign({}, value.scene, {enabled: value.enabled.checked})).concat({id: id.value, name: name.value, projectId: project.value, roomId: room.value, enabled: false})}); await this.open(this.host, 'publication'); }); };
  }
}
