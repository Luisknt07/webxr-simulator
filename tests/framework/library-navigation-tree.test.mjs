import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),catalog=require('../../modules/logistica-industrial/contracts/resourceCatalog.js'),taxonomy=catalog.libraryTaxonomy;
const resources=taxonomy.decorate(catalog.RESOURCES),flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children)]),leaves=nodes=>flatten(nodes).filter(node=>node.path);

test('navigation preserves every existing subgroup path and introduces only presentation branches',()=>{
 const identities=new Set();
 for(const group of taxonomy.GROUPS){
  const tree=taxonomy.navigationTree(group.id),nodes=flatten(tree),expected=group.children.map(([id])=>'group:'+group.id+'/'+id);
  assert.deepEqual(new Set(leaves(tree).map(node=>node.path)),new Set(expected),group.id);assert.equal(leaves(tree).length,expected.length);
  for(const node of nodes){assert(!identities.has(node.id),node.id);identities.add(node.id);assert(node.label&&Array.isArray(node.children));assert(!node.action&&!node.resourceId&&!node.model);
   if(node.path){assert.equal(node.id,node.path);assert.equal(node.children.length,0);assert(taxonomy.title(node.path));}
   else{assert(node.id.startsWith('branch:'+group.id+'/'));assert(node.children.length>1);}
  }
 }
 assert.deepEqual(taxonomy.navigationTree('unknown'),[]);
});

test('transport tree separates continuous conveyors, transfer equipment and special transport mechanisms',()=>{
 const tree=taxonomy.navigationTree('TR'),get=id=>tree.find(node=>node.id==='branch:TR/'+id),paths=node=>leaves(node.children).map(child=>child.path);
 assert.deepEqual(paths(get('continuous')),['straight','curved','inclined','accumulation'].map(id=>'group:TR/'+id));
 assert.deepEqual(paths(get('transfers')),['transfer','elevator','loading','guides'].map(id=>'group:TR/'+id));
 assert.deepEqual(paths(get('mechanisms')),['overhead','spiral','vibratory','screw','bucket','pneumatic'].map(id=>'group:TR/'+id));
 assert(tree.some(node=>node.path==='group:TR/diverter'),'Sorting remains directly discoverable.');
 assert(flatten(tree).every(node=>node.label.length<=25),'Transport labels fit a narrow tree without losing the full category name in metadata.');
 const byId=new Map(resources.map(resource=>[resource.id,resource]));
 for(const[id,path]of [['catalogue:equipment.transport.curve','group:TR/curved'],['catalogue:equipment.transport.screw','group:TR/screw'],['catalogue:equipment.transport.bucket-elevator','group:TR/bucket'],['library:conveyor.incline','group:TR/inclined']])assert(taxonomy.matchesPath(byId.get(id),path));
});

test('storage branches organize distinct mechanisms without merging their filters or native model families',()=>{
 const tree=taxonomy.navigationTree('AL'),automatic=tree.find(node=>node.id==='branch:AL/automatic-storage');
 assert.deepEqual(leaves(automatic.children).map(node=>node.path),['shuttle','pallet-asrs','miniload','cube','vertical-lift','carousel'].map(id=>'group:AL/'+id));
 const rackTree=tree.find(node=>node.id==='branch:AL/pallet-racks');assert(rackTree.children.some(node=>node.path==='group:AL/cantilever'));assert(rackTree.children.some(node=>node.path==='group:AL/compact'));
 const ids=['drive-in','drive-through','push-back','pallet-flow','miniload','pallet-asrs'].map(id=>catalog.resourceFamilies.familyFor(resources.find(resource=>resource.id==='catalogue:equipment.storage.'+id)).id);assert.equal(new Set(ids).size,ids.length);
});

test('filtered branches prune empty leaves and count unique resource identities across descendant filters',()=>{
 const subset=['catalogue:equipment.transport.flat-belt','catalogue:equipment.transport.curve','catalogue:equipment.transport.screw'].map(id=>resources.find(resource=>resource.id===id));
 const tree=taxonomy.navigationTree('TR',[...subset,subset[0]]);assert.equal(tree.length,2);assert.deepEqual(tree.map(node=>node.count),[2,1]);
 assert.deepEqual(leaves(tree).map(node=>node.path),['group:TR/straight','group:TR/curved','group:TR/screw']);assert(leaves(tree).every(node=>node.count===1));
 assert.deepEqual(taxonomy.navigationTree('TR',[]),[]);assert.deepEqual(taxonomy.navigationTree('AL',subset),[]);
 for(const group of taxonomy.GROUPS){const counted=taxonomy.navigationTree(group.id,resources);for(const node of flatten(counted)){const paths=node.path?[node.path]:leaves(node.children).map(leaf=>leaf.path),expected=new Set(resources.filter(resource=>paths.some(path=>taxonomy.matchesPath(resource,path))).map(resource=>resource.id)).size;assert.equal(node.count,expected,node.id);assert(expected>0);}}
});

test('tree navigation covers all library resources and conceptual documentation without changing any IDs',()=>{
 const before=JSON.stringify(resources),allLeaves=taxonomy.GROUPS.flatMap(group=>leaves(taxonomy.navigationTree(group.id))),concepts=taxonomy.pendingResources([]);
 assert.equal(resources.length,345);assert.equal(concepts.length,198);
 for(const resource of resources.concat(concepts))assert(allLeaves.some(node=>taxonomy.matchesPath(resource,node.path)),resource.id);
 assert.equal(catalog.resourceFamilies.listFamilies(resources).length+resources.filter(resource=>!catalog.resourceFamilies.familyFor(resource)).length,273);
 const edited=taxonomy.navigationTree('TR');edited[0].children[0].label='Changed';assert.notEqual(taxonomy.navigationTree('TR')[0].children[0].label,'Changed','Consumers receive independent presentation nodes.');
 assert.equal(JSON.stringify(resources),before);
});
