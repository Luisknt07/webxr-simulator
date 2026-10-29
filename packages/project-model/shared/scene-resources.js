/* Scene membership is derived from authoring records, never from loading another
 * room's models or from the project's complete import inventory. */
'use strict';

function collect(value, references, visited = new Set(), depth = 0) {
  if (depth > 40 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.length <= 1200) references.add(value);
    // Material assignments, decals, wear layers and automation keep bounded
    // JSON fields in their behavior records.
    if (value.length <= 2 * 1024 * 1024 && /^\s*[\[{]/.test(value)) {
      try { collect(JSON.parse(value), references, visited, depth + 1); } catch (error) { /* Plain text is not a dependency. */ }
    }
    return;
  }
  if (typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  Object.keys(value).forEach(key => collect(value[key], references, visited, depth + 1));
}

function assetKeys(entry) {
  if (!entry) return [];
  return [entry.importId, entry.id, entry.path, entry.url, entry.id && 'asset:' + entry.id,
    entry.importId && 'asset:' + entry.importId, entry.path && 'asset:' + entry.path].filter(Boolean);
}

/** Supports both live SceneDocument and serialized project data. No serialize()
 * call is made: listing files must not commit a drag or hydrate inactive rooms.
 */
function index(document, roomId, entries = []) {
  if (!document || !roomId) return null;
  const references = new Set(), resourceIds = new Set(), studio = document.studio || {};
  const add = value => collect(value, references);
  if (typeof document.getObjects === 'function') {
    document.getObjects(roomId).forEach(object => {
      const data = object.userData || {};
      add(typeof document.getVisualDescriptor === 'function' ? document.getVisualDescriptor(object) : data.editorDescriptor);
      add(typeof document.getBehaviors === 'function' ? document.getBehaviors(object) : data.editorBehaviors || data.editorDefaultBehaviors);
      add(data.editorInteraction);
    });
  } else {
    const room = document.rooms && document.rooms[roomId];
    if (room) { add(room.additions || []); add(room.overrides || []); }
  }
  const pending = document.pendingRooms && document.pendingRooms.get && document.pendingRooms.get(roomId);
  if (pending) { add(pending.additions || []); add(pending.nativeVisuals || []); }
  // Room configuration is optional in older projects. Future environment fields
  // can contain image/audio references without exposing other levels' settings.
  (studio.scenes || []).filter(scene => scene.id === roomId).forEach(add);
  ['widgets', 'missions', 'entities', 'spawns', 'groups', 'environments'].forEach(type => {
    (studio[type] || []).filter(item => item.roomId === roomId).forEach(item => {
      add(item);
      if (type === 'widgets') resourceIds.add('widget:' + item.id);
      if (type === 'missions') resourceIds.add('mission:' + item.id);
    });
  });
  const usedEntries = entries.filter(entry => assetKeys(entry).some(key => references.has(key)));
  usedEntries.forEach(entry => assetKeys(entry).forEach(key => references.add(key)));
  // External glTF/OBJ/FBX files can use sibling textures/buffers through their
  // loader's import batch. Keep those dependencies, without including unrelated
  // model files from that batch or instantiating their meshes.
  const dependencyBatches = new Set(usedEntries.filter(entry => entry.batchId && ['gltf', 'obj', 'fbx'].includes(String(entry.extension || '').toLowerCase())).map(entry => entry.batchId));
  entries.filter(entry => dependencyBatches.has(entry.batchId) && entry.kind !== 'model' && entry.kind !== 'source').forEach(entry => assetKeys(entry).forEach(key => references.add(key)));
  return {roomId, references, resourceIds};
}

function includes(scope, resource) {
  if (!scope || !resource) return true;
  // The level inventory remains a navigation route for every level, even while
  // the file view is restricted to the active scene.
  if (resource.kind === 'scene') return true;
  if (scope.resourceIds.has(resource.id) || scope.references.has(resource.id)) return true;
  if (resource.asset) return assetKeys(resource.asset).some(key => scope.references.has(key));
  return Boolean(resource.technicalName && scope.references.has(resource.technicalName));
}

module.exports = {index, includes};
