import {STUDY_SCENES} from './StudySceneCatalog.js';

const element = (tag, text, parent, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; if (parent) parent.appendChild(node); return node; };

/** A creation choice precedes any scene mutation. All builders remain owned by
 * StudioTools, so cancellation never creates a room or writes a project. */
export default class SceneCreationDialog {
  constructor(editor) { this.editor = editor; this.pending = null; }
  request(options = {}) {
    if (this.pending) return this.pending;
    const editor = this.editor, previous = document.activeElement;
    const dialog = element('dialog', undefined, editor.ui, 'ed-scene-create'); this.dialog = dialog;
    dialog.setAttribute('aria-label', 'Crear escenario');
    const form = element('form', undefined, dialog);
    const isProject = options.mode === 'project';
    element('h2', isProject ? 'Crear proyecto' : 'Crear escenario', form); element('p', isProject ? 'Elige el primer escenario del nuevo proyecto. Tu proyecto actual conserva sus cambios.' : 'Elige cómo empezar. Cada opción crea un nivel independiente dentro del proyecto actual.', form, 'ed-hint');
    const field = element('label', isProject ? 'Nombre del proyecto' : 'Nombre del escenario', form), name = element('input', undefined, field); name.type = 'text'; name.maxLength = isProject ? 120 : 160; name.value = options.name || (isProject ? 'Nuevo proyecto' : 'Nuevo escenario'); name.required = true;
    const choices = element('div', undefined, form, 'ed-scene-create-choices'); let kind = 'empty'; const controls = new Map();
    const kinds = [['empty', 'Vacío', 'Suelo, cielo, iluminación y punto de entrada listos para configurar.'], ['template', 'Desde una plantilla', isProject ? 'Una línea funcional de los ejemplos incluidos.' : 'Una línea funcional incluida o una plantilla guardada en este proyecto.'], ['guided', 'Con guía', 'Describe el proceso y revisa una propuesta antes de construirlo.']];
    kinds.forEach(([id, title, description]) => {
      const button = element('button', undefined, choices, 'ed-scene-create-choice'); button.type = 'button'; button.setAttribute('aria-pressed', String(id === kind));
      element('strong', title, button); element('span', description, button); controls.set(id, button);
      button.addEventListener('click', () => { kind = id; render(); });
    });
    const templateField = element('label', 'Plantilla de inicio', form), template = element('select', undefined, templateField);
    const included = element('optgroup', undefined, template); included.label = 'Ejemplos incluidos';
    STUDY_SCENES.forEach(scene => { const option = element('option', scene.family + ' · ' + scene.title, included); option.value = 'included:' + scene.id; });
    const saved = isProject ? [] : editor.document.studio && editor.document.studio.templates || [];
    if (saved.length) { const group = element('optgroup', undefined, template); group.label = 'Plantillas de este proyecto'; saved.forEach(item => { const option = element('option', item.name, group); option.value = 'saved:' + item.id; }); }
    const description = element('p', '', form, 'ed-scene-create-description');
    const error = element('p', '', form, 'ed-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const actions = element('div', undefined, form, 'ed-scene-create-actions'), cancel = element('button', 'Cancelar', actions), submit = element('button', 'Crear escenario', actions, 'primary'); cancel.type = 'button'; submit.type = 'submit';
    let resolve; this.pending = new Promise(done => { resolve = done; });
    const finish = value => { if (!this.pending) return; this.pending = null; if (dialog.open && dialog.close) dialog.close(); dialog.remove(); this.dialog = null; if (previous && previous.isConnected !== false && previous.focus) previous.focus(); resolve(value); };
    this.cancel = () => finish(null);
    const render = () => {
      controls.forEach((button, id) => button.setAttribute('aria-pressed', String(id === kind))); templateField.hidden = kind !== 'template';
      const definition = STUDY_SCENES.find(scene => 'included:' + scene.id === template.value), custom = saved.find(item => 'saved:' + item.id === template.value);
      description.textContent = kind === 'template' ? definition ? definition.description : custom ? 'Se conservan las propiedades, funciones y vínculos internos de «' + custom.name + '».' : '' : kind === 'guided' ? 'La guía se abrirá en el nuevo escenario. La propuesta siempre se puede revisar antes de aplicarla.' : isProject ? 'Un proyecto independiente con un escenario preparado para tus equipos. El proyecto actual conserva sus cambios.' : 'Un espacio preparado para añadir tus propios equipos. Puedes deshacer la creación completa.';
      submit.textContent = kind === 'guided' ? 'Crear y abrir la guía' : kind === 'template' ? 'Crear desde plantilla' : isProject ? 'Crear proyecto vacío' : 'Crear escenario vacío';
    };
    template.addEventListener('change', render); cancel.addEventListener('click', this.cancel);
    form.addEventListener('submit', event => { event.preventDefault(); const value = name.value.trim(); if (!value || value.length > name.maxLength) { error.textContent = 'Escribe un nombre de hasta ' + name.maxLength + ' caracteres.'; error.hidden = false; name.focus(); return; } finish({kind, name: value, templateId: kind === 'template' ? template.value : null}); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.cancel(); });
    dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); this.cancel(); } });
    editor.clearNavigation(); render(); if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); name.focus(); name.select(); return this.pending;
  }
  dispose() { if (this.cancel) this.cancel(); }
}
