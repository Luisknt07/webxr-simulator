'use strict';

// Preview applies only to bundled examples. User permissions and the saved
// selection of two public rooms remain independent and reversible.
const POLICY = Object.freeze({previewAllExamples: true});
// Keep the bounded public URL stable, but use the maintained transfer lesson
// rather than a separate demonstration layout.
const PUBLIC_DEMO = Object.freeze({id: 'vr-robot-dispatch', templateId: 'vr-robot-transfer', name: 'RV · Transferencia guiada'});
const SCENES = Object.freeze([
  Object.freeze({id: 'l-transfer', name: 'Transferencia rectangular a 90°', roomId: 'hall'}),
  Object.freeze({id: 'inspection-sorting', name: 'Inspección y clasificación', roomId: 'sound'})
]);

function project(document, scene) {
  if (!scene || !/^[a-z0-9-]{1,80}$/.test(scene.id) || !require('../../packages/project-model/shared/studio-document').ROOM_IDS.includes(scene.roomId) || !document.rooms || !document.rooms[scene.roomId]) throw new Error('El ejemplo público no existe.');
  const source = JSON.parse(JSON.stringify(document)), room = source.rooms[scene.roomId];
  const copy = {format: source.format, version: source.version, rooms: {[scene.roomId]: room}, imports: []};
  room.overrides = (room.overrides || []).filter(row => row.visible === false && new RegExp('^native:' + scene.roomId + ':root\\.\\d+$').test(row.id)).map(row => ({id: row.id, visible: false}));
  // Bundled examples use catalogue assets. Never export imported/server files.
  copy.imports = [];
  const studio = {version: 1};
  for (const key of ['scenes', 'environments', 'entities', 'spawns', 'widgets', 'missions', 'groups']) if (source.studio && source.studio[key]) studio[key] = source.studio[key].filter(item => (item.roomId || item.id) === scene.roomId);
  studio.startRoomId = scene.roomId;
  delete studio.resources; delete studio.folders;
  copy.studio = studio;
  return {id: 'public-' + scene.id, name: scene.name, revision: 1, document: copy,
    access: {role: 'public', canEdit: false, canShare: false}, allowedRoomIds: [scene.roomId], publicSceneId: scene.id};
}

module.exports = {POLICY, PUBLIC_DEMO, SCENES, project};
