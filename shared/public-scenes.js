'use strict';

// The static distribution contains exactly these two public examples. Private
// projects, accounts and the authenticated library always require the server.
const SCENES = Object.freeze([
  Object.freeze({id: 'l-transfer', name: 'Transferencia rectangular a 90°', roomId: 'hall'}),
  Object.freeze({id: 'inspection-sorting', name: 'Inspección y clasificación', roomId: 'sound'})
]);

function project(document, scene) {
  if (!SCENES.some(item => item.id === scene.id && item.roomId === scene.roomId) || !document.rooms || !document.rooms[scene.roomId]) throw new Error('El ejemplo público no existe.');
  const copy = JSON.parse(JSON.stringify(document));
  copy.rooms = {[scene.roomId]: copy.rooms[scene.roomId]};
  // Bundled examples use catalogue assets. Never export imported/server files.
  copy.imports = [];
  const studio = copy.studio || {};
  for (const key of ['scenes', 'environments', 'entities', 'spawns', 'widgets', 'missions', 'groups']) if (studio[key]) studio[key] = studio[key].filter(item => (item.roomId || item.id) === scene.roomId);
  studio.startRoomId = scene.roomId;
  delete studio.resources; delete studio.folders;
  copy.studio = studio;
  return {id: 'public-' + scene.id, name: scene.name, revision: 1, document: copy,
    access: {role: 'public', canEdit: false, canShare: false}, allowedRoomIds: [scene.roomId], publicSceneId: scene.id};
}

module.exports = {SCENES, project};
