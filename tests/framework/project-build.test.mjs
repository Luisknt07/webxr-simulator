import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildProject, selectedAssetPlan, validateCompilationClosure} from '../../tooling/build/project.mjs';
import {panelModel} from '../../apps/project-viewer/models.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('real browser builds include only each sector selection and its declared dependencies', () => {
  for (const [sector, expected, prefixes] of [
    ['agricultura',['agriculture.harvest','logistics.storage'],['modules/agricultura/functions/cosecha/','modules/logistica-industrial/functions/almacenamiento/']],
    ['turismo',['tourism.routes'],['modules/turismo/functions/recorridos/']],
    ['educacion',['education.assessment'],['modules/educacion/functions/evaluacion/']],
    ['alimentos',['food.traceability','logistics.storage'],['modules/alimentos/functions/trazabilidad/','modules/logistica-industrial/functions/almacenamiento/']]
  ]) {
    const result = buildProject({root, projectPath: `projects/${sector}/project.json`, name: 'proof-' + sector});
    assert.deepEqual(result.functions.sort(), expected.sort());
    const sectorFiles = result.graph.filter(file => file.startsWith('modules/'));
    assert(sectorFiles.length); assert(sectorFiles.every(file => prefixes.some(prefix => file.startsWith(prefix))));
    assert(!result.graph.some(file => /apps\/workspace|packages\/tools|IndustrialPrefabs|SceneEditor|SimulationRuntime|modules\/catalog/.test(file)));
    const manifest = JSON.parse(fs.readFileSync(path.join(result.output, 'publication.json')));
    assert.equal(manifest.referenceScene, true); assert.equal(manifest.statePersistence, 'memory');
    assert.deepEqual(manifest.files.map(file => file.path).sort(), ['index.html','project.js','viewer.css']);
    for (const file of manifest.files) {const bytes = fs.readFileSync(path.join(result.output, file.path)); assert.equal(bytes.length, file.size); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);}
    fs.mkdirSync(path.join(root, 'data/qa-modular'), {recursive: true});
    fs.writeFileSync(path.join(root, `data/qa-modular/project-build-${sector}.json`), JSON.stringify(result, null, 2));
  }
});

test('project publications reject unsafe media paths, foreign dependencies and names', () => {
  for (const asset of ['../../secret.json','private/token.json','script.js','server/key.json','https://example.com/a.png','.secret.json']) {
    assert.throws(() => selectedAssetPlan(root, [{id:'test.function',packageDirectory:'modules/agricultura/functions/cosecha',metadata:{assets:[asset]}}]), {code:'project_assets'});
  }
  assert.throws(() => validateCompilationClosure({root,generated:{output:path.join(root,'data/build/test')},functions:[],stats:{modules:[{identifier:path.join(root,'modules/turismo/functions/recorridos/index.js')}]}}), {code:'project_dependency'});
  assert.throws(() => buildProject({root,projectPath:'projects/agricultura/project.json',name:'../workspace'}), {code:'project_name'});
});

test('declarative panels never dispatch another function or interpret action code', () => {
  const commands = [{functionId:'agriculture.harvest',key:'agriculture.harvest:record'},{functionId:'logistics.storage',key:'logistics.storage:transaction'}];
  const model = panelModel({kind:'form',title:'<img src=x onerror=alert(1)>',actions:['record','logistics.storage:transaction','../transaction','record','(()=>evil())']}, 'agriculture.harvest', commands);
  assert.deepEqual(model.actions, ['record']); assert.equal(model.title, '<img src=x onerror=alert(1)>');
  assert.deepEqual(panelModel({kind:'execute-js',actions:['record']},'agriculture.harvest',commands).actions, []);
});

test('a project host resolving after browser disposal is immediately retired', async () => {
  const THREE = createRequire(import.meta.url)('three'); let cleanup, resolveHost, disposed = 0;
  const browser = {context:{scene:new THREE.Scene()},onDispose(callback){cleanup=callback;},async dispose(){await cleanup();}};
  const source = fs.readFileSync(path.join(root,'apps/project-viewer/boot.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const mount = new Function('THREE','createBrowserHost','renderPanel','document','window',source+'\nreturn mountProject;')(THREE,()=>browser,()=>{}, {getElementById:()=>({})}, {});
  const loading = mount({createComposedHost:()=>new Promise(resolve=>{resolveHost=resolve;}),project:{}});
  await browser.dispose();
  resolveHost({async dispose(options){assert.equal(options.force,true);disposed++;}});
  assert.equal(await loading,null);assert.equal(disposed,1,'Late module resources must not outlive their disposed browser host.');
});
