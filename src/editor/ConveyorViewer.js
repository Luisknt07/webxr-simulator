import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import schema from '../../shared/behaviors.js';
import SceneDocument from './SceneDocument.js';
import SimulationRuntime from './SimulationRuntime.js';
import IndustrialVisuals from './IndustrialVisuals.js';
import {createSourceProductVisual} from './IndustrialPrefabs.js';
import CollisionWorld from '../lib/CollisionWorld.js';
import ConveyorAssembly from './ConveyorAssembly.js';
import {conveyorExamples, buildConveyorExample} from './ConveyorExamples.js';

const registry = schema.conveyorLayout.equipment;
const TABS = ['Partes', 'Funcionamiento', 'Controles', 'Conexiones', 'Aplicaciones'];
const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function el(tag, text, parent, className) { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; if (parent) parent.appendChild(value); return value; }
function button(parent, text, action, className) { const value = el('button', text, parent, className); value.type = 'button'; value.addEventListener('click', action); return value; }
function select(parent, label, options, current, action) {
  const row = el('label', label, parent), value = el('select', undefined, row);
  value.setAttribute('aria-label', label);
  options.forEach(option => { const node = el('option', option.name || option.label || option.id, value); node.value = option.id; });
  value.value = current; value.addEventListener('change', () => action(value.value)); return value;
}
function disposeTree(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(node => { if (node.geometry) geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => materials.add(material)); });
  materials.forEach(material => Object.values(material).forEach(value => { if (value && value.isTexture) textures.add(value); }));
  textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
}
function shown(node) { for (let current = node; current; current = current.parent) if (current.visible === false) return false; return true; }
function boundsOf(nodes) {
  const result = new THREE.Box3().makeEmpty();
  nodes.forEach(node => { node.updateWorldMatrix(true, true); result.union(new THREE.Box3().setFromObject(node)); });
  return result;
}

/** On-demand, isolated teaching world. It reuses the production factory,
 * document, transport runtime and panel visuals, and owns/disposes its GPU data.
 */
export default class ConveyorViewer {
  constructor(editor) {
    this.editor = editor; this.tab = 'Partes'; this.definition = null; this.frameElapsed = 0; this.opened = false;
    this.wallPulses = new Map();
    this.keydown = event => {
      if (!this.opened) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
      if (event.key === 'Tab') this.trapFocus(event);
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName || '')) event.stopPropagation();
    };
    document.addEventListener('keydown', this.keydown, true);
    this.pagehide = () => this.close(); window.addEventListener('pagehide', this.pagehide);
  }

  open(resource) {
    if (!this.editor.active || this.editor.ctx.vrMode) return false;
    const authored = resource && resource.objectId && this.editor.document.getObject(resource.objectId);
    const config = resource && resource.type === 'conveyor' ? resource : authored && this.editor.document.getBehaviors(authored).find(value => value.type === 'conveyor');
    const definition = registry.getDefinition(resource && (resource.equipmentId || resource.variant || resource.action && resource.action.variant)) ||
      registry.resolveVariant(config || resource) || registry.getDefinition('roller-motor');
    this.close(); this.previousFocus = document.activeElement;
    this.opened = true; this.definition = definition;
    this.overrides = config ? Object.assign({}, config, {outputId: '', branchId: ''}) : {};
    this.exampleId = resource && resource.example || 'single'; this.scope = this.exampleId === 'single' ? 'module' : 'segment'; this.playing = false; this.tab = 'Partes';
    this.build();
    try { this.createRenderer(); this.load(); }
    catch (error) { this.status(error.message); this.destroyWorld(); }
    this.closeButton.focus(); return true;
  }

  build() {
    this.overlay = el('section', undefined, document.body, 'conveyor-viewer'); this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true'); this.overlay.setAttribute('aria-labelledby', 'conveyor-viewer-title');
    const top = el('header', undefined, this.overlay, 'conveyor-viewer-header');
    const heading = el('div', undefined, top); el('small', 'BIBLIOTECA / EQUIPOS INDUSTRIALES / TRANSPORTADORES', heading);
    this.title = el('h2', 'Explorar transportadores', heading); this.title.id = 'conveyor-viewer-title';
    this.closeButton = button(top, 'Cerrar ×', () => this.close());
    const body = el('div', undefined, this.overlay, 'conveyor-viewer-body');
    this.families = el('nav', undefined, body, 'conveyor-viewer-families'); this.families.setAttribute('aria-label', 'Familias de transportadores');
    registry.FAMILIES.forEach(family => {
      const value = button(this.families, family.name, () => {
        const next = registry.listEquipment({family: family.id})[0]; if (!next) return;
        this.definition = next; this.overrides = {}; this.exampleId = 'single'; this.load();
      }); value.dataset.family = family.id;
      value.disabled = registry.listEquipment({family: family.id}).length === 0;
    });
    el('p', 'Metros · Y arriba', this.families, 'cv-muted');
    const center = el('div', undefined, body, 'conveyor-viewer-center');
    this.variantRow = el('div', undefined, center, 'conveyor-viewer-variant');
    this.viewport = el('div', undefined, center, 'conveyor-viewer-viewport');
    this.viewport.setAttribute('aria-label', 'Modelo 3D interactivo del equipo');
    this.partCaption = el('div', 'Arrastra para girar · Rueda para acercar · Clic en una pieza', this.viewport, 'conveyor-viewer-caption');
    const transport = el('div', undefined, center, 'conveyor-viewer-transport');
    this.runButton = button(transport, '▶ Ejecutar', () => { this.playing = !this.playing; this.updateRunButton(); });
    button(transport, 'Paso 0,1 s', () => { this.playing = false; this.updateRunButton(); this.advance(0.1); });
    button(transport, 'Reiniciar', () => this.load());
    button(transport, 'Encuadrar', () => this.frame(this.machines || []));
    const pathLabel = el('label', undefined, transport); this.pathToggle = el('input', undefined, pathLabel); this.pathToggle.type = 'checkbox';
    pathLabel.appendChild(document.createTextNode(' Recorridos y puertos')); this.pathToggle.addEventListener('change', () => { if (this.paths) this.paths.visible = this.pathToggle.checked; });
    this.message = el('p', 'La exploración no modifica el escenario abierto.', center, 'conveyor-viewer-message'); this.message.setAttribute('role', 'status');
    this.stats = el('div', undefined, center, 'conveyor-viewer-stats');
    const right = el('aside', undefined, body, 'conveyor-viewer-context');
    this.tabs = el('div', undefined, right, 'conveyor-viewer-tabs'); this.tabs.setAttribute('role', 'tablist');
    TABS.forEach((tab, index) => {
      const value = button(this.tabs, tab, () => { this.tab = tab; this.renderTab(); }); value.setAttribute('role', 'tab'); value.dataset.tab = tab; value.id = 'conveyor-viewer-tab-' + index;
      value.setAttribute('aria-controls', 'conveyor-viewer-content');
      value.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        this.tab = TABS[next]; this.renderTab(); this.tabs.children[next].focus();
      });
    });
    this.content = el('div', undefined, right, 'conveyor-viewer-content'); this.content.setAttribute('role', 'tabpanel');
    this.content.id = 'conveyor-viewer-content';
    const footer = el('footer', undefined, this.overlay, 'conveyor-viewer-footer');
    el('span', 'Modelo y secuencias del simulador · valores didácticos configurables', footer);
    this.insertButton = button(footer, 'Añadir al escenario', () => this.insertIntoScene(), 'cv-primary');
  }

  createRenderer() {
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, preserveDrawingBuffer: true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputEncoding = THREE.sRGBEncoding; this.renderer.setClearColor(0x171f29, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95;
    this.renderer.domElement.tabIndex = 0; this.renderer.domElement.setAttribute('aria-label', 'Girar y seleccionar piezas del transportador');
    this.viewport.insertBefore(this.renderer.domElement, this.partCaption);
    this.camera = new THREE.PerspectiveCamera(38, Math.max(1, this.viewport.clientWidth) / Math.max(1, this.viewport.clientHeight), 0.02, 250); this.camera.position.set(4, 3, 5);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement); this.orbit.enableKeys = false;
    this.orbit.enableDamping = false; this.orbit.minDistance = 0.25; this.orbit.maxDistance = 70;
    this.pointerDown = null;
    this.renderer.domElement.addEventListener('pointerdown', event => { this.pointerDown = {x: event.clientX, y: event.clientY}; });
    this.renderer.domElement.addEventListener('pointerup', event => {
      if (!this.pointerDown || Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 5 || event.button !== 0) return;
      this.pick(event); this.pointerDown = null;
    });
  }

  load() {
    this.destroyWorld(); this.playing = false; this.frameElapsed = 0; this.updateRunButton();
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x202b38);
    this.scene.add(new THREE.HemisphereLight(0xe6f6ff, 0x536276, 0.8));
    [[0xffffff, 0.9, 3, 7, 5], [0x93cfff, 0.35, -5, 4, -4], [0xffffff, 0.4, 4, 2, -6]].forEach(spec => {
      const light = new THREE.DirectionalLight(spec[0], spec[1]); light.position.set(spec[2], spec[3], spec[4]); this.scene.add(light);
    });
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.document = new SceneDocument({}); this.document.registerRoom('hall', this.root);
    this.context = {scene: this.scene, camera: this.camera, renderer: this.renderer, editor: {active: false}, vrMode: false};
    this.context.collisionWorld = new CollisionWorld(this.context, this.document);
    if (this.exampleId === 'single') {
      const object = this.document.addPrefab('hall', 'conveyor', this.definition.variant);
      const config = Object.assign({}, this.document.getBehaviors(object).find(value => value.type === 'conveyor'), this.overrides);
      this.document.setBehaviors(object, this.document.getBehaviors(object).map(value => value.type === 'conveyor' ? config : value));
      this.document.setTransform(object, {position: [0, 1.02, 0]}); this.machines = [object]; this.selectedMachine = object;
    } else {
      const example = buildConveyorExample(this.document, 'hall', this.exampleId, {scene: this.scene});
      this.machines = example.objects; this.selectedMachine = example.first;
    }
    this.context.collisionWorld.setRoom('hall');
    this.simulation = new SimulationRuntime(this.context, this.document, message => this.status(message));
    this.visuals = new IndustrialVisuals(this.context, this.document, this.simulation);
    this.simulation.start('hall'); this.visuals.sync('hall', 0.21, false);
    this.config = this.document.getBehaviors(this.selectedMachine).find(value => value.type === 'conveyor');
    if (this.exampleId !== 'single') this.definition = registry.resolveVariant(this.config);
    const bounds = boundsOf(this.machines), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const floor = new THREE.Mesh(new THREE.PlaneBufferGeometry(Math.max(12, size.x + 8), Math.max(12, size.z + 8)), new THREE.MeshStandardMaterial({color: '#526174', roughness: 0.95, metalness: 0.05}));
    floor.rotation.x = -Math.PI / 2; floor.position.set(center.x, Math.min(0, bounds.min.y) - 0.006, center.z); this.scene.add(floor);
    this.grid = new THREE.GridHelper(Math.max(12, Math.ceil(Math.max(size.x, size.z) + 6)), 20, 0x71879c, 0x596d82); this.grid.position.copy(floor.position).add(new THREE.Vector3(0, .002, 0)); this.scene.add(this.grid);
    this.createPaths(); this.frame(this.machines); this.renderVariant(); this.renderTab(); this.updateStats(); this.render();
    this.status('Exploración independiente · ' + this.definition.name + '. Pulsa Marcha y luego Ejecutar para observar el transporte.');
    this.makePartThumbnails();
  }

  renderVariant() {
    this.title.textContent = this.exampleId === 'single' ? this.definition.name : conveyorExamples.find(value => value.id === this.exampleId).name;
    Array.from(this.families.querySelectorAll('button')).forEach(value => value.setAttribute('aria-current', value.dataset.family === this.definition.family ? 'true' : 'false'));
    this.variantRow.textContent = '';
    select(this.variantRow, 'Variante', registry.listEquipment({family: this.definition.family}), this.definition.id, id => {
      this.definition = registry.getDefinition(id); this.exampleId = 'single'; this.overrides = {}; this.load();
    });
    if (this.machines.length > 1) select(this.variantRow, 'Equipo activo', this.machines.map(object => ({id: object.userData.editorId, name: object.name})), this.selectedMachine.userData.editorId, id => {
      this.clearHighlight(); this.selectedMachine = this.document.getObject(id); this.config = this.document.getBehaviors(this.selectedMachine).find(value => value.type === 'conveyor');
      this.definition = registry.resolveVariant(this.config); this.partImages = null; this.renderVariant(); this.renderTab(); this.updateStats(); this.makePartThumbnails();
    });
  }

  renderTab() {
    if (!this.content || !this.definition) return;
    Array.from(this.tabs.children).forEach(value => { const selected = value.dataset.tab === this.tab; value.setAttribute('aria-selected', String(selected)); value.tabIndex = selected ? 0 : -1; if (selected) this.content.setAttribute('aria-labelledby', value.id); });
    this.content.textContent = '';
    if (this.tab === 'Partes') this.renderParts();
    if (this.tab === 'Funcionamiento') this.renderOperation();
    if (this.tab === 'Controles') this.renderControls();
    if (this.tab === 'Conexiones') this.renderConnections();
    if (this.tab === 'Aplicaciones') this.renderApplications();
  }

  partNodes(part) {
    const matches = (part.match || []).map(fold), nodes = [];
    if (!this.selectedMachine) return nodes;
    this.selectedMachine.traverse(node => {
      if (!shown(node) || node.userData.editorRuntimeHelper || !matches.some(match => fold(node.name).includes(match))) return;
      if (nodes.some(parent => { for (let current = node.parent; current; current = current.parent) if (current === parent) return true; return false; })) return;
      nodes.push(node);
    });
    return nodes;
  }

  renderParts() {
    el('p', 'Selecciona una pieza en el modelo o en su ficha para ver su función.', this.content, 'cv-muted');
    this.partButtons = new Map();
    this.definition.parts.forEach(part => {
      const nodes = this.partNodes(part); if (!nodes.length) return;
      const value = button(this.content, '', () => this.selectPart(part), 'conveyor-viewer-part');
      const image = el('img', undefined, value); image.alt = part.name; image.hidden = true;
      const text = el('span', undefined, value); el('strong', part.name, text); el('small', part.function, text);
      value.dataset.part = part.id; value.setAttribute('aria-pressed', String(this.selectedPart && this.selectedPart.id === part.id));
      this.partButtons.set(part.id, {button: value, image, part});
    });
    if (this.partImages) this.partButtons.forEach((entry, id) => { if (this.partImages[id]) { entry.image.src = this.partImages[id]; entry.image.hidden = false; } });
  }

  renderOperation() {
    el('h3', this.definition.name, this.content); el('p', this.definition.description, this.content);
    el('p', this.definition.simulationLevel, this.content, 'cv-muted');
    const phase = el('p', '', this.content, 'conveyor-viewer-phase'); phase.dataset.live = 'phase';
    const sequence = {
      liftTransfer: 'Recibir → posicionar → comprobar receptor → elevar → transferir → confirmar salida → bajar → listo.',
      turntable: 'Recibir → centrar → comprobar destino → girar mesa y carga → confirmar posición → entregar → regresar.',
      pusher: 'Recibir → posicionar → esperar rama libre → extender empujador → confirmar salida → retraer.',
      elevator: 'Recibir → posicionar → confirmar condiciones → mover plataforma → confirmar nivel → entregar → confirmar salida → regresar.',
      zones: 'Detectar ocupación → comprobar zona siguiente → retener o liberar → confirmar avance.',
      loading: this.config.requiresOperator ? 'Esperar operario → solicitar despacho → completar tiempo de atención → comprobar salida → entregar.' : 'Admitir la carga y entregar únicamente cuando la interfaz receptora está disponible.'
    };
    el('p', sequence[this.config.mechanism] || 'Detectar entrada → transportar por el recorrido → esperar salida libre → entregar → confirmar salida.', this.content);
    if (this.config.drive === 'gravity') el('p', 'Sin motor. Se aproxima la aceleración por pendiente y resistencia. Un tramo horizontal necesita un impulso inicial; la consigna del panel no lo mueve.', this.content);
    const parameters = el('details', undefined, this.content); el('summary', 'Configurar esta exploración', parameters);
    el('p', 'Cambiar un parámetro reinicia esta demostración. El escenario abierto conserva sus valores.', parameters, 'cv-muted');
    if (this.exampleId === 'single') this.definition.parameters.forEach(parameter => this.parameterField(parameters, parameter));
    else el('p', 'Para configurar una variante individual, selecciónala en el selector superior.', parameters);
    el('h4', 'Origen de los datos', this.content); el('p', this.definition.provenance.parameters, this.content, 'cv-muted');
    this.definition.references.forEach(reference => { const link = el('a', reference.title, this.content, 'cv-reference'); link.href = reference.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = reference.note; });
  }

  parameterField(parent, parameter) {
    const row = el('label', parameter.label + (parameter.unit ? ' (' + parameter.unit + ')' : ''), parent, 'cv-parameter');
    let field;
    if (parameter.options) {
      field = el('select', undefined, row); parameter.options.forEach(value => { const option = el('option', value === 'curveLeft' ? 'Izquierda' : value === 'curveRight' ? 'Derecha' : value, field); option.value = value; }); field.value = this.config[parameter.key];
    } else {
      field = el('input', undefined, row); field.type = parameter.input === 'boolean' ? 'checkbox' : 'number';
      if (field.type === 'checkbox') field.checked = Boolean(this.config[parameter.key]);
      else { field.value = this.config[parameter.key]; field.step = '0.01'; if (parameter.min !== undefined) field.min = parameter.min; if (parameter.max !== undefined) field.max = parameter.max; }
    }
    field.addEventListener('change', () => {
      const value = field.type === 'checkbox' ? field.checked : field.tagName === 'SELECT' ? field.value : Number(field.value);
      try {
        const next = Object.assign({}, this.config, {[parameter.key]: value}); schema.normalizeBehaviors([next]);
        this.overrides = next; this.load();
      } catch (error) { this.status(error.message); if (field.type === 'checkbox') field.checked = Boolean(this.config[parameter.key]); else field.value = this.config[parameter.key]; }
    });
  }

  renderControls() {
    el('p', 'Los mandos operan el equipo seleccionado. El panel 3D conserva sus nueve controles originales.', this.content, 'cv-muted');
    this.scope = this.scope || 'module';
    select(this.content, 'Alcance del mando', [{id: 'module', name: 'Módulo'}, {id: 'segment', name: 'Tramo hasta otro panel'}, {id: 'line', name: 'Línea conectada'}], this.scope, value => { this.scope = value; this.renderScope(); this.updateSignals(); });
    this.scopeSummary = el('p', '', this.content, 'cv-muted'); this.renderScope();
    const grid = el('div', undefined, this.content, 'conveyor-viewer-controls');
    if (this.config.drive === 'motor') registry.PANEL_ACTIONS.forEach(action => {
      const value = button(grid, action.name, () => this.command(action.id)); value.title = action.description; value.dataset.action = action.id;
    });
    else el('p', this.config.drive === 'gravity' ? 'Esta variante no tiene accionamiento eléctrico.' : 'Mesa física sin accionamiento oculto.', this.content);
    if (this.config.mechanism === 'loading') {
      button(this.content, 'Cambiar disponibilidad de operario', () => this.command('operator'));
      button(this.content, 'Solicitar despacho', () => this.command('dispatch'));
    }
    el('h4', 'Carga de prueba', this.content);
    this.profileId = this.profileId || 'box-small';
    select(this.content, 'Producto', registry.PRODUCT_PROFILES, this.profileId, value => { this.profileId = value; this.renderCompatibility(); });
    select(this.content, 'Calidad declarada', [{id: 'good', name: 'Conforme'}, {id: 'defective', name: 'Defectuoso'}], this.quality || 'good', value => { this.quality = value; });
    button(this.content, 'Colocar carga en la entrada', () => this.addProfile());
    this.compatibility = el('p', '', this.content, 'cv-muted'); this.renderCompatibility();
    el('p', 'Insertar caja conserva la ayuda de simulación del panel. La carga de prueba permite comprobar otros tamaños, masa y base. La calidad indicada es un atributo conocido.', this.content, 'cv-muted');
    this.liveControls = el('dl', undefined, this.content, 'conveyor-viewer-signals'); this.updateSignals();
  }

  renderCompatibility() {
    if (!this.compatibility) return;
    const profile = registry.PRODUCT_PROFILES.find(value => value.id === this.profileId) || registry.PRODUCT_PROFILES[0];
    const result = schema.conveyorLayout.productCompatibility(this.config, Object.assign({}, profile, {loadMode: profile.loadType === 'pallet' ? 'pallet' : 'individual'}));
    this.compatibility.textContent = result.ok ? 'Compatible con la envolvente didáctica configurada.' : result.reasons.map(reason => reason.message).join(' ');
  }

  renderScope() {
    if (!this.scopeSummary || !this.simulation || !this.selectedMachine) return;
    const panel = this.simulation.getPanelSnapshot(this.selectedMachine.userData.editorId, this.scope || 'module');
    this.scopeSummary.textContent = 'Controla: ' + (panel && panel.memberIds || []).map(id => { const object = this.document.getObject(id); return object && object.name || id; }).join(' · ');
  }

  renderConnections() {
    el('p', 'Amarillo: puerto disponible. Una conexión necesita coincidencia geométrica y compatibilidad funcional. Durante la marcha también espera al receptor.', this.content);
    const ports = schema.conveyorLayout.ports(this.config);
    Object.keys(ports).forEach(name => {
      const port = ports[name], box = el('div', undefined, this.content, 'cv-connection');
      el('strong', (port.incoming ? 'Entrada' : 'Salida') + ' · ' + name, box);
      el('p', 'Ancho ' + port.width.toFixed(2) + ' m · cota local ' + Number(port.y || 0).toFixed(2) + ' m · ' + port.surface + ' · ' + (port.loadClass === 'pallet' ? 'pallets' : 'unidades'), box);
    });
    const assembly = new ConveyorAssembly({document: this.document, roomId: 'hall', root: this.root, ctx: this.context, hooks: {renderScene: this.scene}});
    const links = assembly.edges(this.machines).filter(link => link.source === this.selectedMachine || link.target === this.selectedMachine);
    links.forEach(link => {
      const result = link.target && assembly.assessConnection(link.source, link.sourcePort, link.target, link.targetPort);
      el('p', link.source.name + ' → ' + (link.target ? link.target.name : link.targetId) + ': ' + (result && result.ready ? 'Geometría e interfaz compatibles; transferencia coordinada en ejecución.' : result ? result.reasons.map(value => value.message).join(' ') : 'Receptor ausente.'), this.content);
    });
    if (!links.length) el('p', 'Equipo sin conexiones. En el editor arrástralo hacia puertos compatibles para ensamblar.', this.content, 'cv-muted');
    el('h4', 'Elegir el mecanismo', this.content);
    ['L: curva continua de 90°.', 'T: transferencia o desvío concreto más una rama receptora.', 'Y: unión coordinada; las entradas comparten una zona reservada.', 'Rectángulo: cuatro cambios de dirección y control de ocupación.', 'Cambio de cota: inclinación compatible o elevador; la proximidad no crea una transición.', 'Pallets: patines, masa e interfaces específicas.'].forEach(text => el('p', text, this.content, 'cv-muted'));
  }

  renderApplications() {
    el('p', 'Estos ejemplos se construyen con equipos y conexiones reales del mismo simulador.', this.content);
    conveyorExamples.filter(example => example.id !== 'single').forEach(example => {
      const value = button(this.content, '', () => { this.exampleId = example.id; this.overrides = {}; this.load(); }, 'conveyor-viewer-example');
      el('strong', example.name, value); el('small', example.description, value);
    });
    el('p', 'La estación robotizada necesita un robot con alcance, herramienta, puntos de recogida/entrega y señales coordinadas. No se ofrece una tarjeta funcional de robot mientras ese mecanismo no exista.', this.content, 'cv-muted');
  }

  command(action) {
    if (!this.simulation || !this.selectedMachine) return false;
    const id = this.selectedMachine.userData.editorId;
    const command = action === 'insert' ? 'insertBox' : action;
    try {
      if (action === 'emergency') {
        const current = this.simulation.getPanelSnapshot(id, this.scope || 'module');
        this.simulation.setScopedVariable(id, 'emergency', !current.variables.emergency, this.scope || 'module');
      } else if (this.simulation.command(id, command, undefined, this.scope || 'module') === false) {
        this.status('El mando no se pudo ejecutar: revisa alimentación, ocupación y conexión de suministro.'); return false;
      }
      this.pulseControl(command); this.simulation.refreshVariables(); this.visuals.sync('hall', 0, false); this.animatePausedControls(.04); this.updateStats(); this.updateSignals();
      this.status(action === 'emergency' ? 'Emergencia actualizada. Liberarla no inicia la marcha.' : 'Mando enviado al equipo seleccionado.');
      return true;
    } catch (error) { this.status(error.message); return false; }
  }

  pulseControl(action) {
    this.document.getObjects('hall').forEach(object => {
      if (object.userData.industrialAction !== action) return;
      const config = this.document.getBehaviors(object).find(value => value.type === 'control');
      if (!config || config.targetId !== this.selectedMachine.userData.editorId) return;
      const id = object.userData.editorId, previous = this.simulation.controlFeedback.get(id);
      const feedback = {controllers: new Set(), hovering: new Set(), sequence: (previous && previous.sequence || 0) + 1, until: this.simulation.time + 0.12};
      this.simulation.controlFeedback.set(id, feedback); this.wallPulses.set(feedback, .12);
    });
  }

  addProfile() {
    if (!this.simulation) return false;
    if (this.simulation.sourceRuntime.liveLoads() >= 500) { this.status('La exploración alcanzó el límite compartido de cargas.'); return false; }
    const profile = registry.PRODUCT_PROFILES.find(value => value.id === this.profileId) || registry.PRODUCT_PROFILES[0];
    const metadata = Object.assign({}, profile, {loadMode: profile.loadType === 'pallet' ? 'pallet' : 'individual'});
    const compatibility = schema.conveyorLayout.productCompatibility(this.config, metadata);
    if (!compatibility.ok) { this.status(compatibility.reasons.map(reason => reason.message).join(' ')); return false; }
    const loaded = profile.loadType === 'pallet';
    const load = {loadMode: loaded ? 'pallet' : 'individual', palletColumns: 1, palletRows: 1, palletLayers: 1};
    const spec = Object.assign({}, profile, {id: profile.id, name: profile.name, type: loaded ? 'box' : profile.productType,
      height: loaded ? Math.max(.05, profile.height - .15) : profile.height,
      mass: loaded ? Math.max(.1, profile.mass - 20) : profile.mass, base: loaded ? 'flat' : profile.base,
      color: this.quality === 'defective' ? '#cc665b' : '#b78b53', quality: this.quality || 'good', defect: this.quality === 'defective' ? 'damaged' : 'none'});
    const object = createSourceProductVisual(spec, load); object.name = profile.name;
    if (loaded) {
      // Reuse the real pallet carrier, then size the whole load to the declared
      // teaching profile. Keep its Source entry so every receiver recognizes
      // runners, handling unit, mass and provenance instead of a disguised box.
      const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      object.scale.set(profile.width / size.x, profile.height / size.y, profile.depth / size.z);
    }
    Object.assign(object.userData.sourceProduct, {mass: profile.mass, base: profile.base, color: spec.color, quality: spec.quality, defect: spec.defect});
    this.root.add(object); const product = this.simulation.registerProduct(object);
    const entry = {id: 'explorer:' + object.uuid, originId: this.selectedMachine.userData.editorId, ownerId: '', spec, load,
      units: 1, lineage: [this.selectedMachine.userData.editorId], scale: product.scale.toArray(), product};
    product.sourceEntry = entry; this.simulation.sourceRuntime.entries.add(entry);
    const record = this.simulation.records.get(this.selectedMachine.userData.editorId), belt = record && record.components.conveyor;
    if (!belt) { this.simulation.disposePackage({mesh: object}); return false; }
    const point = this.simulation.pathPoint(belt.config, Math.max(0.01, profile.width / 2 + .01), 'main');
    object.position.set(point.x, belt.top + (point.y || 0) + .006 - product.bounds.min.y * Math.abs(product.scale.y), point.z); this.selectedMachine.localToWorld(object.position);
    if (this.root.parent) this.root.worldToLocal(object.position); object.updateWorldMatrix(true, true);
    const candidate = this.simulation.findProductBelt(product, 0.22);
    if (!candidate || candidate.record !== record || !this.simulation.captureProduct(product, candidate)) {
      this.simulation.disposePackage({mesh: object}); this.status('La entrada está ocupada o la carga no tiene apoyo suficiente.'); return false;
    }
    this.status('Carga colocada en el recorrido real.'); this.updateStats(); return true;
  }

  createPaths() {
    this.paths = new THREE.Group(); this.paths.name = 'Recorridos y puertos'; this.paths.visible = this.pathToggle.checked;
    this.machines.forEach(object => {
      const config = this.document.getBehaviors(object).find(value => value.type === 'conveyor');
      schema.conveyorLayout.pathBranches(config).forEach(route => {
        const length = schema.conveyorLayout.pathLength(config, route), points = [];
        for (let index = 0; index <= 96; index++) {
          const point = schema.conveyorLayout.pathPoint(config, length * index / 96, route);
          points.push(object.localToWorld(new THREE.Vector3(point.x, (point.y || 0) + 0.06, point.z)));
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color: route === 'main' ? 0x61f7d4 : 0xffd45a})); this.paths.add(line);
      });
      Object.values(schema.conveyorLayout.ports(config)).forEach(port => {
        const marker = new THREE.Mesh(new THREE.SphereBufferGeometry(0.055, 12, 8), new THREE.MeshBasicMaterial({color: 0xffd45a}));
        marker.position.copy(object.localToWorld(new THREE.Vector3(port.x, (port.y || 0) + 0.10, port.z))); this.paths.add(marker);
      });
    }); this.scene.add(this.paths);
  }

  frame(objects) {
    if (!objects.length || !this.camera) return;
    const bounds = boundsOf(objects), center = bounds.getCenter(new THREE.Vector3());
    if (bounds.isEmpty()) return;
    const direction = new THREE.Vector3(0.95, 0.63, 1.15).normalize();
    this.camera.position.copy(center).add(direction); this.camera.lookAt(center);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const tangentV = Math.tan(THREE.Math.degToRad(this.camera.fov) / 2), tangentH = tangentV * Math.max(0.01, this.camera.aspect);
    let distance = 0.45;
    [bounds.min.x, bounds.max.x].forEach(x => [bounds.min.y, bounds.max.y].forEach(y => [bounds.min.z, bounds.max.z].forEach(z => {
      const point = new THREE.Vector3(x, y, z).sub(center), depth = point.dot(direction);
      distance = Math.max(distance, depth + Math.abs(point.dot(right)) * 1.12 / tangentH, depth + Math.abs(point.dot(up)) * 1.12 / tangentV);
    })));
    this.camera.position.copy(center).addScaledVector(direction, distance + 0.08);
    this.orbit.target.copy(center); this.orbit.update();
  }

  selectPart(part) {
    this.clearHighlight(); this.selectedPart = part;
    const nodes = this.partNodes(part); if (!nodes.length) return;
    const bounds = boundsOf(nodes); this.highlight = new THREE.Box3Helper(bounds, 0xffd45a); this.highlight.raycast = () => {};
    this.scene.add(this.highlight); this.partCaption.textContent = part.name + ' · ' + part.function;
    if (this.partButtons) this.partButtons.forEach(entry => entry.button.setAttribute('aria-pressed', String(entry.part.id === part.id)));
  }

  clearHighlight() {
    if (this.highlight) { this.scene.remove(this.highlight); disposeTree(this.highlight); this.highlight = null; }
    this.selectedPart = null;
  }

  pick(event) {
    if (!this.renderer || !this.root) return;
    const rect = this.renderer.domElement.getBoundingClientRect(), point = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(point, this.camera);
    const hit = ray.intersectObjects(this.machines, true).find(value => shown(value.object) && !value.object.userData.editorRuntimeHelper);
    if (!hit) return;
    let machine = hit.object; while (machine && !this.machines.includes(machine)) machine = machine.parent;
    if (machine && machine !== this.selectedMachine) {
      this.selectedMachine = machine; this.config = this.document.getBehaviors(machine).find(value => value.type === 'conveyor'); this.definition = registry.resolveVariant(this.config); this.partImages = null; this.renderVariant();
    }
    const ancestry = []; for (let current = hit.object; current && current !== machine; current = current.parent) ancestry.push(fold(current.name));
    const part = this.definition.parts.find(value => (value.match || []).some(match => ancestry.some(name => name.includes(fold(match)))));
    if (part) { this.tab = 'Partes'; this.renderTab(); this.selectPart(part); }
  }

  makePartThumbnails() {
    if (!this.renderer || !this.scene || !this.selectedMachine) return;
    this.partImages = {};
    const position = this.camera.position.clone(), target = this.orbit.target.clone();
    const width = this.renderer.domElement.width, height = this.renderer.domElement.height, ratio = this.renderer.getPixelRatio(), aspect = this.camera.aspect;
    this.renderer.setPixelRatio(1); this.renderer.setSize(256, 144, false); this.camera.aspect = 256 / 144; this.camera.updateProjectionMatrix();
    const gridVisible = this.grid.visible; this.grid.visible = false;
    try {
      this.definition.parts.forEach(part => {
        const nodes = this.partNodes(part); if (!nodes.length) return;
        this.frame(nodes); this.renderer.render(this.scene, this.camera); this.partImages[part.id] = this.renderer.domElement.toDataURL('image/png');
      });
    } catch (error) { this.status('No se pudo generar el detalle del modelo: ' + error.message); }
    finally {
      this.grid.visible = gridVisible; this.renderer.setPixelRatio(ratio); this.renderer.setSize(width / ratio, height / ratio, false);
      this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); this.camera.position.copy(position); this.orbit.target.copy(target); this.orbit.update();
    }
    if (this.partButtons) this.partButtons.forEach((entry, id) => { if (this.partImages[id]) { entry.image.src = this.partImages[id]; entry.image.hidden = false; } });
    this.render();
  }

  status(message) { if (this.message) this.message.textContent = message; }
  updateRunButton() { if (this.runButton) { this.runButton.textContent = this.playing ? 'Ⅱ Pausar tiempo' : '▶ Ejecutar'; this.runButton.setAttribute('aria-pressed', String(this.playing)); } }

  advance(delta) {
    if (!this.simulation) return;
    const world = this.context.collisionWorld; world.beginFrame();
    try { this.simulation.execute(Math.min(delta, 0.25)); } finally { world.endFrame(); }
    this.visuals.sync('hall', Math.min(delta, .25), false); this.updateStats(); this.updateSignals();
  }

  animatePausedControls(delta) {
    if (!this.visuals || !this.visuals.bindings) return;
    this.visuals.bindings.forEach(binding => { if (binding.kind === 'button') this.visuals.updateButton(binding, delta, false); });
  }

  variables() { const record = this.simulation && this.selectedMachine && this.simulation.records.get(this.selectedMachine.userData.editorId); return record && record.variables || {}; }
  updateStats() {
    if (!this.simulation || !this.stats) return;
    const value = this.variables();
    this.stats.textContent = 't ' + this.simulation.time.toFixed(1) + ' s · ' + (value.mechanismPhase || (value.running ? 'En marcha' : 'Detenida')) +
      ' · ' + Number(value.actualSpeed || 0).toFixed(2) + ' m/s · Entradas ' + Number(value.entryCount || 0) + ' · Salidas ' + Number(value.exitCount || 0) +
      ' · En equipo ' + Number(value.inFlight || 0) + (value.transferBlocked ? ' · Esperando salida' : '');
    const phase = this.content.querySelector('[data-live="phase"]'); if (phase) phase.textContent = 'Fase actual: ' + (value.mechanismPhase || 'Transporte');
  }

  updateSignals() {
    if (!this.liveControls || !this.liveControls.isConnected || this.tab !== 'Controles') return;
    const panel = this.simulation.getPanelSnapshot(this.selectedMachine.userData.editorId, this.scope || 'module');
    const value = panel && panel.variables || this.variables(); this.liveControls.textContent = '';
    const labels = {powered: 'Alimentación', running: 'Marcha', emergency: 'Emergencia', paused: 'Pausa', actualSpeed: 'Velocidad real', mechanismPhase: 'Fase', actuatorPosition: 'Actuador', actuatorAngle: 'Giro (rad)', elevatorPosition: 'Nivel (m)', zonesOccupied: 'Zonas ocupadas', operatorAvailable: 'Operario disponible'};
    Object.keys(labels).forEach(key => { if (value[key] === undefined) return; el('dt', labels[key], this.liveControls); el('dd', typeof value[key] === 'boolean' ? value[key] ? 'Sí' : 'No' : typeof value[key] === 'number' ? value[key].toFixed(2) : String(value[key]), this.liveControls); });
    this.simulation.records.forEach(record => {
      if (!record.components.sensor || record.components.sensor.config.sourceId !== this.selectedMachine.userData.editorId) return;
      el('dt', record.object.name, this.liveControls); el('dd', record.variables.active ? 'Detectando' : 'Libre', this.liveControls);
    });
  }

  render() {
    if (!this.renderer || !this.scene) return;
    const width = Math.max(1, this.viewport.clientWidth), height = Math.max(1, this.viewport.clientHeight), ratio = this.renderer.getPixelRatio();
    if (this.renderer.domElement.width !== Math.floor(width * ratio) || this.renderer.domElement.height !== Math.floor(height * ratio)) {
      this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    }
    this.orbit.update(); this.renderer.render(this.scene, this.camera);
  }

  tick(delta) {
    if (!this.opened) return;
    if (!this.editor.active || this.editor.ctx.vrMode) { this.close(); return; }
    if (document.hidden) { this.frameElapsed = 0; return; }
    const frame = Math.min(Math.max(0, delta), 0.25);
    this.wallPulses.forEach((remaining, feedback) => { if (remaining <= frame) { feedback.until = 0; this.wallPulses.delete(feedback); } else this.wallPulses.set(feedback, remaining - frame); });
    this.frameElapsed += frame;
    if (this.frameElapsed < 1 / 30) return;
    const elapsed = this.frameElapsed; this.frameElapsed = 0;
    if (this.playing) this.advance(elapsed);
    else if (this.visuals) { this.visuals.sync('hall', 0, false); this.animatePausedControls(elapsed); }
    if (this.highlight && this.selectedPart) this.highlight.box.copy(boundsOf(this.partNodes(this.selectedPart)));
    this.render();
  }

  async insertIntoScene() {
    const editor = this.editor, exampleId = this.exampleId, definition = this.definition, overrides = Object.assign({}, this.overrides);
    if (editor.busy || editor.loadingProject || editor.pendingEdits || editor.transform && editor.transform.dragging) return;
    this.close();
    if (exampleId === 'single') {
      await editor.perform(() => editor.createPlacedObject(() => {
        const object = editor.document.addPrefab(editor.roomId, 'conveyor', definition.variant);
        if (Object.keys(overrides).length) editor.document.setBehaviors(object, editor.document.getBehaviors(object).map(config => config.type === 'conveyor' ? Object.assign({}, config, overrides, {outputId: '', branchId: ''}) : config));
        return object;
      }));
      return;
    }
    await editor.perform(async () => {
      editor.document.begin();
      const group = new THREE.Group(); group.name = 'Ubicación temporal de línea'; editor.root.add(group);
      let graph, committed = false;
      try {
        const position = editor.orbit.target.clone(); position.y = 1.02;
        graph = buildConveyorExample(editor.document, editor.roomId, exampleId, {scene: editor.ctx.scene, position: position.toArray()});
        editor.root.updateWorldMatrix(true, true);
        graph.objects.forEach(object => group.attach(object));
        editor.equipmentPlacement.place(group, editor.orbit.target);
        group.updateWorldMatrix(true, true);
        graph.objects.forEach(object => {
          editor.root.attach(object);
          editor.document.setTransform(object, {position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray()});
        });
        const existing = (editor.document.studio && editor.document.studio.groups || []);
        editor.document.setStudio({groups: existing.concat({id: 'line-' + Date.now().toString(36), name: graph.name, roomId: editor.roomId, members: graph.objects.map(object => object.userData.editorId)})});
        editor.document.commit(); committed = true; editor.select(graph.first); editor.toast('Línea añadida. Sus equipos conservan controles y datos independientes.');
      } catch (error) { editor.document.cancel(); throw error; }
      finally {
        if (group.parent) group.parent.remove(group);
        if (!committed && graph) graph.objects.forEach(disposeTree);
      }
    });
  }

  trapFocus(event) {
    const focusable = Array.from(this.overlay.querySelectorAll('button,input,select,a[href],[tabindex="0"]')).filter(node => !node.disabled && node.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  destroyWorld() {
    this.clearHighlight(); if (this.simulation) this.simulation.stop(); if (this.visuals) this.visuals.dispose();
    disposeTree(this.scene); this.simulation = this.visuals = this.document = this.scene = this.root = this.paths = null;
    this.partImages = null; this.partButtons = null; this.liveControls = null; this.compatibility = null; this.machines = [];
    this.context = this.selectedMachine = this.scopeSummary = null; this.wallPulses.clear();
  }

  close() {
    if (!this.opened && !this.renderer) return;
    this.opened = false; this.playing = false; this.destroyWorld();
    if (this.orbit) this.orbit.dispose(); this.orbit = null;
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer = null; }
    if (this.overlay) this.overlay.remove(); this.overlay = null;
    if (this.previousFocus && this.previousFocus.isConnected) this.previousFocus.focus();
  }

  dispose() { this.close(); document.removeEventListener('keydown', this.keydown, true); window.removeEventListener('pagehide', this.pagehide); }
}
