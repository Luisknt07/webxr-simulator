const __layout = require("../layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {POLICY, PUBLIC_DEMO, project} = require('../../projects/smarttwin/public-scenes');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/generate-public-scenes.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const dependencies = require('../../tests/support/load-robot-prefabs')(THREE);
const factory = new Function('THREE', 'behaviorSchema', 'require', read("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn createIndustrialPrefab;')(THREE, schema, dependencies.resolve);
const Document = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, schema, factory);

// Reads production factories and bundled models only, never SQLite/accounts.
class ExampleDocument extends Document { _newId() { let id; do {id = 'custom-public-' + this.nextId++;} while (this.objects.has(id)); return id; } }
function mask(root) {
  function roots(file) {const bytes = fs.readFileSync(path.join(root, 'modules/turismo/assets', file)), length = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8').trim()); return gltf.scenes[gltf.scene || 0].nodes.length;}
  return {hall: 1, sound: 2, photogrammetry: roots('angel.min.glb'), vertigo: roots('vertigo.glb'), panoramastereo: 2, panorama1: 1, panorama2: 1, panorama3: 1, panorama4: 1, panorama5: 1};
}
function workspace() {const scene = new THREE.Scene(), document = new ExampleDocument({scene}); schema.studio.ROOM_IDS.forEach(id => {const root = new THREE.Group(); scene.add(root); document.registerRoom(id, root);}); return {scene, document};}
async function generate(root = __layout.map(path.resolve(__layout.oldDir("scripts/generate-public-scenes.js"), '..')), options = {}) {
  const previewAllExamples = options.previewAllExamples === undefined ? POLICY.previewAllExamples : options.previewAllExamples;
  const compiler = require('../../tests/support/load-study-scenes')(THREE, schema, ExampleDocument), builders = require('../../tests/support/load-industrial-cedi')(THREE, schema), counts = mask(root);
  const directory = path.join(root, 'projects/smarttwin/scenes'); fs.mkdirSync(directory, {recursive: true});
  const scenes = [], outputs = new Map(), only = options.only;
  const append = (definition, document) => {const value = Object.assign({}, definition, {projectId: 'public-' + definition.id, revision: 1, public: true, included: true}); scenes.push(value); if (document && (!only || only === definition.id)) outputs.set(definition.id + '.json', JSON.stringify({project: project(document, definition)}) + '\n');};
  const templates = previewAllExamples ? compiler.STUDY_SCENES : compiler.STUDY_SCENES.filter(scene => ['lab-transfer-l', 'lab-sorting'].includes(scene.id));
  const ordered = templates.slice().sort((a, b) => {const rank = id => id === 'lab-transfer-l' ? 0 : id === 'lab-sorting' ? 1 : 2; return rank(a.id) - rank(b.id);});
  for (const definition of ordered) {
    const roomId = definition.id === 'lab-sorting' ? 'sound' : 'hall', id = definition.id === 'lab-transfer-l' ? 'l-transfer' : definition.id === 'lab-sorting' ? 'inspection-sorting' : definition.id;
    const template = id === PUBLIC_DEMO.id ? compiler.STUDY_SCENES.find(row => row.id === PUBLIC_DEMO.templateId) : definition;
    const metadata = {id, roomId, name: id === PUBLIC_DEMO.id ? PUBLIC_DEMO.name : template.title, templateId: template.id, collection: template.family, difficulty: template.difficulty, mode: template.mode};
    if (only && only !== id) {append(metadata); continue;}
    const w = workspace(); compiler.studySceneBase(w.document, roomId); compiler.buildStudyScene(w.document, roomId, template.id, {scene: w.scene, continuous: true});
    const document = await w.document.serialize(); document.rooms[roomId].overrides = Array.from({length: counts[roomId]}, (_, index) => ({id: 'native:' + roomId + ':root.' + index, visible: false}));
    append(metadata, document);
    w.scene.traverse(node => {if (node.geometry) node.geometry.dispose();});
  }
  if (previewAllExamples) {
    const roomId = 'hall', metadata = {id: 'industrial-lab-complete', roomId, name: 'Laboratorio industrial · Ejemplos completos', collection: 'Laboratorio completo', mode: 'mixed'};
    if (!only || only === metadata.id) {
      const w = workspace(); compiler.studySceneBase(w.document, roomId); builders.buildIndustrialLab(w.document, roomId, {scene: w.scene, continuous: true, robotized: true});
      const document = await w.document.serialize(); document.rooms[roomId].overrides = [{id: 'native:hall:root.0', visible: false}];append(metadata, document);
      w.scene.traverse(node => {if (node.geometry) node.geometry.dispose();});
    } else append(metadata);
    schema.studio.ROOM_IDS.forEach((room, index) => append({id: 'original-' + room, roomId: room, name: schema.studio.ROOM_NAMES[index], collection: 'Experiencias originales', original: true}, {format: 'hello-webxr-editor', version: 1, rooms: {[room]: {overrides: [], additions: []}}, imports: [], studio: {scenes: [{id: room, name: schema.studio.ROOM_NAMES[index]}], startRoomId: room}}));
  }
  if (only && !outputs.has(only + '.json')) throw new Error('El escenario solicitado no pertenece al catálogo.');
  outputs.set('catalog.json', JSON.stringify({scenes, maxActive: 2, requiresLogin: !previewAllExamples, previewAllExamples, includedCount: scenes.length, templateCount: templates.length, originalCount: previewAllExamples ? schema.studio.ROOM_IDS.length : 0, laboratoryCount: previewAllExamples ? 1 : 0}) + '\n');
  // Bounded cleanup removes former generated JSON, not arbitrary directories.
  if (!only) for (const name of fs.readdirSync(directory)) if (/^[a-z0-9-]+\.json$/.test(name) && !outputs.has(name)) fs.unlinkSync(__layout.map(path.join(directory, name)));
  for (const [name, value] of outputs) fs.writeFileSync(__layout.map(path.join(directory, name)), value);
  return scenes;
}
if (require.main === module) generate(__layout.map(path.resolve(__layout.oldDir("scripts/generate-public-scenes.js"), '..')), {only: process.argv.find(value => value.startsWith('--only='))?.slice(7), previewAllExamples: process.argv.includes('--restricted') ? false : POLICY.previewAllExamples}).then(scenes => console.log('Ejemplos públicos incluidos: ' + scenes.length + ' proyecciones sin archivos de usuario.')).catch(error => {console.error(error); process.exitCode = 1;});
module.exports = generate;
