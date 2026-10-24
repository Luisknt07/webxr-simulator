import materialSchema from '../../shared/materials.js';
import wearSchema from '../../shared/wear.js';

const PATTERNS = [['rust', 'Óxido'], ['grime', 'Suciedad'], ['scratches', 'Rayaduras'], ['chipped', 'Pintura saltada']];

function node(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}
function action(parent, label, callback, disabled = false) {
  const value = node('button', label, 'ed-button'); value.type = 'button'; value.disabled = disabled;
  value.addEventListener('click', callback); parent.appendChild(value); return value;
}
function select(options, value) {
  const input = node('select');
  options.forEach(option => { const item = node('option', option.label); item.value = option.value; input.appendChild(item); });
  input.value = value; return input;
}

/** Author-facing PBR settings and editable, actor-owned brush layers. */
export default class MaterialInspector {
  constructor(editor) { this.editor = editor; this.clipboard = null; this.selectedLayer = null; this.targets = new WeakMap(); }

  behavior(object) { return this.editor.document.getBehaviors(object).find(item => item.type === 'surfaceMaterial'); }

  assignments(object) {
    const behavior = this.behavior(object);
    return behavior ? materialSchema.assignments(behavior) : [];
  }

  target(object, slots = this.editor.materials.getSlots(object)) {
    const selected = this.targets.get(object);
    if (selected && slots.some(slot => slot.value === selected)) return selected;
    const current = this.assignments(object)[0];
    const fallback = current && slots.find(slot => slot.value === current.slot) ||
      slots.find(slot => slot.value.startsWith('mesh:')) || slots.find(slot => slot.value.startsWith('part:')) || slots[0];
    const value = fallback ? fallback.value : current ? current.slot : 'all';
    this.targets.set(object, value); return value;
  }

  selected(object, slot = this.target(object)) { return this.assignments(object).find(item => item.slot === slot); }

  defaults(object, slot = this.target(object)) {
    const values = this.editor.materials.getSlotDefaults ? this.editor.materials.getSlotDefaults(object, slot) : {};
    return Object.assign({type: 'surfaceMaterial', enabled: true}, materialSchema.getPreset('custom'), values, {slot});
  }

  write(object, assignments) {
    return this.editor.perform(() => {
      const list = this.editor.document.getBehaviors(object).filter(item => item.type !== 'surfaceMaterial');
      if (assignments.length) list.push(materialSchema.fromAssignments(assignments, this.behavior(object) ? this.behavior(object).enabled : true));
      this.editor.document.setBehaviors(object, list);
    });
  }

  /** Replace only one destination; the clipboard never carries its old selector. */
  update(object, config, slot = this.target(object)) {
    const list = this.assignments(object), index = list.findIndex(item => item.slot === slot);
    if (config) {
      const value = Object.assign({}, config, {type: 'surfaceMaterial', slot}); delete value.overrides;
      if (index >= 0) list[index] = value; else list.push(value);
    } else if (index >= 0) list.splice(index, 1);
    return this.write(object, list);
  }

  applyTexture(object, asset) {
    const slot = this.target(object);
    return this.update(object, Object.assign({}, this.selected(object, slot) || this.defaults(object, slot), {texture: asset, colorMapMode: 'preserve'}), slot);
  }

  input(parent, field, value, update) {
    const editor = this.editor;
    let input;
    if (field.options) input = select(field.options, value);
    else if (field.input === 'image') {
      const options = [{value: '', label: field.key === 'texture' ? 'Original / procedural' : 'Original del modelo'}]
        .concat((editor.entries || []).filter(entry => entry.kind === 'image').map(entry => ({value: entry.importId || entry.path, label: entry.name})));
      if (value && !options.some(option => option.value === value)) options.push({value, label: value});
      input = select(options, value);
    } else {
      input = node('input'); input.type = field.input === 'color' ? 'color' : field.input === 'number' ? 'number' : field.input === 'checkbox' ? 'checkbox' : 'text';
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
      ['min', 'max', 'step', 'maxLength'].forEach(key => { if (field[key] !== undefined) input[key] = field[key]; });
    }
    input.setAttribute('aria-label', field.label);
    editor.field(parent, field.label, input).addEventListener('change', () => update(field.key,
      field.input === 'number' ? Number(input.value) : field.input === 'checkbox' ? input.checked : input.value));
    return input;
  }

  details(parent, label, open = false) {
    const group = node('details', undefined, 'ed-material-details'); group.open = open;
    group.appendChild(node('summary', label)); parent.appendChild(group); return group;
  }

  render(object) {
    const editor = this.editor;
    const behavior = this.behavior(object);
    const slots = editor.materials.getSlots(object);
    if (!slots.length && !behavior) {
      if (editor.document.getBehaviors(object).some(item => item.type === 'surfaceWear')) this.renderWear(object);
      return;
    }
    const section = editor.section('MATERIAL · SUPERFICIE');
    const assignments = this.assignments(object), options = slots.map(slot => ({value: slot.value, label: slot.label}));
    assignments.forEach(item => { if (!options.some(option => option.value === item.slot)) options.push({value: item.slot, label: item.slot + ' · destino guardado'}); });
    const slot = this.target(object, options), current = this.selected(object, slot);
    this.input(section, {key: 'target', label: 'Parte o material a editar', options}, slot, (key, value) => {
      this.targets.set(object, value); editor.renderInspector();
    });
    section.appendChild(node('p', 'Selecciona una parte antes de cambiar su acabado. Cada parte conserva su material; pantallas, indicadores y botones mantienen su función.', 'ed-hint'));
    section.appendChild(node('p', 'Para cambiar un pulsador, selecciónalo en la jerarquía y elige su superficie exacta. Su efecto al presionarlo se conserva.', 'ed-hint'));
    if (slot === 'all') section.appendChild(node('p', 'Este destino aplica el acabado a todas las superficies compatibles. Elige una parte para personalizarla por separado.', 'ed-hint'));
    const choice = select([{value: '__original', label: 'Material original de esta parte'}].concat(materialSchema.presets.map(preset => ({value: preset.id, label: preset.label}))), current ? current.preset : '__original');
    choice.setAttribute('aria-label', 'Acabado del material');
    editor.field(section, 'Acabado', choice).addEventListener('change', () => {
      if (choice.value === '__original') this.update(object, null, slot);
      else {
        const previous = current || this.defaults(object, slot);
        const maps = {};
        ['texture', 'normalMap', 'roughnessMap', 'metalnessMap', 'colorMapMode', 'repeatX', 'repeatY'].forEach(key => { maps[key] = previous[key]; });
        this.update(object, Object.assign({type: 'surfaceMaterial', enabled: true}, choice.value === 'custom' ? previous : materialSchema.getPreset(choice.value), maps, {preset: choice.value, slot}), slot);
      }
    });
    const values = current || this.defaults(object, slot);
    const update = (key, value) => this.update(object, Object.assign({}, values, {[key]: value}, key === 'texture' && value ? {colorMapMode: 'preserve'} : {},
      key === 'colorMapMode' && value === 'none' ? {texture: ''} : {}), slot);
    if (behavior) this.input(section, {key: 'enabled', label: 'Mostrar materiales personalizados', input: 'checkbox'}, behavior.enabled, (key, value) => editor.perform(() => editor.document.setBehaviors(object,
      editor.document.getBehaviors(object).map(item => item.type === 'surfaceMaterial' ? Object.assign({}, item, {enabled: value}) : item))));
    if (current) {
      const groups = {
        base: this.details(section, 'Color y acabado', true),
        maps: this.details(section, 'Texturas y relieve'),
        wear: this.details(section, 'Desgaste general')
      };
      materialSchema.fields.filter(field => !['preset', 'slot'].includes(field.key)).forEach(field => {
        const group = ['wear', 'wearType', 'wearScale', 'seed'].includes(field.key) ? groups.wear : ['colorMapMode', 'texture', 'normalMap', 'roughnessMap', 'metalnessMap', 'repeatX', 'repeatY'].includes(field.key) ? groups.maps : groups.base;
        this.input(group, field, current[field.key], update);
      });
      groups.maps.appendChild(node('p', 'Conservar textura combina el color con la imagen del modelo. Color sólido elimina solo la imagen de color y mantiene los mapas de relieve, rugosidad y metalizado. Importa mapas propios en Archivos del proyecto.', 'ed-hint'));
      if (current.preset === 'glass') groups.base.appendChild(node('p', 'Vidrio con transparencia y reflejos del entorno disponible en la escena.', 'ed-hint'));
    } else this.input(section, {key: 'color', label: 'Color base', input: 'color'}, values.color, update);
    const actions = node('div', undefined, 'ed-material-actions'); section.appendChild(actions);
    action(actions, 'Copiar material', () => { this.clipboard = JSON.parse(JSON.stringify(current)); delete this.clipboard.slot; editor.toast('Material copiado. Elige la parte de destino y pulsa Pegar material.'); editor.renderInspector(); }, !current);
    action(actions, 'Pegar material', () => this.update(object, this.clipboard, slot), !this.clipboard);
    action(actions, 'Restaurar esta parte', () => this.update(object, null, slot), !current);
    if (assignments.length) {
      const assigned = this.details(section, 'Materiales asignados · ' + assignments.length, true);
      assignments.forEach(item => {
        const row = node('div', undefined, 'ed-material-actions'); assigned.appendChild(row);
        const target = options.find(option => option.value === item.slot);
        row.appendChild(node('span', item.name + ' · ' + (target ? target.label : item.slot)));
        action(row, 'Editar material asignado', () => { this.targets.set(object, item.slot); editor.renderInspector(); });
        action(row, 'Quitar material asignado', () => this.update(object, null, item.slot));
      });
      action(assigned, 'Restaurar todos los materiales', () => this.write(object, []));
    }
    if (object.userData.editorColor) action(section, 'Restaurar colores originales', () => editor.perform(() => editor.document.setProperty(object, 'color', null)));
    this.renderWear(object);
  }

  renderWear(object) {
    const editor = this.editor;
    const section = editor.section('DESGASTE · BROCHA');
    const settings = editor.wearBrushSettings;
    section.appendChild(node('p', 'Arrastra sobre esta pieza para aplicar desgaste. Cada trazo se puede editar, deshacer o eliminar.', 'ed-hint'));
    const types = PATTERNS.map(([value, label]) => ({value, label}));
    const update = (key, value) => {
      settings[key] = value;
      if (key === 'pattern') {
        const defaults = wearSchema.patternDefaults[value];
        settings.roughness = defaults.roughness; settings.metalness = defaults.metalness;
      }
      editor.renderInspector();
    };
    this.input(section, {key: 'pattern', label: 'Efecto de la brocha', options: types}, settings.pattern, update);
    this.input(section, {key: 'size', label: 'Diámetro (m)', input: 'number', min: 0.01, max: 5, step: 0.01}, settings.size, update);
    this.input(section, {key: 'opacity', label: 'Intensidad', input: 'number', min: 0, max: 1, step: 0.05}, settings.opacity, update);
    const advanced = this.details(section, 'Ajustes de la brocha');
    [
      {key: 'color', label: 'Tinte del efecto', input: 'color'},
      {key: 'density', label: 'Densidad', input: 'number', min: 0, max: 1, step: 0.05},
      {key: 'depth', label: 'Profundidad (m)', input: 'number', min: 0.001, max: 2, step: 0.01},
      {key: 'roughness', label: 'Rugosidad', input: 'number', min: 0, max: 1, step: 0.05},
      {key: 'metalness', label: 'Metalizado', input: 'number', min: 0, max: 1, step: 0.05}
    ].forEach(field => this.input(advanced, field, settings[field.key], update));
    action(section, editor.wearBrush ? 'Terminar brocha · Esc' : 'Pintar sobre este objeto', () => {
      if (editor.wearBrush) editor.stopWearBrush(); else editor.startWearBrush(object);
      editor.renderInspector();
    });
    const config = editor.document.getBehaviors(object).find(item => item.type === 'surfaceWear');
    const layers = config ? wearSchema.normalizeLayers(config.layers) : [];
    if (!layers.length) return;
    const group = this.details(section, 'Capas aplicadas · ' + layers.length, true);
    const updateLayers = values => editor.perform(() => {
      const list = editor.document.getBehaviors(object).filter(item => item.type !== 'surfaceWear');
      if (values.length) list.push({type: 'surfaceWear', enabled: config.enabled, layers: wearSchema.normalizeLayerJSON(values)});
      editor.document.setBehaviors(object, list);
    });
    this.input(group, {key: 'enabled', label: 'Mostrar desgaste', input: 'checkbox'}, config.enabled, (key, value) => editor.perform(() => editor.document.setBehaviors(object,
      editor.document.getBehaviors(object).map(item => item.type === 'surfaceWear' ? Object.assign({}, item, {enabled: value}) : item))));
    const selected = layers.find(layer => layer.id === this.selectedLayer) || layers[layers.length - 1]; this.selectedLayer = selected.id;
    this.input(group, {key: 'layer', label: 'Capa', options: layers.map((layer, index) => ({value: layer.id, label: (index + 1) + ' · ' + (PATTERNS.find(item => item[0] === layer.pattern) || [null, layer.pattern])[1] + ' · ' + Math.max(1, layer.stamps.length) + ' marcas'}))}, selected.id,
      (key, value) => { this.selectedLayer = value; editor.renderInspector(); });
    const edit = (key, value) => updateLayers(layers.map(layer => layer === selected ? Object.assign({}, layer, {[key]: value}) : layer));
    this.input(group, {key: 'pattern', label: 'Efecto de la capa', options: types}, selected.pattern, edit);
    [
      {key: 'opacity', label: 'Opacidad de capa', input: 'number', min: 0, max: 1, step: 0.05},
      {key: 'density', label: 'Densidad de capa', input: 'number', min: 0, max: 1, step: 0.05},
      {key: 'color', label: 'Tinte de capa', input: 'color'},
      {key: 'roughness', label: 'Rugosidad de capa', input: 'number', min: 0, max: 1, step: 0.05},
      {key: 'metalness', label: 'Metalizado de capa', input: 'number', min: 0, max: 1, step: 0.05},
      {key: 'width', label: 'Ancho de marca (m)', input: 'number', min: 0.01, max: 100, step: 0.01},
      {key: 'height', label: 'Alto de marca (m)', input: 'number', min: 0.01, max: 100, step: 0.01},
      {key: 'seed', label: 'Variación de capa', input: 'number', min: 0, max: 2147483647, step: 1}
    ].forEach(field => this.input(group, field, selected[field.key], edit));
    action(group, 'Eliminar capa', () => updateLayers(layers.filter(layer => layer !== selected)));
    action(group, 'Quitar todo el desgaste', () => updateLayers([]));
  }
}
