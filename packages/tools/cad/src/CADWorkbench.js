import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import cad from '../schema/cad.js';

const copy = value => JSON.parse(JSON.stringify(value));
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function action(label, fn) { const e = node('button', label, 'ed-button'); e.type = 'button'; e.onclick = fn; return e; }
function field(parent, label, input) { const e = node('label', undefined, 'cad-field'); e.append(node('span', label), input); parent.appendChild(e); return input; }

/** On-demand, bounded modelling workbench. The CSG kernel stays in a worker. */
export default class CADWorkbench {
  constructor(editor) { this.editor = editor; this.generation = 0; }
  open(object = null) {
    this.close();
    const descriptor = object && object.userData.editorDescriptor;
    this.object = descriptor && descriptor.type === 'cad' ? object : null;
    this.recipe = this.object ? copy(descriptor.recipe) : {version: 1, steps: [{id: 's1', op: 'solid.roundedBox', params: {}, inputs: []}], output: 's1'};
    this.color = this.object ? descriptor.color : '#b6c4cc'; this.smoothingAngle = this.object && descriptor.smoothingAngle !== undefined ? descriptor.smoothingAngle : 45; this.attachment = this.object && descriptor.attachment ? copy(descriptor.attachment) : null; this.sketchState = new Map();
    this.selectedStep = this.recipe.output; this.result = null; this.dirty = true;
    this.overlay = node('div', undefined, 'cad-overlay'); this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-modal', 'true'); this.overlay.setAttribute('aria-label', 'Diseño paramétrico CAD');
    const dialog = node('div', undefined, 'cad-dialog'), header = node('header');
    header.append(node('div', 'Diseño paramétrico · ' + cad.tools.length + ' herramientas'), action('Cerrar', () => this.close()));
    this.overlay.appendChild(dialog); dialog.appendChild(header);
    const main = node('div', undefined, 'cad-main'), tools = node('section', undefined, 'cad-tools'), middle = node('section', undefined, 'cad-center'), right = node('section', undefined, 'cad-properties'); main.append(tools, middle, right); dialog.appendChild(main);
    const search = node('input'); search.type = 'search'; search.placeholder = 'Buscar herramienta…'; search.setAttribute('aria-label', 'Buscar herramienta CAD'); tools.appendChild(search);
    const category = node('select'); category.appendChild(new Option('Todas las categorías', '')); cad.categories.forEach(c => category.appendChild(new Option(c.name, c.id))); tools.appendChild(category);
    const presets = node('select'); presets.setAttribute('aria-label', 'Pieza industrial inicial'); presets.appendChild(new Option('Piezas industriales editables…', '')); cad.presets.forEach(item => presets.appendChild(new Option(item.name, item.id))); tools.appendChild(presets);
    presets.onchange = () => { if (!presets.value) return; this.recipe = cad.preset(presets.value); this.sketchState.clear(); this.selectedStep = this.recipe.output; this.renderHistory(); this.renderProperties(); this.rebuild(); };
    this.toolList = node('div', undefined, 'cad-tool-list'); tools.appendChild(this.toolList);
    const renderTools = () => { this.toolList.textContent = ''; const query = search.value.toLocaleLowerCase(); cad.tools.filter(t => (!category.value || t.category === category.value) && (t.name + t.id).toLocaleLowerCase().includes(query)).forEach(t => { const b = action(t.name, () => this.add(t)); b.dataset.cadTool = t.id; b.title = cad.categories.find(c => c.id === t.category).name; this.toolList.appendChild(b); }); };
    search.oninput = category.onchange = renderTools; renderTools();
    this.viewport = node('div', undefined, 'cad-viewport'); middle.appendChild(this.viewport);
    this.status = node('p', 'Preparando vista…', 'cad-status'); middle.appendChild(this.status);
    middle.appendChild(node('p', 'Piezas en metros · bocetos en XY y altura en Z. Al insertar: Y es vertical. Arrastra para orbitar; rueda para acercar.', 'cad-help'));
    middle.appendChild(node('strong', 'Historial · selecciona una operación para editar sus parámetros'));
    this.history = node('div', undefined, 'cad-history'); middle.appendChild(this.history);
    const historyActions = node('div', undefined, 'cad-actions'); historyActions.append(action('Usar como salida', () => { this.recipe.output = this.selectedStep; this.rebuild(); }), action('Eliminar operación y dependientes', () => this.removeStep())); middle.appendChild(historyActions);
    this.faceButton = action('Seleccionar cara para taladrar', () => { this.selectingFace = !this.selectingFace; this.faceButton.textContent = this.selectingFace ? 'Pulsa una cara de la pieza…' : 'Seleccionar cara para taladrar'; if (this.orbit) this.orbit.enabled = !this.selectingFace; }); historyActions.appendChild(this.faceButton);
    this.properties = node('div'); right.appendChild(this.properties);
    const presentation = node('fieldset'); presentation.appendChild(node('legend', 'Presentación y anclaje'));
    const color = node('input'); color.type = 'color'; color.value = this.color; color.oninput = () => { this.color = color.value; if (this.mesh) { this.mesh.material.color.set(this.color).convertSRGBToLinear(); } }; field(presentation, 'Color de la pieza', color);
    const smooth = node('input'); smooth.type = 'number'; smooth.min = '0'; smooth.max = '80'; smooth.step = '1'; smooth.value = this.smoothingAngle; smooth.onchange = () => { const value = Number(smooth.value); if (!Number.isFinite(value) || value < 0 || value > 80) return this.showError(Error('Usa un ángulo de suavizado entre 0 y 80°.')); this.smoothingAngle = value; if (this.mesh) this.mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(cad.vertexNormals(this.result.mesh.positions, value), 3)); }; field(presentation, 'Suavizado visual · ° (0 = plano)', smooth);
    const vehicle = node('select'); vehicle.appendChild(new Option('Pieza independiente', ''));
    this.editor.document.additions.forEach(entry => { if (entry.roomId === this.editor.roomId && entry.descriptor.prefab === 'vehicle') vehicle.appendChild(new Option(entry.object.name, entry.id)); });
    vehicle.value = this.attachment ? this.attachment.targetId : ''; field(presentation, 'Seguir al vehículo', vehicle);
    const anchor = node('select'); [['frame', 'Chasis'], ['cabin', 'Interior de cabina'], ['forks', 'Carro de horquillas']].forEach(([id, name]) => anchor.appendChild(new Option(name, id))); anchor.value = this.attachment ? this.attachment.part : 'frame'; field(presentation, 'Punto de anclaje', anchor);
    const bind = () => { this.attachment = vehicle.value ? {targetId: vehicle.value, part: anchor.value, position: [0, 0, 0]} : null; }; vehicle.onchange = anchor.onchange = bind;
    presentation.appendChild(node('p', 'Las piezas vinculadas siguen el movimiento de su anclaje. Transformación ajusta su posición y rotación relativas.', 'cad-help')); right.appendChild(presentation);
    const footer = node('footer'); this.applyButton = action(this.object ? 'Actualizar pieza' : 'Añadir al escenario', () => this.apply()); this.applyButton.classList.add('primary'); this.buildButton = action('Reconstruir vista', () => this.rebuild()); footer.append(node('span', 'Máximo 48 operaciones / 60.000 triángulos por pieza. El cálculo tiene un límite de 15 s.'), this.buildButton, this.applyButton); dialog.appendChild(footer);
    document.body.appendChild(this.overlay); this.previousFocus = document.activeElement; this.previousFocus && this.previousFocus.blur(); this.escape = event => { if (event.code === 'Escape') { event.stopPropagation(); this.close(); } }; this.overlay.addEventListener('keydown', this.escape); search.focus();
    this.initPreview(); this.renderHistory(); this.renderProperties(); this.rebuild();
  }
  add(tool) {
    try {
      if (this.recipe.steps.length >= cad.MAX_STEPS) throw Error('El historial admite hasta 48 operaciones.');
      const previous = this.selectedStep || this.recipe.output, inputs = tool.input === 'none' ? [] : previous ? [previous] : [];
      const two = tool.category === 'boolean' && ['union', 'subtract', 'intersect', 'hull'].includes(tool.id.split('.')[1]);
      if (two) { const other = this.recipe.steps.filter(s => s.id !== previous).slice(-1)[0]; if (other) inputs.push(other.id); }
      const id = 's' + (1 + Math.max(0, ...this.recipe.steps.map(s => Number(s.id.slice(1)))));
      this.recipe.steps.push({id, op: tool.id, params: {}, inputs}); this.selectedStep = this.recipe.output = id; this.renderHistory(); this.renderProperties(); this.rebuild();
    } catch (error) { this.showError(error); }
  }
  renderHistory() {
    this.history.textContent = '';
    this.recipe.steps.forEach(step => { const tool = cad.tools.find(t => t.id === step.op), b = action(step.id + ' · ' + tool.name + (this.recipe.output === step.id ? ' → salida' : ''), () => { this.selectedStep = step.id; this.renderHistory(); this.renderProperties(); }); b.classList.toggle('selected', this.selectedStep === step.id); this.history.appendChild(b); });
  }
  renderProperties() {
    this.properties.textContent = ''; const index = this.recipe.steps.findIndex(s => s.id === this.selectedStep), step = this.recipe.steps[index]; if (!step) return;
    const tool = cad.tools.find(t => t.id === step.op); this.properties.appendChild(node('h3', tool.name));
    const previous = this.recipe.steps.slice(0, index);
    if (tool.input !== 'none') {
      const two = tool.category === 'boolean' && ['union', 'subtract', 'intersect', 'hull'].includes(tool.id.split('.')[1]) || tool.id === 'extrude.loft';
      for (let n = 0; n < (tool.id === 'extrude.loft' ? Math.min(8, Math.max(2, step.inputs.length + 1)) : two ? 2 : 1); n++) { const select = node('select'); select.appendChild(new Option(n ? 'Ninguno / sección escalada' : 'Selecciona cuerpo anterior', '')); previous.forEach(s => select.appendChild(new Option(s.id + ' · ' + cad.tools.find(t => t.id === s.op).name, s.id))); select.value = step.inputs[n] || ''; select.onchange = () => { step.inputs[n] = select.value; step.inputs = step.inputs.filter(Boolean); if (step.params.sections && step.params.sections.length !== step.inputs.length) delete step.params.sections; this.invalidate(); this.renderProperties(); }; field(this.properties, n ? tool.id === 'extrude.loft' ? 'Perfil de sección ' + (n + 1) : 'Segundo cuerpo / perfil' : 'Cuerpo / perfil de entrada', select); }
    }
    const params = node('div', undefined, 'cad-parameters');
    cad.fields(step.op, {inputCount: step.inputs.length, params: step.params}).forEach(spec => { const input = node('input'); input.type = 'number'; input.min = spec.min; input.max = spec.max; input.step = spec.integer ? '1' : '.001'; input.value = step.params[spec.key] === undefined ? cad.defaults(step.op)[spec.key] : step.params[spec.key]; input.onchange = () => { step.params[spec.key] = Number(input.value); this.invalidate(); }; field(params, spec.label, input); }); this.properties.appendChild(params);
    if (/points|spline|sweep/.test(step.op) || step.op === 'part.hose') this.renderSketch(step);
    if (step.op === 'extrude.loft' && step.inputs.length > 1) this.renderSections(step);
    if (step.params.plane) this.properties.appendChild(node('p', 'Mecanizado perpendicular a la cara seleccionada. Origen [' + step.params.plane.origin.map(v => v.toFixed(3)).join(', ') + '] m; eje [' + step.params.plane.normal.map(v => v.toFixed(2)).join(', ') + ']. X/Y desplazan el corte dentro de esta cara.', 'cad-help'));
    if (step.op === 'part.nameplate') { const text = node('input'); text.maxLength = 32; text.value = step.params.text || 'HELLO'; text.onchange = () => { step.params.text = text.value; this.invalidate(); }; field(this.properties, 'Inscripción en relieve', text); }
    this.properties.appendChild(node('p', 'Modifica los parámetros y pulsa Reconstruir vista. Los radios y espesores deben ser coherentes con el tamaño de la pieza.', 'cad-help'));
  }
  renderSections(step) {
    const defaults = Object.assign(cad.defaults(step.op), step.params), sections = step.params.sections || step.inputs.map((_, index) => { const p = index / (step.inputs.length - 1); return {position: [defaults.x * p, defaults.y * p, defaults.height * p], rotation: [0, 0, 0], scale: [1, 1]}; });
    const box = node('details'); box.open = true; box.appendChild(node('summary', 'Marcos de las secciones · XY / Z'));
    sections.forEach((row, index) => { const group = node('fieldset'); group.appendChild(node('legend', step.inputs[index] + ' · sección ' + (index + 1))); [['position', 'Posición m', ['X', 'Y', 'Z']], ['rotation', 'Rotación °', ['X', 'Y', 'Z']], ['scale', 'Escala del perfil', ['X', 'Y']]].forEach(([key, label, axes]) => { const line = node('div'); line.style.cssText = 'display:flex;gap:5px;min-width:0'; axes.forEach((axis, n) => { const input = node('input'); input.type = 'number'; input.step = '.01'; input.style.width = '100%'; input.value = row[key][n]; input.setAttribute('aria-label', 'Sección ' + (index + 1) + ' ' + label + ' ' + axis); input.onchange = () => { if (!step.params.sections) step.params.sections = copy(sections); step.params.sections[index][key][n] = Number(input.value); this.invalidate(); }; line.appendChild(input); }); field(group, label, line); }); box.appendChild(group); });
    box.appendChild(node('p', 'Cada sección usa su perfil anterior. Orientación, escala y posición definen la transición; evita invertir o cruzar secciones.', 'cad-help')); this.properties.appendChild(box);
  }
  renderSketch(step) {
    const path = ['extrude.sweep', 'part.hose'].includes(step.op), a = Object.assign(cad.defaults(step.op), step.params), initial = step.op === 'part.hose' ? Array.from({length: 7}, (_, i) => [Math.cos(i * Math.PI / 12) * a.radius, Math.sin(i * Math.PI / 12) * a.radius, i * a.height / 6]) : path ? [[0, 0, 0], [a.x, a.y, a.height / 2], [0, 0, a.height]] : step.op === 'profile.spline' ? [[-a.width / 2, 0], [-a.width / 3, -a.depth], [a.width / 3, a.depth], [a.width / 2, 0]] : [[-a.width / 2, -a.depth / 2], [a.width / 2, -a.depth / 2], [a.width / 2, a.depth / 2], [-a.width / 2, a.depth / 2]], state = this.sketchState.get(step.id) || {selected: 0, loop: -1, axes: path ? [0, 2] : [0, 1]}; if (state.loop >= (step.params.loops || []).length) state.loop = -1; this.sketchState.set(step.id, state);
    const rows = () => state.loop < 0 ? step.params.points || initial : step.params.loops[state.loop], ensure = () => { if (!step.params.points) step.params.points = copy(initial); return rows(); }; state.selected = Math.max(0, Math.min(state.selected, rows().length - 1));
    const panel = node('fieldset'); panel.appendChild(node('legend', path ? 'Trayectoria 3D · arrastra los puntos' : 'Boceto · contornos editables'));
    if (path) { const projection = node('select'); [['XY', [0, 1]], ['XZ', [0, 2]], ['YZ', [1, 2]]].forEach(([label, axes]) => projection.appendChild(new Option(label, axes.join(',')))); projection.value = state.axes.join(','); projection.onchange = () => { state.axes = projection.value.split(',').map(Number); fit(); redraw(); }; field(panel, 'Plano de edición', projection); const smooth = node('input'); smooth.type = 'checkbox'; smooth.checked = step.op === 'part.hose' && step.params.smoothPath === undefined || !!step.params.smoothPath; smooth.onchange = () => { step.params.smoothPath = smooth.checked; this.invalidate(); }; field(panel, 'Interpolar curva suave', smooth); }
    if (step.op === 'profile.points') { const loops = node('select'); loops.appendChild(new Option('Contorno exterior', '-1')); (step.params.loops || []).forEach((_, index) => loops.appendChild(new Option('Hueco ' + (index + 1), index))); loops.value = state.loop; loops.onchange = () => { state.loop = Number(loops.value); state.selected = 0; this.renderProperties(); }; field(panel, 'Contorno activo', loops); }
    const canvas = node('canvas'); canvas.width = 480; canvas.height = 300; canvas.style.cssText = 'width:100%;height:170px;display:block;background:#0d1c27;touch-action:none;border:1px solid #496071'; canvas.setAttribute('aria-label', 'Editor gráfico de vértices CAD'); panel.appendChild(canvas);
    let bounds; const axes = () => state.axes, fit = () => { const values = rows(), [x, y] = axes(), xs = values.map(p => p[x]), ys = values.map(p => p[y]), span = Math.max(.1, Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * canvas.width / canvas.height) * 1.4; bounds = {x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, span}; };
    const project = p => [canvas.width / 2 + (p[axes()[0]] - bounds.x) / bounds.span * canvas.width, canvas.height / 2 - (p[axes()[1]] - bounds.y) / bounds.span * canvas.width];
    const redraw = () => { if (!bounds) fit(); const c = canvas.getContext('2d'); if (!c) return; c.clearRect(0, 0, canvas.width, canvas.height); c.strokeStyle = '#203b49'; for (let x = 0; x <= canvas.width; x += 30) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, canvas.height); c.stroke(); } c.strokeStyle = '#89e3d1'; c.beginPath(); rows().forEach((p, i) => { const [x, y] = project(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); if (!path && step.op !== 'profile.spline') c.closePath(); c.stroke(); rows().forEach((p, i) => { const [x, y] = project(p); c.fillStyle = i === state.selected ? '#ffdb80' : '#89e3d1'; c.beginPath(); c.arc(x, y, i === state.selected ? 7 : 5, 0, Math.PI * 2); c.fill(); c.font = '16px sans-serif'; c.fillText(String(i + 1), x + 9, y - 7); }); };
    const coords = node('div'); coords.style.cssText = 'display:flex;gap:4px'; const updateCoords = () => { coords.textContent = ''; ['X', 'Y', ...(path ? ['Z'] : [])].forEach((axis, n) => { const input = node('input'); input.type = 'number'; input.min = '-20'; input.max = '20'; input.step = '.001'; input.style.width = '100%'; input.value = rows()[state.selected][n]; input.setAttribute('aria-label', 'Vértice ' + (state.selected + 1) + ' ' + axis); input.onchange = () => { ensure()[state.selected][n] = Number(input.value); this.invalidate(); fit(); redraw(); }; field(coords, axis, input); }); }; panel.appendChild(coords);
    const point = event => { const r = canvas.getBoundingClientRect(); return [(event.clientX - r.left) / r.width * canvas.width, (event.clientY - r.top) / r.height * canvas.height]; };
    canvas.onpointerdown = event => { const [x, y] = point(event); let distance = 18, index = -1; rows().forEach((p, i) => { const q = project(p), d = Math.hypot(q[0] - x, q[1] - y); if (d < distance) { distance = d; index = i; } }); if (index < 0) return; state.selected = index; state.drag = event.pointerId; canvas.setPointerCapture(event.pointerId); updateCoords(); redraw(); };
    canvas.onpointermove = event => { if (state.drag !== event.pointerId) return; const [x, y] = point(event), row = ensure()[state.selected]; row[axes()[0]] = Math.round(Math.max(-20, Math.min(20, bounds.x + (x - canvas.width / 2) / canvas.width * bounds.span)) * 1000) / 1000; row[axes()[1]] = Math.round(Math.max(-20, Math.min(20, bounds.y - (y - canvas.height / 2) / canvas.width * bounds.span)) * 1000) / 1000; updateCoords(); redraw(); this.invalidate(); };
    canvas.onpointerup = canvas.onpointercancel = () => { delete state.drag; };
    const buttons = node('div', undefined, 'cad-actions'); buttons.style.flexWrap = 'wrap'; buttons.append(action('Añadir vértice', () => { const points = ensure(); if (points.length >= 64) return this.showError(Error('Máximo 64 puntos.')); const a = points[state.selected], b = points[(state.selected + 1) % points.length], next = a.map((v, i) => path && state.selected === points.length - 1 ? v + (i === 2 ? .1 : 0) : (v + b[i]) / 2); points.splice(state.selected + 1, 0, next); state.selected++; this.invalidate(); this.renderProperties(); }), action('Eliminar vértice', () => { const points = ensure(); if (points.length <= (path ? 2 : 3)) return; points.splice(state.selected, 1); state.selected = Math.min(state.selected, points.length - 1); this.invalidate(); this.renderProperties(); }), action('Ajustar boceto', () => { fit(); redraw(); })); panel.appendChild(buttons);
    if (step.op === 'profile.points') { const holes = node('div', undefined, 'cad-actions'); holes.style.flexWrap = 'wrap'; holes.append(action('Añadir hueco', () => { ensure(); const list = step.params.loops || (step.params.loops = []); if (list.length >= 4) return this.showError(Error('Máximo cuatro huecos.')); const r = bounds.span * .08, x = bounds.x, y = bounds.y; list.push([[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]]); state.loop = list.length - 1; state.selected = 0; this.invalidate(); this.renderProperties(); }), action('Eliminar hueco', () => { if (state.loop < 0) return; step.params.loops.splice(state.loop, 1); state.loop = -1; state.selected = 0; this.invalidate(); this.renderProperties(); })); panel.appendChild(holes); }
    const json = node('details'), points = node('textarea'); json.appendChild(node('summary', 'Coordenadas JSON (avanzado)')); points.rows = 4; points.value = JSON.stringify(rows()); points.onchange = () => { try { const values = JSON.parse(points.value); if (state.loop < 0) step.params.points = values; else step.params.loops[state.loop] = values; cad.normalizeRecipe(this.recipe); state.selected = 0; this.invalidate(); this.renderProperties(); } catch (error) { this.showError(error); } }; field(json, path ? 'Trayectoria [[x,y,z],…]' : 'Vértices [[x,y],…]', points); panel.appendChild(json); this.properties.appendChild(panel); fit(); updateCoords(); redraw();
  }
  removeStep() {
    const removed = new Set([this.selectedStep]); this.recipe.steps.forEach(step => { if (step.inputs.some(id => removed.has(id))) removed.add(step.id); });
    this.recipe.steps = this.recipe.steps.filter(step => !removed.has(step.id)); this.recipe.output = this.selectedStep = this.recipe.steps.length ? this.recipe.steps[this.recipe.steps.length - 1].id : ''; this.renderHistory(); this.renderProperties(); this.rebuild();
  }
  invalidate() { this.dirty = true; this.applyButton.disabled = true; this.status.textContent = 'Hay cambios pendientes de reconstruir.'; }
  rebuild() {
    if (!this.overlay) return;
    this.stopWorker(); this.invalidate(); const id = ++this.generation;
    try {
      const recipe = cad.normalizeRecipe(this.recipe); if (!recipe.steps.length) throw Error('Añade una operación para empezar.');
      this.worker = new Worker(new URL("cad-worker.js", document.baseURI).href); this.status.textContent = 'Construyendo geometría…';
      this.timer = setTimeout(() => { this.stopWorker(); this.showError(Error('Tiempo de cálculo agotado. Reduce segmentos, repeticiones o cortes.')); }, 15000);
      this.worker.onerror = () => { this.stopWorker(); this.showError(Error('No se pudo cargar el modelador. Comprueba que cad-worker.js está publicado.')); };
      this.worker.onmessage = event => { if (!this.overlay || event.data.id !== this.generation) return; this.stopWorker(); if (event.data.error) return this.showError(Error(event.data.error)); this.result = event.data.result; this.recipe = this.result.recipe; this.dirty = false; this.applyButton.disabled = this.result.isProfile; this.showPreview(this.result); const s = this.result.stats, measurement = s.measurement; const metric = measurement ? ' · ' + ({center: 'Centro de masa [X,Y,Z] · m', bounds: 'Límites [mín., máx.] · m', dimensions: 'Dimensiones · m', polygons: 'Polígonos', area: 'Área · m²', volume: 'Volumen · m³'}[measurement.kind] || measurement.kind) + ': ' + JSON.stringify(measurement.value) : ''; this.status.textContent = `${s.triangles.toLocaleString()} triángulos · ${s.dimensions.map(n => n.toFixed(3)).join(' × ')} m · volumen ${s.volume.toFixed(5)} m³ · superficie ${s.area.toFixed(4)} m²${this.result.isProfile ? ' · Perfil 2D: extrúyelo para insertar.' : ''}${metric}`; this.renderHistory(); this.renderProperties(); };
      this.worker.postMessage({id, recipe});
    } catch (error) { this.showError(error); }
  }
  stopWorker() { clearTimeout(this.timer); if (this.worker) this.worker.terminate(); this.worker = null; }
  showError(error) { if (this.status) this.status.textContent = error.message; if (this.applyButton) this.applyButton.disabled = true; }
  initPreview() {
    try {
      this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: false}); this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); this.renderer.setClearColor('#17212d'); this.renderer.outputEncoding = THREE.sRGBEncoding; this.viewport.appendChild(this.renderer.domElement);
      this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(40, 1, .001, 1000); this.camera.position.set(.8, .6, .9);
      this.scene.add(new THREE.HemisphereLight(0xe2efff, 0x333841, .95)); const light = new THREE.DirectionalLight(0xffffff, .85); light.position.set(2, 4, 3); this.scene.add(light); this.grid = new THREE.GridHelper(2, 20, 0x48747d, 0x334654); this.scene.add(this.grid);
      this.orbit = new OrbitControls(this.camera, this.renderer.domElement); this.orbit.enableDamping = true; this.orbit.rotateSpeed = .5;
      this.renderer.domElement.addEventListener('pointerdown', event => this.selectFace(event));
      const animate = () => { if (!this.overlay) return; this.frame = requestAnimationFrame(animate); const w = Math.max(1, this.viewport.clientWidth), h = Math.max(1, this.viewport.clientHeight); if (this.width !== w || this.height !== h) { this.width = w; this.height = h; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); } this.orbit.update(); this.renderer.render(this.scene, this.camera); }; animate();
    } catch (error) { this.showError(error); }
  }
  selectFace(event) {
    if (!this.selectingFace || !this.mesh || !this.result || this.result.isProfile || this.dirty) return;
    const bounds = this.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), this.camera); const hit = ray.intersectObject(this.mesh, false)[0]; if (!hit || !hit.face) return;
    const convert = p => new THREE.Vector3(p.x, -p.z, p.y), normal = convert(hit.face.normal).normalize(), origin = convert(hit.point), reference = Math.abs(normal.x) < .85 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), xAxis = reference.addScaledVector(normal, -reference.dot(normal)).normalize();
    this.selectingFace = false; this.faceButton.textContent = 'Seleccionar cara para taladrar'; this.orbit.enabled = true;
    try { if (this.recipe.steps.length >= cad.MAX_STEPS) throw Error('El historial admite hasta 48 operaciones.'); const id = 's' + (1 + Math.max(0, ...this.recipe.steps.map(s => Number(s.id.slice(1))))), radius = Math.max(.001, Math.min(...this.result.stats.dimensions) * .12); this.recipe.steps.push({id, op: 'boolean.drill', params: {radius, x: 0, y: 0, plane: {origin: origin.toArray(), normal: normal.toArray(), xAxis: xAxis.toArray()}}, inputs: [this.recipe.output]}); this.selectedStep = this.recipe.output = id; this.renderHistory(); this.renderProperties(); this.rebuild(); } catch (error) { this.showError(error); }
  }
  showPreview(result) {
    if (!this.renderer) return;
    this.disposeMesh(); const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(result.mesh.positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(cad.vertexNormals(result.mesh.positions, this.smoothingAngle), 3)); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: new THREE.Color(this.color).convertSRGBToLinear(), metalness: .35, roughness: .45})); this.scene.add(this.mesh);
    const center = geometry.boundingBox.getCenter(new THREE.Vector3()), radius = Math.max(.02, geometry.boundingSphere.radius); this.orbit.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(1, .8, 1.2).normalize().multiplyScalar(radius * 3.8)); this.camera.near = Math.max(.0001, radius / 1000); this.camera.far = Math.max(100, radius * 100); this.camera.updateProjectionMatrix(); this.grid.position.y = geometry.boundingBox.min.y - .001; this.orbit.update();
  }
  async apply() {
    if (!this.result || this.dirty || this.result.isProfile) return;
    try {
      const descriptor = cad.normalizeDescriptor(Object.assign({type: 'cad', recipe: this.recipe, mesh: this.result.mesh, color: this.color, smoothingAngle: this.smoothingAngle}, this.attachment ? {attachment: this.attachment} : {}));
      const object = this.object ? this.editor.document.updateCAD(this.object, descriptor) : descriptor.attachment ? this.editor.document.addCAD(this.editor.roomId, descriptor) : await this.editor.createPlacedObject(() => this.editor.document.addCAD(this.editor.roomId, descriptor));
      this.editor.select(object); this.editor.toast('Pieza paramétrica guardada con su historial.'); this.close();
    } catch (error) { this.showError(error); }
  }
  disposeMesh() { if (!this.mesh) return; this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
  close() { this.generation++; this.stopWorker(); cancelAnimationFrame(this.frame); this.disposeMesh(); if (this.orbit) this.orbit.dispose(); if (this.grid) { this.grid.geometry.dispose(); this.grid.material.dispose(); } if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); } if (this.overlay) this.overlay.remove(); this.overlay = this.renderer = this.orbit = this.grid = null; if (this.previousFocus && this.previousFocus.isConnected) this.previousFocus.focus(); }
}
