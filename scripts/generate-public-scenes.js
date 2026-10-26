'use strict';
const fs = require('node:fs'), path = require('node:path');
const {SCENES, project} = require('../shared/public-scenes');

function generate(root = path.resolve(__dirname, '..')) {
  // A committed example is the only input. Runtime SQLite/user folders are
  // deliberately never read by the public static publishing step.
  const document = JSON.parse(fs.readFileSync(path.join(root, 'examples/industrial-study-fundamentals.json'), 'utf8'));
  const directory = path.join(root, 'assets/public-scenes'); fs.mkdirSync(directory, {recursive: true});
  const scenes = SCENES.map(scene => Object.assign({}, scene, {projectId: 'public-' + scene.id, revision: 1, public: true}));
  fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify({scenes, maxActive: 2, requiresLogin: true}) + '\n');
  for (const scene of SCENES) fs.writeFileSync(path.join(directory, scene.id + '.json'), JSON.stringify({project: project(document, scene)}) + '\n');
  return scenes;
}
if (require.main === module) console.log('Escenas públicas estáticas: ' + generate().length + ' proyecciones sin archivos de usuario.');
module.exports = generate;
