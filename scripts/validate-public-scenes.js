'use strict';
// Dependency-free validation of the versioned projections tested with the
// versioned bundles. CI never recompiles or regenerates release content.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {SCENES, project: safeProjection} = require('../shared/public-scenes'), {ROOM_IDS} = require('../shared/studio-document');
const {validateDocument} = require('../server/validation');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validate(root = path.resolve(__dirname, '..')) {
  const directory = path.join(root, 'assets/public-scenes'), catalogBytes = fs.readFileSync(path.join(directory, 'catalog.json')), catalog = JSON.parse(catalogBytes);
  assert(Array.isArray(catalog.scenes) && catalog.scenes.length > 0 && catalog.scenes.length <= 64, 'Invalid included-example catalog.');
  const source = fs.readFileSync(path.join(root, 'src/editor/StudySceneCatalog.js'), 'utf8').replace(/^export /gm, '');
  const definitions = new Function(source + '\nreturn STUDY_SCENES;')();
  const templateId = id => id === 'lab-transfer-l' ? 'l-transfer' : id === 'lab-sorting' ? 'inspection-sorting' : id;
  const expected = catalog.previewAllExamples ? definitions.map(scene => templateId(scene.id)).concat('industrial-lab-complete', ROOM_IDS.map(id => 'original-' + id)) : SCENES.map(scene => scene.id);
  assert.deepEqual(catalog.scenes.map(scene => scene.id).slice().sort(), expected.slice().sort(), 'Publication must contain exactly the current included recipes or the two restricted examples.');
  assert.equal(new Set(catalog.scenes.map(scene => scene.id)).size, catalog.scenes.length);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['catalog.json', ...expected.map(id => id + '.json')].sort(), 'Only declared example JSON may enter the publication.');
  const projections = {};
  for (const scene of catalog.scenes) {
    assert(/^[a-z0-9-]{1,80}$/.test(scene.id) && ROOM_IDS.includes(scene.roomId));
    const bytes = fs.readFileSync(path.join(directory, scene.id + '.json')), value = JSON.parse(bytes), project = value.project;
    assert(project && project.publicSceneId === scene.id && project.id === 'public-' + scene.id);
    assert.deepEqual(project.allowedRoomIds, [scene.roomId]); assert.equal(project.access.role, 'public'); assert.equal(project.access.canEdit, false); assert.equal(project.access.canShare, false);
    assert.deepEqual(project, safeProjection(project.document, scene), 'Unexpected metadata, private overrides, or imports: ' + scene.id);
    validateDocument(project.document, () => {throw new Error('Public examples cannot resolve server imports.');});
    if (scene.templateId) assert(definitions.some(definition => definition.id === scene.templateId && templateId(definition.id) === scene.id));
    if (scene.original) {assert.equal(scene.id, 'original-' + scene.roomId); assert.equal(project.document.rooms[scene.roomId].additions.length, 0); assert.equal(project.document.rooms[scene.roomId].overrides.length, 0);}
    projections[scene.id] = hash(bytes);
  }
  return {scenes: catalog.scenes.length, previewAllExamples: catalog.previewAllExamples === true, catalogSha256: hash(catalogBytes), projectionSha256: projections};
}
if (require.main === module) {const result = validate(); console.log('Versioned public examples: ' + result.scenes + ' safe read-only projections validated without npm dependencies; catalog SHA256 ' + result.catalogSha256);}
module.exports = {validate};
