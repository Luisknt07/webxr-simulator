import * as THREE from 'three';
import schema from '../../shared/behaviors.js';
import SceneDocument from './SceneDocument.js';
import {buildStudyScene, studySceneReport} from './IndustrialStudyScenes.js';
import {studyScene} from './StudySceneCatalog.js';

export function studySceneBase(document, roomId) {
  const spawn = document.addPrimitive(roomId, 'cylinder', '#51ebd2'); document.setProperty(spawn, 'name', 'Inicio del nivel');
  document.setTransform(spawn, {position: [0, .02, 8], scale: [.45, .03, .45]}); document.setBehaviors(spawn, [Object.assign(schema.defaultBehavior('collision'), {enabled: false})]);
  const camera = document.addPrimitive(roomId, 'box', '#67dbe8'); document.setProperty(camera, 'name', 'Cámara principal');
  document.setTransform(camera, {position: [0, 4, 8], scale: [.2, .14, .28]}); document.setBehaviors(camera, [Object.assign(schema.defaultBehavior('collision'), {enabled: false})]);
  const studio = document.studio || {};
  document.setStudio({spawns: (studio.spawns || []).concat({roomId, objectId: spawn.userData.editorId}), entities: (studio.entities || []).concat({id: 'study-camera-' + roomId, objectId: camera.userData.editorId, roomId, type: 'camera', fov: 55})});
}

export function disposeStudyGeometry(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => { if (object.geometry) geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => { materials.add(material); Object.keys(material).forEach(key => { if (material[key] && material[key].isTexture) textures.add(material[key]); }); }); });
  textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
}

export function studyWorkspace() {
  const scene = new THREE.Scene(), roots = {};
  const document = new SceneDocument({scene, editorRoots: roots});
  schema.studio.ROOM_IDS.forEach(id => { const root = new THREE.Group(); roots[id] = root; scene.add(root); document.registerRoom(id, root); });
  return {scene, document, roots};
}

/** Pure preparation API: source document, database and current room stay intact.
 * The caller writes one complete document only after all builders succeed. */
export async function compileStudyProject(ids, options = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > schema.studio.ROOM_IDS.length || new Set(ids).size !== ids.length) throw new Error('Elige entre uno y diez escenarios distintos para cada proyecto.');
  ids.forEach(studyScene);
  const workspace = studyWorkspace(), reports = [];
  try {
    workspace.document.begin();
    ids.forEach((id, index) => {
      const roomId = schema.studio.ROOM_IDS[index]; studySceneBase(workspace.document, roomId);
      const built = buildStudyScene(workspace.document, roomId, id, {scene: workspace.scene, continuous: options.continuous}); reports.push(studySceneReport(workspace.document, built, roomId));
    });
    workspace.document.setStudio({startRoomId: schema.studio.ROOM_IDS[0], scenes: ids.map((id, index) => ({id: schema.studio.ROOM_IDS[index], name: studyScene(id).title}))});
    workspace.document.commit(); const serialized = await workspace.document.serialize();
    if (options.nativeDocument && options.nativeDocument.native) {
      ids.forEach((id, index) => {
        const roomId = schema.studio.ROOM_IDS[index], sourceRoot = options.nativeDocument.getRoot(roomId);
        options.nativeDocument.native.forEach((entry, nativeId) => { if (entry.roomId === roomId && entry.object.parent === sourceRoot) serialized.rooms[roomId].overrides.push({id: nativeId, visible: false}); });
      });
    }
    return {name: options.name || (ids.length === 1 ? 'Estudio · ' + studyScene(ids[0]).title : 'Escenarios de estudio · ' + ids.length + ' prácticas'), document: serialized, reports};
  } finally { disposeStudyGeometry(workspace.scene); }
}

/** A real empty project has one declared level and its usable environment.
 * Prepare off-world before one quota-checked create request. */
export async function compileBlankProject(options = {}) {
  const workspace = studyWorkspace(), roomId = schema.studio.ROOM_IDS[0], document = workspace.document;
  try {
    document.begin();
    const floor = document.addPrimitive(roomId, 'plane', '#87939a'); document.setProperty(floor, 'name', 'Suelo del nivel');
    document.setTransform(floor, {position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [30, 30, 1]}); document.setBehaviors(floor, [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport')]);
    studySceneBase(document, roomId);
    document.setStudio({startRoomId: roomId, scenes: [{id: roomId, name: options.sceneName || 'Escenario principal'}], environments: [schema.studio.defaultEnvironment(roomId)]});
    document.commit(); const serialized = await document.serialize();
    const native = options.nativeDocument;
    if (native && native.native) native.native.forEach((entry, id) => { if (entry.roomId === roomId && entry.object.parent === native.getRoot(roomId)) serialized.rooms[roomId].overrides.push({id, visible: false}); });
    return {name: options.name || 'Nuevo proyecto', document: serialized, reports: []};
  } finally { disposeStudyGeometry(workspace.scene); }
}

/** Private geometry for the lazy thumbnail renderer, generated by the same
 * builders as the saved scenario. No asset-path/source-model substitution. */
export function studyPreviewObject(id) {
  const workspace = studyWorkspace();
  try {
    const built = buildStudyScene(workspace.document, 'hall', id, {scene: workspace.scene, preview: true, continuous: false});
    const result = new THREE.Group(), lines = built.lines || built.cells;
    lines.forEach(line => line.objects.forEach(object => { if (object.parent === workspace.roots.hall) result.add(object); }));
    disposeStudyGeometry(workspace.scene); return result;
  } catch (error) { disposeStudyGeometry(workspace.scene); throw error; }
}
