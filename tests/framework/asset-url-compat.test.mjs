import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=fs.readFileSync(path.join(root,'packages/tools/editor/src/AssetLibrary.js'),'utf8');
// Exercise the actual dependency-free resolver functions without constructing a
// renderer or substituting a second implementation of the mapping.
const helpers=source.slice(source.indexOf('function normalizedPath'),source.indexOf('function urlFor'));
const {assetURL,storedAssetURL}=new Function(helpers+';return {assetURL,storedAssetURL};')();
test('old logical/assets paths and raw canonical paths retain their module ownership and private mount',()=>{
  const rows=[['hall.glb','modules/turismo/assets/hall.glb'],['assets/hall.glb','modules/turismo/assets/hall.glb'],['blender/hall.blend','modules/logistica-industrial/assets/blender/hall.blend'],['assets/materials/pbr/wood-normal-256.jpg','modules/logistica-industrial/assets/materials/pbr/wood-normal-256.jpg'],['assets/editor-previews/hall.png','packages/tools/editor/assets/previews/hall.png'],['assets/ai/model.onnx','packages/tools/ai/assets/model.onnx'],['assets/scene-thumbnails/l-transfer.png','projects/smarttwin/previews/l-transfer.png'],['modules/turismo/assets/hall.glb','modules/turismo/assets/hall.glb']];
  for(const[input,expected]of rows){assert.equal(assetURL(input),expected);assert.equal(new URL(assetURL(input),'https://example.invalid/workspace/').pathname,'/workspace/'+expected);}
  assert.equal(assetURL('some dir/model.glb'),'modules/turismo/assets/some%20dir/model.glb');
});
test('every real catalog entry resolves to the same existing bytes through old and canonical forms',()=>{
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'packages/tools/editor/assets/catalog.json')));assert.ok(catalog.length>90);
  for(const entry of catalog){const actual=assetURL(entry.path);assert.equal(assetURL('assets/'+entry.path),actual);assert.equal(assetURL(decodeURIComponent(actual)),actual);assert.equal(fs.statSync(path.join(root,decodeURIComponent(actual))).size,entry.size,entry.path);if(entry.thumbnailPath)assert.ok(fs.statSync(path.join(root,decodeURIComponent(assetURL(entry.thumbnailPath)))).isFile());}
});
test('builtin paths never become external fetches and stored imports stay exact same-origin content hashes',()=>{
  for(const input of ['https://external.invalid/a.glb','//external.invalid/a.glb','file:///private.glb','data:image/png;base64,eA==','javascript:alert(1)'])assert.throws(()=>assetURL(input),/ruta local/);
  const reference='/api/assets/'+'a'.repeat(64);assert.equal(storedAssetURL(reference),reference);for(const input of ['assets/hall.glb','https://external.invalid'+reference,reference+'?redirect=1','/api/assets/../projects'])assert.throws(()=>storedAssetURL(input),/referencia/);
});
