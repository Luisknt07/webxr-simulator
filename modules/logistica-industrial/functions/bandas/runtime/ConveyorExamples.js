import * as THREE from 'three';
import ConveyorAssembly from './ConveyorAssembly.js';

export const conveyorExamples = [
  {id: 'single', name: 'Equipo individual', description: 'Panel y comportamiento del equipo seleccionado.'},
  {id: 'straight', name: 'Recta conectada', description: 'Dos módulos rectos; el segundo espera si se detiene.'},
  {id: 'manual', name: 'Carga manual', description: 'Estación con operario y banda receptora. La disponibilidad y el despacho son acciones explícitas.'},
  {id: 'line-l', name: 'L con curva', description: 'Cambio de dirección mediante un arco real de 90°, sin salto lateral.'},
  {id: 'line-l-transfer', name: 'L por transferencia a 90°', description: 'Dos rectas largas perpendiculares, unidas por correas elevables entre rodillos.'},
  {id: 'line-t', name: 'T con empujador', description: 'Un empujador deriva cargas a la rama lateral y espera al receptor.'},
  {id: 'line-y', name: 'Y con unión coordinada', description: 'Dos entradas, una unión angular de 45° y reserva de la zona común antes de entregar.'},
  {id: 'accumulation', name: 'Acumulación bloqueada', description: 'Zonas de retención y una salida detenida. Inicia la salida para liberar las zonas.'},
  {id: 'transfer', name: 'Transferencia elevable', description: 'Correas transversales y confirmación del receptor antes de entregar.'},
  {id: 'level', name: 'Cambio de nivel', description: 'Elevador guiado y banda de salida en la cota superior.'},
  {id: 'sorting', name: 'Clasificación por atributo', description: 'Regla sobre la calidad declarada del producto; el sensor solo detecta presencia.'},
  {id: 'rectangle', name: 'Circuito rectangular', description: 'Cuatro curvas y cuatro rectas con ocupación y contrapresión en un circuito cerrado.'}
];

/** Instantiate complete graphs through the existing document and port magnet.
 * Never loads a saved project, edits a native room, or creates a second clock.
 */
export function buildConveyorExample(document, roomId, exampleId, options = {}) {
  const example = conveyorExamples.find(value => value.id === exampleId);
  if (!example || example.id === 'single') throw new Error('Selecciona un ejemplo de línea.');
  const root = document.getRoot(roomId), scene = options.scene || root;
  const editor = {document, roomId, root, ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}};
  const assembly = new ConveyorAssembly(editor), objects = [], links = [];
  const origin = options.position || [0, 1.02, 0];
  const ownTransaction = !document.transaction;
  if (ownTransaction) document.begin();
  function patch(object, values) {
    document.setBehaviors(object, document.getBehaviors(object).map(config => config.type === 'conveyor' ? Object.assign({}, config, values) : config));
  }
  function add(variant, overrides = {}) {
    const object = document.addPrefab(roomId, 'conveyor', variant);
    object.name = (objects.length + 1) + ' · ' + object.name;
    patch(object, Object.assign({withPanel: objects.length === 0, autoSpawn: false, running: false}, overrides));
    document.setTransform(object, {position: origin}); objects.push(object); return object;
  }
  function connect(from, to, port = 'output', input = 'input') {
    if (!assembly.align(from, port, to, input)) throw new Error('El ejemplo no tiene interfaces compatibles: ' + from.name + ' → ' + to.name);
    const assessment = assembly.assessConnection(from, port, to, input);
    if (!assessment.ready) throw new Error(assessment.reasons.map(reason => reason.message).join(' '));
    if (!assembly.connect(assembly.pair(to, input, from, port))) throw new Error('No se pudo reservar el enlace funcional del ejemplo.');
    links.push({source: from.userData.editorId, sourcePort: port, target: to.userData.editorId, targetPort: input});
  }
  try {
    if (example.id === 'straight') {
      connect(add('roller-motor', {length: 2.4}), add('roller-motor', {length: 2.4}));
    } else if (example.id === 'manual') {
      connect(add('manual-station', {operatorAvailable: false}), add('roller-motor', {length: 2.4}));
    } else if (example.id === 'line-l') {
      const first = add('roller-motor', {length: 2.4}), curve = add('roller-curve'), last = add('roller-motor', {length: 2.4});
      connect(first, curve); connect(curve, last);
    } else if (example.id === 'line-l-transfer') {
      const first = add('roller-motor', {length: 4.5, withSensors: false});
      const transfer = add('popup-belt', {length: 1, width: 1, routing: 'branch', branchSide: 'left', withSensors: true});
      const last = add('roller-motor', {length: 4.5, withSensors: false});
      connect(first, transfer); connect(transfer, last, 'branch');
    } else if (example.id === 'line-t' || example.id === 'sorting') {
      const first = add('roller-motor', {length: 2.4});
      const diverter = add(example.id === 'sorting' ? 'distributor' : 'pusher', example.id === 'sorting' ? {
        routing: 'rules', routingDefault: 'main', routingRules: JSON.stringify([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}])
      } : {routing: 'alternate'});
      const main = add('roller-motor', {length: 2.4}), branch = add('roller-motor', {length: 2.4});
      connect(first, diverter); connect(diverter, main); connect(diverter, branch, 'branch');
    } else if (example.id === 'line-y') {
      const first = add('roller-motor', {length: 2.4}), merge = add('merge-angle', {mergeAngle: 45}), second = add('roller-motor', {length: 2.4, withPanel: true}), last = add('roller-motor', {length: 2.4});
      connect(first, merge); connect(merge, last);
      // Here the branch is an input. Align the second upstream to this incoming
      // port; never rotate the already-assembled merge or invent another path.
      if (!assembly.align(merge, 'branch', second, 'output')) throw new Error('No se pudo alinear la segunda entrada de la Y.');
      const pair = assembly.pair(second, 'output', merge, 'branch');
      if (!pair || !assembly.connect(pair)) throw new Error('No se pudo reservar la segunda entrada de la Y.');
      links.push({source: second.userData.editorId, sourcePort: 'output', target: merge.userData.editorId, targetPort: 'branch'});
    } else if (example.id === 'accumulation') {
      const first = add('roller-motor', {length: 2.4}), zones = add('roller-zones'), last = add('roller-motor', {length: 2.4, withPanel: true});
      connect(first, zones); connect(zones, last); last.userData.conveyorExampleBlocked = true;
    } else if (example.id === 'transfer') {
      const first = add('roller-motor', {length: 2.4}), transfer = add('popup-belt', {routing: 'branch'}), branch = add('roller-motor', {length: 2.4});
      connect(first, transfer); connect(transfer, branch, 'branch');
    } else if (example.id === 'level') {
      const first = add('roller-motor', {length: 2.4}), lift = add('box-elevator'), last = add('roller-motor', {length: 2.4, supportHeight: 3});
      connect(first, lift); connect(lift, last);
    } else if (example.id === 'rectangle') {
      let previous;
      for (let side = 0; side < 4; side++) {
        const straight = add('roller-motor', {length: 2.4}), curve = add('roller-curve');
        if (previous) connect(previous, straight);
        connect(straight, curve); previous = curve;
      }
      const first = objects[0], check = assembly.assessConnection(previous, 'output', first, 'input');
      if (!check.ready) throw new Error('No coincide el cierre físico del circuito rectangular.');
      if (!assembly.connect(assembly.pair(first, 'input', previous, 'output'))) throw new Error('No se pudo cerrar el circuito.');
      links.push({source: previous.userData.editorId, sourcePort: 'output', target: first.userData.editorId, targetPort: 'input'});
    }
    if (ownTransaction) document.commit();
    return {id: example.id, name: example.name, objects, links, first: objects[0], last: objects[objects.length - 1]};
  } catch (error) {
    if (ownTransaction) document.cancel();
    throw error;
  } finally { assembly.clear(); }
}
