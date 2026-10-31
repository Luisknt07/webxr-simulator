let nextDialogId = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className) {
  const node = element('button', 'ed-project-button' + (className ? ' ' + className : ''), text);
  node.type = 'button';
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function timestamp(record, key) {
  return record[key + 'At'] || record[key + '_at'];
}

function dateLabel(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guayaquil'
  }).format(date);
}

function revisionNumber(record) {
  return record.revision !== undefined ? record.revision : record.version;
}

/** A project picker independent from the WebXR renderer and scene controls. */
export default class ProjectLibrary {
  constructor(client, callbacks = {}) {
    this.client = client;
    this.callbacks = callbacks;
    this.projects = [];
    this.selected = null;
    this.busy = false;
    this.loading = false;
    this.generation = 0;
    this.selectionGeneration = 0;
    this.idPrefix = 'ed-project-library-' + (++nextDialogId);
    this.build();
  }

  build() {
    const prefix = this.idPrefix;
    this.overlay = element('div', 'ed-project-overlay');
    this.overlay.hidden = true;
    this.dialog = element('section', 'ed-project-dialog');
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-labelledby', prefix + '-title');
    this.dialog.setAttribute('aria-describedby', prefix + '-description');
    this.dialog.tabIndex = -1;

    const header = element('header', 'ed-project-header');
    const heading = element('div');
    const title = element('h2', '', 'Proyectos y niveles');
    title.id = prefix + '-title';
    const description = element('p', '', 'Selecciona un proyecto y abre uno de sus niveles guardados.');
    description.id = prefix + '-description';
    heading.appendChild(title);
    heading.appendChild(description);
    this.closeButton = button('Cerrar');
    this.closeButton.addEventListener('click', () => { if (!this.busy) this.close(); });
    header.appendChild(heading);
    header.appendChild(this.closeButton);

    this.feedback = element('div', 'ed-project-feedback');
    this.feedback.hidden = true;
    this.feedback.setAttribute('role', 'alert');
    this.feedbackText = element('span');
    this.retryButton = button('Reintentar');
    this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', () => { if (this.retry) this.retry(); });
    this.feedback.appendChild(this.feedbackText);
    this.feedback.appendChild(this.retryButton);

    const content = element('div', 'ed-project-content');
    const browser = element('section', 'ed-project-browser');
    browser.setAttribute('aria-label', 'Biblioteca de proyectos');
    const searchField = element('label', 'ed-project-field', 'Buscar proyecto');
    this.search = element('input');
    this.search.type = 'search';
    this.search.placeholder = 'Nombre del proyecto';
    this.search.addEventListener('input', () => this.renderList());
    searchField.appendChild(this.search);
    const listHead = element('div', 'ed-project-list-head');
    this.listStatus = element('span');
    this.listStatus.setAttribute('role', 'status');
    this.refreshButton = button('Actualizar');
    this.refreshButton.addEventListener('click', () => this.loadProjects());
    listHead.appendChild(this.listStatus);
    listHead.appendChild(this.refreshButton);
    this.list = element('ul', 'ed-project-list');
    this.list.setAttribute('aria-label', 'Proyectos guardados');
    browser.appendChild(searchField);
    browser.appendChild(listHead);
    browser.appendChild(this.list);
    this.details = element('section', 'ed-project-details');
    this.details.setAttribute('aria-label', 'Detalles y versiones del proyecto');
    content.appendChild(browser);
    content.appendChild(this.details);

    const forms = element('div', 'ed-project-forms');
    const create = this.nameForm('Crear proyecto', 'Nombre del proyecto', 'Mi escenario', 'Crear', name => this.callbacks.onNew(name));
    const copy = this.nameForm('Guardar una copia del escenario actual', 'Nombre de la copia', 'Copia de mi escenario', 'Guardar copia', name => this.callbacks.onSaveAs(name));
    this.createName = create.input;
    this.copyName = copy.input;
    forms.appendChild(create.form);
    forms.appendChild(copy.form);

    this.progress = element('p', 'ed-project-progress');
    this.progress.setAttribute('role', 'status');
    this.progress.hidden = true;
    this.dialog.appendChild(header);
    this.dialog.appendChild(this.feedback);
    this.dialog.appendChild(content);
    this.dialog.appendChild(forms);
    this.dialog.appendChild(this.progress);
    this.overlay.appendChild(this.dialog);
    this.overlay.addEventListener('mousedown', event => {
      if (event.target === this.overlay && !this.busy) this.close();
    });
    this.overlay.addEventListener('keydown', event => this.onKey(event));
    document.body.appendChild(this.overlay);
    this.renderDetails();
  }

  nameForm(title, label, placeholder, submitLabel, action) {
    const form = element('form', 'ed-project-name-form');
    form.appendChild(element('h3', '', title));
    const field = element('label', 'ed-project-field', label);
    const input = element('input');
    input.type = 'text';
    input.required = true;
    input.maxLength = 120;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    field.appendChild(input);
    const submit = button(submitLabel, 'primary');
    submit.type = 'submit';
    form.appendChild(field);
    form.appendChild(submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      this.runAction(() => action(name), 'Guardando proyecto…');
    });
    return { form, input };
  }

  async open(mode = 'projects') {
    if (this.overlay.hidden) this.previousFocus = document.activeElement;
    this.overlay.hidden = false;
    this.mode = mode;
    this.clearError();
    (mode === 'saveAs' ? this.copyName : this.search).focus();
    if (mode === 'saveAs') this.copyName.select();
    await this.loadProjects();
  }

  close() {
    this.generation++;
    this.selectionGeneration++;
    this.overlay.hidden = true;
    if (this.previousFocus && this.previousFocus.isConnected !== false) this.previousFocus.focus();
  }

  async loadProjects() {
    if (this.busy) return;
    const generation = ++this.generation;
    this.selectionGeneration++;
    this.loading = true;
    this.clearError();
    this.refreshButton.disabled = true;
    this.listStatus.textContent = 'Cargando proyectos…';
    this.list.setAttribute('aria-busy', 'true');
    try {
      const projects = await this.client.listProjects();
      if (generation !== this.generation || this.overlay.hidden) return;
      this.projects = projects;
      const current = this.callbacks.getCurrentProject && this.callbacks.getCurrentProject();
      const selectedId = this.selected && this.selected.id || current && current.id;
      this.selected = projects.find(project => project.id === selectedId) || null;
      this.loading = false;
      this.renderList();
      if (this.selected) await this.selectProject(this.selected);
      else this.renderDetails();
    } catch (error) {
      if (generation !== this.generation || this.overlay.hidden) return;
      this.listStatus.textContent = 'No se pudo cargar la biblioteca.';
      this.showError(error, () => this.loadProjects());
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.refreshButton.disabled = this.busy;
        this.list.setAttribute('aria-busy', 'false');
      }
    }
  }

  renderList() {
    clear(this.list);
    const query = this.search.value.trim().toLocaleLowerCase('es');
    const projects = this.projects.filter(project => project.name.toLocaleLowerCase('es').includes(query));
    this.listStatus.textContent = this.loading ? 'Cargando proyectos…' : projects.length + (projects.length === 1 ? ' proyecto' : ' proyectos');
    if (!projects.length) {
      this.list.appendChild(element('li', 'ed-project-empty', this.loading ? 'Cargando…' : query ? 'No hay proyectos con ese nombre.' : 'Aún no hay proyectos. Crea uno o guarda una copia del escenario actual.'));
    }
    projects.forEach(project => {
      const item = element('li');
      const selected = !!this.selected && this.selected.id === project.id;
      const select = button('', 'ed-project-card' + (selected ? ' selected' : ''));
      select.setAttribute('data-project-id', project.id);
      select.setAttribute('aria-pressed', String(selected));
      select.disabled = this.busy;
      select.appendChild(element('strong', '', project.name));
      const current = this.callbacks.getCurrentProject && this.callbacks.getCurrentProject();
      if (current && current.id === project.id) select.appendChild(element('span', 'ed-project-current-label', 'Proyecto abierto'));
      select.appendChild(element('span', '', 'Guardado: ' + dateLabel(timestamp(project, 'updated'))));
      select.addEventListener('click', () => this.selectProject(project));
      item.appendChild(select);
      this.list.appendChild(item);
    });
  }

  renderDetails() {
    clear(this.details);
    this.revisionSelect = null;
    this.versionButton = null;
    this.revisionCount = 0;
    if (!this.selected) {
      this.details.appendChild(element('p', 'ed-project-empty', 'Selecciona un proyecto para abrirlo o recuperar una versión anterior.'));
      return;
    }
    const project = this.selected;
    this.details.appendChild(element('h3', 'ed-project-name', project.name));
    const metadata = element('dl', 'ed-project-metadata');
    [['Creado', dateLabel(timestamp(project, 'created'))], ['Último guardado', dateLabel(timestamp(project, 'updated'))]].forEach(pair => {
      metadata.appendChild(element('dt', '', pair[0]));
      metadata.appendChild(element('dd', '', pair[1]));
    });
    this.details.appendChild(metadata);
    const storage=project.storage;if(storage&&storage.relativePath){const location=element('p','ed-project-hint');location.appendChild(element('strong','','Carpeta en datos del servidor: '));location.appendChild(element('code','',storage.relativePath+'/Content'));this.details.appendChild(location);}
    const open = button('Abrir proyecto', 'primary');
    open.addEventListener('click', () => this.openProject(project.id));
    open.disabled = this.busy;
    this.details.appendChild(open);
    this.levelList = null;
    if (this.callbacks.listLevels) {
      const levels = element('section', 'ed-project-levels');
      levels.appendChild(element('h4', '', 'Niveles de este proyecto'));
      this.levelList = element('div', 'ed-project-level-list');
      this.levelStatus = element('p', 'ed-project-hint', 'Cargando niveles…');
      this.levelStatus.setAttribute('role', 'status');
      levels.appendChild(this.levelStatus); levels.appendChild(this.levelList); this.details.appendChild(levels);
    }
    const versions = element('div', 'ed-project-versions');
    const label = element('label', 'ed-project-field', 'Historial de versiones');
    this.revisionSelect = element('select');
    this.revisionSelect.disabled = true;
    const current = element('option', '', 'Versión actual');
    current.value = '';
    this.revisionSelect.appendChild(current);
    this.revisionSelect.addEventListener('change', () => {
      this.versionButton.disabled = this.busy || !this.revisionSelect.value;
    });
    label.appendChild(this.revisionSelect);
    this.revisionStatus = element('p', 'ed-project-hint', 'Cargando versiones…');
    this.revisionStatus.setAttribute('role', 'status');
    this.versionButton = button('Abrir versión');
    this.versionButton.disabled = true;
    this.versionButton.addEventListener('click', () => {
      if (this.revisionSelect.value) this.openProject(project.id, Number(this.revisionSelect.value));
    });
    versions.appendChild(label);
    versions.appendChild(this.revisionStatus);
    versions.appendChild(this.versionButton);
    this.details.appendChild(versions);
  }

  async selectProject(project) {
    if (this.busy) return;
    const selectionGeneration = ++this.selectionGeneration;
    this.selected = project;
    this.clearError();
    this.renderList();
    this.renderDetails();
    const tasks = await Promise.allSettled([
      this.client.listRevisions(project.id),
      this.callbacks.listLevels ? this.client.getProject(project.id).then(value => this.callbacks.listLevels(value)) : Promise.resolve(null)
    ]);
    if (selectionGeneration !== this.selectionGeneration || this.overlay.hidden) return;
    if (tasks[0].status === 'fulfilled') {
      const revisions = tasks[0].value;
      revisions.forEach(revision => {
        const number = revisionNumber(revision);
        const option = element('option', '', 'Versión ' + number + ' · ' + dateLabel(timestamp(revision, 'created')));
        option.value = String(number);
        this.revisionSelect.appendChild(option);
      });
      this.revisionCount = revisions.length;
      this.revisionStatus.textContent = revisions.length + (revisions.length === 1 ? ' versión guardada.' : ' versiones guardadas.') + ' Abrir una versión no borra el historial.';
      this.revisionSelect.disabled = this.busy || !revisions.length;
    } else {
      this.revisionStatus.textContent = 'El historial no está disponible. Puedes abrir la versión actual.';
      this.showError(tasks[0].reason, () => this.selectProject(project));
    }
    if (this.callbacks.listLevels && tasks[1].status === 'fulfilled') {
      const levels = tasks[1].value;
      this.levelStatus.textContent = levels.length + ' niveles · abrir un nivel cambia al proyecto seleccionado.';
      levels.forEach(level => {
        const open = button(level.name + (level.initial ? ' · inicial' : ''), 'ed-project-level');
        open.setAttribute('data-room-id', level.id);
        open.setAttribute('aria-label', 'Abrir nivel ' + level.name + ' de ' + project.name);
        open.disabled = this.busy;
        open.addEventListener('click', () => this.openProject(project.id, undefined, level.id));
        this.levelList.appendChild(open);
      });
    } else if (this.callbacks.listLevels) {
      this.levelStatus.textContent = 'No se pudieron consultar los niveles. Puedes reintentar o abrir el proyecto.';
      this.showError(tasks[1].reason, () => this.selectProject(project));
    }
  }

  openProject(id, revision, roomId) {
    return this.runAction(async () => {
      const project = await this.client.getProject(id, revision);
      return this.callbacks.onOpen(project, roomId);
    }, 'Abriendo proyecto…');
  }

  async runAction(action, progress) {
    if (this.busy) return;
    this.clearError();
    this.setBusy(true, progress);
    try {
      const result = await action();
      if (result !== false) this.close();
    } catch (error) {
      this.showError(error);
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(busy, progress = '') {
    this.busy = busy;
    this.dialog.setAttribute('aria-busy', String(busy));
    // Remember individual states: history stays disabled until it has loaded.
    if (busy) {
      this.actionFocus = document.activeElement;
      this.disabledStates = Array.from(this.dialog.querySelectorAll('button, input, select')).map(node => [node, node.disabled]);
      this.disabledStates.forEach(pair => { pair[0].disabled = true; });
      // Disabled controls can lose focus to the page; keep shortcuts inside the modal.
      this.dialog.focus();
    } else if (this.disabledStates) {
      this.disabledStates.forEach(pair => { pair[0].disabled = pair[1]; });
      this.disabledStates = null;
      this.refreshButton.disabled = this.loading;
      if (this.revisionSelect) this.revisionSelect.disabled = !this.revisionCount;
      if (this.versionButton) this.versionButton.disabled = !this.revisionSelect.value;
      if (!this.overlay.hidden && this.actionFocus && this.actionFocus.isConnected && !this.actionFocus.disabled) this.actionFocus.focus();
    }
    this.progress.hidden = !busy;
    this.progress.textContent = progress;
  }

  clearError() {
    this.feedback.hidden = true;
    this.retry = null;
    this.retryButton.hidden = true;
  }

  showError(error, retry) {
    this.feedbackText.textContent = error && error.message ? error.message : 'No se pudo completar la operación. Inténtalo otra vez.';
    this.retry = retry || null;
    this.retryButton.hidden = !retry;
    this.feedback.hidden = false;
  }

  onKey(event) {
    // Keyboard shortcuts in the editor must never modify a scene behind this dialog.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.busy) this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(this.dialog.querySelectorAll('button, input, select, [tabindex]'))
      .filter(node => !node.disabled && !node.hidden && !node.closest('[hidden]') && node.tabIndex >= 0);
    if (!focusable.length) { event.preventDefault(); this.dialog.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === this.dialog)) {
      event.preventDefault(); first.focus();
    }
  }
}
