'use strict';

// Parametric storage geometry only. Layout/custody lives in warehouseRacks and
// PalletQueueRuntime. THREE is explicit for browser and headless authoring.
const racks = require('./warehouseRacks');
const FLOOR = -1;
const ROLES = {
  frame: ['Bastidores de estantería', '#346483', .55, .56],
  beam: ['Largueros y brazos pintados', '#d88335', .3, .58],
  steel: ['Acero de guías y rodillos', '#a4b1b5', .82, .4],
  deck: ['Entrepaños y bandejas metálicas', '#8e9b9e', .55, .65],
  guard: ['Protecciones de seguridad', '#c5aa3f', .18, .7],
  dark: ['Carriles y mecanismos', '#35454d', .55, .68],
  label: ['Placas de ubicación', '#162d38', .12, .76],
  ink: ['Códigos de ubicación', '#f2f6ee', 0, 1]
};
const color = (config, role) => role === 'frame' ? config.rackFrameColor || ROLES[role][1] : role === 'beam' ? config.rackBeamColor || ROLES[role][1] : ROLES[role][1];
const position = (cell, closed) => (closed && cell.closedPosition || cell.position || [cell.x, cell.y, cell.z]).slice();
const key = value => Math.round(value * 1e6) / 1e6;
const distinct = values => Array.from(new Set(values.map(key))).sort((a, b) => a - b);
// A tiny procedural glyph sheet works in the browser and during headless
// authoring. All address plates share one atlas rather than a canvas per slot.
const GLYPH_ORDER = Array.from({length:95},(_,i)=>String.fromCharCode(i+32)).join('');
const GLYPH_TEXTURES = new WeakMap();
const GLYPHS = {
  A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/10101/01010',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',
  '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00010/00100/01000/11111','3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110','6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110','-':'00000/00000/00000/11111/00000/00000/00000','/':'00001/00010/00010/00100/01000/01000/10000',':':'00000/00100/00100/00000/00100/00100/00000','.':'00000/00000/00000/00000/00000/00110/00110'
};
Object.assign(GLYPHS,{
  a:'00000/00000/01110/00001/01111/10001/01111',b:'10000/10000/10110/11001/10001/10001/11110',c:'00000/00000/01111/10000/10000/10000/01111',d:'00001/00001/01101/10011/10001/10001/01111',e:'00000/00000/01110/10001/11111/10000/01111',f:'00110/01001/01000/11100/01000/01000/01000',g:'00000/01111/10001/10001/01111/00001/11110',h:'10000/10000/10110/11001/10001/10001/10001',i:'00100/00000/01100/00100/00100/00100/01110',j:'00010/00000/00110/00010/00010/10010/01100',k:'10000/10000/10010/10100/11000/10100/10010',l:'01100/00100/00100/00100/00100/00100/01110',m:'00000/00000/11010/10101/10101/10101/10101',n:'00000/00000/10110/11001/10001/10001/10001',o:'00000/00000/01110/10001/10001/10001/01110',p:'00000/11110/10001/10001/11110/10000/10000',q:'00000/01111/10001/10001/01111/00001/00001',r:'00000/00000/10111/11000/10000/10000/10000',s:'00000/00000/01111/10000/01110/00001/11110',t:'01000/01000/11100/01000/01000/01001/00110',u:'00000/00000/10001/10001/10001/10011/01101',v:'00000/00000/10001/10001/10001/01010/00100',w:'00000/00000/10001/10001/10101/10101/01010',x:'00000/00000/10001/01010/00100/01010/10001',y:'00000/10001/10001/10001/01111/00001/11110',z:'00000/00000/11111/00010/00100/01000/11111',
  '_':'00000/00000/00000/00000/00000/00000/11111','?':'01110/10001/00001/00010/00100/00000/00100','!':'00100/00100/00100/00100/00100/00000/00100','+':'00000/00100/00100/11111/00100/00100/00000','=':'00000/00000/11111/00000/11111/00000/00000','(':'00010/00100/01000/01000/01000/00100/00010',')':'01000/00100/00010/00010/00010/00100/01000','[':'01110/01000/01000/01000/01000/01000/01110',']':'01110/00010/00010/00010/00010/00010/01110','<':'00001/00010/00100/01000/00100/00010/00001','>':'10000/01000/00100/00010/00100/01000/10000','|':'00100/00100/00100/00100/00100/00100/00100','#':'01010/01010/11111/01010/11111/01010/01010','%':'11001/11010/00100/00100/01000/10110/00110','*':'00000/10101/01110/11111/01110/10101/00000',',':'00000/00000/00000/00000/00110/00100/01000',';':'00000/00110/00110/00000/00110/00100/01000','"':'01010/01010/01010/00000/00000/00000/00000',"'":'00100/00100/00100/00000/00000/00000/00000','@':'01110/10001/10111/10101/10111/10000/01110','&':'01100/10010/10100/01000/10101/10010/01101','^':'00100/01010/10001/00000/00000/00000/00000','~':'00000/00000/01001/10110/00000/00000/00000','`':'01000/00100/00010/00000/00000/00000/00000','\\':'10000/01000/01000/00100/00010/00010/00001','{':'00010/00100/00100/01000/00100/00100/00010','}':'01000/00100/00100/00010/00100/00100/01000','$':'00100/01111/10100/01110/00101/11110/00100'
});
function glyphTexture(THREE) {
  const shared=GLYPH_TEXTURES.get(THREE);if(shared)return shared.texture;
  const width = 256, height = 128, pixels = new Uint8Array(width * height * 4);
  // The unused space tile is opaque white for vertex-tinted plate backgrounds.
  for (let y=0;y<16;y++)for(let x=0;x<16;x++){const at=(y*width+x)*4;pixels[at]=pixels[at+1]=pixels[at+2]=pixels[at+3]=255;}
  [...GLYPH_ORDER].forEach((glyph, index) => (GLYPHS[glyph] || '').split('/').forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit !== '1') return;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const at = (((Math.floor(index / 16) * 16 + 1 + (6 - y) * 2 + dy) * width) + index % 16 * 16 + 3 + x * 2 + dx) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = pixels[at + 3] = 255;
    }
  })));
  let map;
  const canvas=typeof document!=='undefined'&&document.createElement?document.createElement('canvas'):null,ctx=canvas&&canvas.getContext&&canvas.getContext('2d');
  if(ctx){canvas.width=width;canvas.height=height;ctx.clearRect(0,0,width,height);ctx.fillStyle='#fff';ctx.fillRect(0,height-16,16,16);ctx.font='13px monospace';ctx.textAlign='center';ctx.textBaseline='middle';[...GLYPH_ORDER].forEach((char,index)=>{if(index)ctx.fillText(char,index%16*16+8,height-Math.floor(index/16)*16-8);});map=new THREE.CanvasTexture(canvas);}
  else map = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipMapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
  const entry={texture:map,refs:0,disposed:false},nativeDispose=map.dispose;GLYPH_TEXTURES.set(THREE,entry);
  // Ownership follows each ink material, not a parent's Set of textures: one
  // pallet placard can contain several independently-created label materials.
  // Generic geometry/thumbnail cleanup may call texture.dispose() directly;
  // that request must never invalidate the atlas of another live material.
  Object.defineProperties(map,{
    warehouseRackSharedAtlas:{value:true},
    warehouseRackGlyphOwners:{get:()=>entry.refs},
    warehouseRackAcquireLease:{value:()=>{
      if(entry.disposed)throw new Error('Cannot lease a disposed rack glyph atlas.');
      entry.refs++;let released=false;
      return ()=>{if(released)return;released=true;if(--entry.refs===0){if(GLYPH_TEXTURES.get(THREE)===entry)GLYPH_TEXTURES.delete(THREE);map.dispose();}};
    }},
    dispose:{value:function(){if(entry.refs||entry.disposed)return;entry.disposed=true;nativeDispose.call(map);}}
  });
  map.name = 'Identificación logística: atlas de códigos'; return map;
}

function ownGlyphMaterial(THREE,material) {
  if(!material.map||!material.map.warehouseRackSharedAtlas||material.warehouseRackGlyphLease)return material;
  const release=material.map.warehouseRackAcquireLease(),nativeClone=material.clone;
  Object.defineProperties(material,{
    warehouseRackGlyphLease:{value:true},
    clone:{value:function(){
      const copy=nativeClone.call(this);
      // Appearance clones retain their own lease even after their source
      // material/rack disappears. Cloning a previously-disposed source gets
      // the current atlas instead of reviving its retired ownership entry.
      if(copy.map&&copy.map.warehouseRackSharedAtlas){copy.map=glyphTexture(THREE);ownGlyphMaterial(THREE,copy);}
      return copy;
    }}
  });
  material.addEventListener('dispose',release);return material;
}

function bounds(cells, closed) {
  const b = {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity};
  cells.forEach(cell => {
    const p = position(cell, closed), w = cell.width || 1.2, d = cell.depth || .8;
    b.minX = Math.min(b.minX, p[0] - w / 2); b.maxX = Math.max(b.maxX, p[0] + w / 2);
    b.minZ = Math.min(b.minZ, p[2] - d / 2); b.maxZ = Math.max(b.maxZ, p[2] + d / 2);
    b.minY = Math.min(b.minY, p[1]); b.maxY = Math.max(b.maxY, p[1] + (cell.clearHeight || 1));
  });
  if (!cells.length) return {minX: -1, maxX: 1, minZ: -.6, maxZ: .6, minY: -.75, maxY: 2};
  return b;
}

function createBuilder(THREE, config) {
  const unitBox = new THREE.BoxBufferGeometry(1, 1, 1), unitPlane = new THREE.PlaneBufferGeometry(1, 1), cylinders = new Map(), profiles = new Map(), banks = new Map(), materials = new Map(), motionBanks = [], textures = new Map();
  const detail = {profiles: 0, bolts: 0, connectionPlates: 0, labels: 0, slotsLabeled: 0, textureBytes: 0};
  const texture = kind => {
    if (!textures.has(kind)) {
      let map;
      if (kind === 'ink') map = glyphTexture(THREE);
      else {
        const size = 64, pixels = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const at = (y * size + x) * 4, seed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
          const value = kind === 'steel' ? 219 + seed % 29 + Math.round(4 * Math.sin((x + y * .4) * .7)) : 239 + seed % 15;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = value; pixels[at + 3] = 255;
        }
        map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat); map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipMapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
        map.name = kind === 'steel' ? 'Acero galvanizado: grano y abrasión fina' : 'Pintura industrial: microtextura';
      }
      textures.set(kind, map); detail.textureBytes += (map.image.data?map.image.data.byteLength:map.image.width*map.image.height*4) * 4 / 3;
    }
    return textures.get(kind);
  };
  const unit = (radius, segments) => {
    const k = segments || 8; if (!cylinders.has(k)) cylinders.set(k, new THREE.CylinderBufferGeometry(1, 1, 1, k));
    return cylinders.get(k);
  };
  const material = role => {
    if (!materials.has(role)) {
      const entry = ROLES[role], m = role === 'ink' ? new THREE.MeshBasicMaterial({color: '#ffffff', map: texture('ink'), alphaTest: .4, depthWrite: true, vertexColors:THREE.VertexColors}) : new THREE.MeshStandardMaterial({color: color(config, role), metalness: entry[2], roughness: entry[3]});
      if(role==='ink')ownGlyphMaterial(THREE,m);
      if (!['ink', 'label'].includes(role)) {m.map = texture(role === 'steel' || role === 'deck' ? 'steel' : 'paint'); m.bumpMap = m.map; m.bumpScale = role === 'steel' ? .0008 : .00035;}
      m.color.convertSRGBToLinear(); m.name = entry[0];
      Object.assign(m.userData, {studioColorSpace: 'linear', industrialMaterialRole: role === 'steel' || role === 'deck' ? 'steel' : role === 'dark' ? 'metal' : 'frame'});
      materials.set(role, m);
    }
    return materials.get(role);
  };
  const append = (parent, role, geometry, p, size, quaternion, mover, uvRect, tint) => {
    if (size.some(v => !Number.isFinite(v) || v <= 0)) return;
    if (!banks.has(parent)) banks.set(parent, new Map());
    const groups = banks.get(parent); if (!groups.has(role)) groups.set(role, {p: [], n: [], uv: [], c:[], i: [], motions: []});
    const batch = groups.get(role), matrix = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(p), quaternion || new THREE.Quaternion(), new THREE.Vector3().fromArray(size));
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix), vertex = new THREE.Vector3(), normal = new THREE.Vector3(), start = batch.p.length / 3;
    const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix); normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      batch.p.push(vertex.x, vertex.y, vertex.z); batch.n.push(normal.x, normal.y, normal.z);
      batch.c.push(tint?tint.r:1,tint?tint.g:1,tint?tint.b:1);
      batch.uv.push(uvRect ? uvRect[0] + uv.getX(i) * uvRect[2] : uv.getX(i), uvRect ? uvRect[1] + uv.getY(i) * uvRect[3] : uv.getY(i));
    }
    const index = geometry.index, count = index ? index.count : positions.count;
    for (let i = 0; i < count; i++) batch.i.push(start + (index ? index.getX(i) : i));
    if (mover) batch.motions.push({object: mover, start, count: positions.count, home: mover.position.clone()});
  };
  const box = (parent, role, p, size, q, mover) => append(parent, role, unitBox, p, size, q, mover);
  // Folded C sections have a real web and flanges; the open face and returns
  // remain visible at close range without a mesh/material per steel member.
  const profile = (parent, role, p, size, axis = 'x') => {
    const [w,h,d]=size,t=Math.min(.008,Math.min(w,h,d)*.16),id=axis+':'+size.join(':');detail.profiles++;
    if(!profiles.has(id)){
      let points,depth,q=new THREE.Quaternion();
      if(axis==='y'){
        points=[[-w/2,d/2],[w/2,d/2],[w/2,-d/2],[w*.14,-d/2],[w*.14,-d/2+t],[w/2-t,-d/2+t],[w/2-t,d/2-t],[-w/2+t,d/2-t],[-w/2+t,-d/2+t],[-w*.14,-d/2+t],[-w*.14,-d/2],[-w/2,-d/2]];depth=h;q.setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
      }else if(axis==='z'){
        points=[[-w/2,-h/2],[w/2,-h/2],[w/2,-h/2+t],[-w/2+t,-h/2+t],[-w/2+t,h/2-t],[w/2,h/2-t],[w/2,h/2],[-w/2,h/2]];depth=d;
      }else{
        points=[[d/2,-h/2],[-d/2,-h/2],[-d/2,-h/2+t],[d/2-t,-h/2+t],[d/2-t,h/2-t],[-d/2,h/2-t],[-d/2,h/2],[d/2,h/2]];depth=w;q.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2);
      }
      const shape=new THREE.Shape(points.map(point=>new THREE.Vector2().fromArray(point))),geometry=new THREE.ExtrudeBufferGeometry(shape,{depth,steps:1,bevelEnabled:false});geometry.translate(0,0,-depth/2);profiles.set(id,{geometry,q});
    }
    const item=profiles.get(id);append(parent,role,item.geometry,p,[1,1,1],item.q);
  };
  const bolt = (parent, p, radius = .012, axis = 'z') => {
    const q = axis === 'z' ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2) : new THREE.Quaternion();
    append(parent, 'steel', unit(radius, 6), p, [radius, .012, radius], q); detail.bolts++;
  };
  const plate = (parent, p, size = [.1, .16, .012]) => {
    box(parent, 'steel', p, size); detail.connectionPlates++;
    for (const sign of [-1, 1]) bolt(parent, [p[0], p[1] + sign * size[1] * .29, p[2] + size[2] / 2 + .004]);
  };
  const label = (parent, text, p, width, height, reverse = false) => {
    text = String(text || '').replace(/[^\x20-\x7e]/g, '?'); if (!text) return;
    const q = reverse ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) : undefined;
    append(parent,'ink',unitPlane,p,[width,height,1],q,undefined,[0,0,1/16,1/8],new THREE.Color('#162d38').convertSRGBToLinear());
    const charWidth = Math.min((width - .012) / text.length, height * .62), glyphHeight = Math.min(height * .82, charWidth * 1.4), direction = reverse ? -1 : 1;
    [...text].forEach((char, index) => {
      const glyph = GLYPH_ORDER.indexOf(char); if (glyph < 0 || char === ' ') return;
      const x = p[0] + direction * ((index - (text.length - 1) / 2) * charWidth);
      append(parent, 'ink', unitPlane, [x, p[1], p[2] + direction * .003], [charWidth, glyphHeight, 1], q, undefined, [(glyph % 16) / 16, Math.floor(glyph / 16) / 8, 1 / 16, 1 / 8]);
    }); detail.labels++;
  };
  const rod = (parent, role, a, b, radius) => {
    const p = new THREE.Vector3().fromArray(a), end = new THREE.Vector3().fromArray(b), direction = end.clone().sub(p), length = direction.length();
    if (length < .0001) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    append(parent, role, unit(radius, 6), p.add(end).multiplyScalar(.5).toArray(), [radius, length, radius], q);
  };
  const roller = (parent, p, length, radius = .035) => append(parent, 'steel', unit(radius, 8), p, [radius, length, radius], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
  const finish = () => {
    banks.forEach((roles, parent) => roles.forEach((b, role) => {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      if(role==='ink')geometry.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));
      geometry.setIndex(b.i); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material(role)); mesh.name = ROLES[role][0]; mesh.castShadow = mesh.receiveShadow = true;
      Object.assign(mesh.userData, {warehouseRackStructure: true, industrialMaterialPart: role, materialPart: role, materialPartLabel: ROLES[role][0], industrialMaterialRole: role === 'steel' || role === 'deck' ? 'steel' : 'frame'});
      if (role === 'label' || role === 'ink') Object.assign(mesh.userData, {warehouseRackLocationLabels: true, editorNonCollidable: true});
      parent.add(mesh);
      if (b.motions.length) motionBanks.push({geometry, rest: geometry.attributes.position.array.slice(), motions: b.motions, previous: ''});
    }));
    unitBox.dispose(); unitPlane.dispose(); cylinders.forEach(g => g.dispose()); profiles.forEach(p=>p.geometry.dispose());
  };
  const syncMotion = () => {
    motionBanks.forEach(bank => {
      const signature = bank.motions.map(m => m.object.position.toArray().join(',')).join('|'); if (signature === bank.previous) return; bank.previous = signature;
      const a = bank.geometry.attributes.position.array;
      bank.motions.forEach(m => {const d = m.object.position.clone().sub(m.home); for (let i = m.start; i < m.start + m.count; i++) {a[i * 3] = bank.rest[i * 3] + d.x; a[i * 3 + 1] = bank.rest[i * 3 + 1] + d.y; a[i * 3 + 2] = bank.rest[i * 3 + 2] + d.z;}});
      bank.geometry.attributes.position.needsUpdate = true; bank.geometry.computeBoundingBox(); bank.geometry.computeBoundingSphere();
    });
  };
  return {box, rod, roller, profile, bolt, plate, label, finish, syncMotion, detail};
}

function group(THREE, parent, name) { const g = new THREE.Group(); g.name = name; parent.add(g); return g; }
function support(b, parent, cell, closed, mode, config) {
  const p = position(cell, closed), w = cell.width, d = cell.depth, top = p[1];
  if (mode === 'shelf') {
    b.box(parent, 'deck', [p[0], top - .018, p[2]], [w + .025, .036, d + .025]);
    for (const z of [-1, 1]) b.box(parent, 'beam', [p[0], top - .065, p[2] + z * d * .44], [w + .04, .09, .045]);
  } else if (mode === 'rail') {
    for (const x of [-1, 1]) {
      b.box(parent, 'steel', [p[0] + x * w * .41, top - .04, p[2]], [.1, .08, d + .06]);
      b.box(parent, 'beam', [p[0] + x * w * .46, top - .12, p[2]], [.06, .1, d + .06]);
    }
  } else if (mode === 'roller') {
    // Three broad rollers per load position retain a real open support plane
    // without a mesh per roller or a solid collision slab through the pallet.
    for (const fraction of [-.36, 0, .36]) b.roller(parent, [p[0], top - .035, p[2] + d * fraction], Math.max(.2, w - .1));
    for (const x of [-1, 1]) b.box(parent, 'beam', [p[0] + x * (w / 2 + .025), top - .07, p[2]], [.045, .12, d + .08]);
  } else {
    for (const z of [-1, 1]) b.box(parent, 'beam', [p[0], top - .065, p[2] + z * d * .34], [w + .05, .13, .11]);
  }
}

function frame(THREE, b, parent, cells, config, options = {}) {
  const closed = !!options.closed, a = bounds(cells, closed), top = a.maxY + .12, thickness = options.light ? .055 : .085;
  const byBay = new Map();
  cells.forEach(cell => {const id = cell.bay || 0; if (!byBay.has(id)) byBay.set(id, []); byBay.get(id).push(cell);});
  const frames = Array.from(byBay.values()).map(rows => {const r = bounds(rows, closed); return {rows, bounds:r, left:r.minX-.08, right:r.maxX+.08};});
  const postXs = distinct(frames.reduce((values, bay) => values.concat(bay.left, bay.right), [])), postZs = [a.minZ - .075, a.maxZ + .075];
  postXs.forEach(x => postZs.forEach(z => {
    b.profile(parent, 'frame', [x, (FLOOR + top) / 2, z], [thickness, top - FLOOR, thickness], 'y');
    b.box(parent, 'steel', [x, FLOOR + .018, z], [.17, .036, .17]);
    for (const dx of [-.055,.055]) b.bolt(parent,[x+dx,FLOOR+.041,z],.009,'y');
    // Open folded guards leave the real upright visible instead of a solid block.
    b.profile(parent, 'guard', [x, FLOOR + .2, z], [.1, .36, .1], 'y');
    // Repeated fixing slots sit on the steel web. They are recessed dark marks,
    // not extra draw calls or coplanar duplicate faces on every perforation.
    for (let y = FLOOR + .48; y < top - .12; y += .24) b.box(parent,'dark',[x,y,z-thickness/2-.0008],[.014,.038,.001]);
  }));
  // Each front/back pair is one real braced frame. Bay interiors stay open.
  postXs.forEach(x => {
    for (let y = FLOOR + .35; y < top - .3; y += 1.4) {
      const y2 = Math.min(top - .15, y + 1.25);
      b.rod(parent, 'steel', [x, y, postZs[0]], [x, y2, postZs[1]], .018);
      b.rod(parent, 'steel', [x, y, postZs[1]], [x, y2, postZs[0]], .018);
    }
  });
  frames.forEach(bay => {
    const r=bay.bounds, centerX=(bay.left+bay.right)/2, span=bay.right-bay.left;
    b.profile(parent,'frame',[centerX,top-.04,postZs[0]],[span+.06,.08,thickness]);
    if(options.drive)b.profile(parent,'frame',[centerX,top-.04,postZs[1]],[span+.06,.08,thickness]);
    const seats = new Map();
    bay.rows.forEach(cell => {const id=cell.level+':'+cell.depthIndex;if(!seats.has(id))seats.set(id,[]);seats.get(id).push(cell);});
    const levels=new Map();bay.rows.forEach(cell=>{if(!levels.has(cell.level))levels.set(cell.level,[]);levels.get(cell.level).push(cell);});
    levels.forEach(rows=>{
      const sorted=rows.slice().sort((u,v)=>position(u,closed)[2]-position(v,closed)[2]),rear=position(sorted[0],closed),front=position(sorted[sorted.length-1],closed);
      const slope=front[2]===rear[2]?0:(front[1]-rear[1])/(front[2]-rear[2]);
      const heightAt=z=>rear[1]+(z-rear[2])*slope-.105;
      for(const x of [bay.left,bay.right]){
        if(Math.abs(slope)>.00001)b.rod(parent,'frame',[x,heightAt(postZs[0]),postZs[0]],[x,heightAt(postZs[1]),postZs[1]],.04);
        else b.profile(parent,'frame',[x,heightAt((postZs[0]+postZs[1])/2),(postZs[0]+postZs[1])/2],[thickness,.08,postZs[1]-postZs[0]+thickness],'z');
        for(const z of postZs)b.plate(parent,[x,heightAt(z),z+thickness/2+.004],[thickness+.025,.16,.012]);
      }
    });
    seats.forEach(rows => {
      const first=rows[0],p=position(first,closed), d=first.depth, mode=options.support||'beam';
      if(mode==='rail'){
        rows.forEach(cell=>{
          support(b,parent,cell,closed,mode,config);
          const c=position(cell,closed);
          for(const sign of [-1,1]){
            const railX=c[0]+sign*cell.width*.41, frameX=sign<0?bay.left:bay.right;
            // Brackets reach from the upright/side tie to the actual rail.
            for(const z of [-1,1])b.profile(parent,'beam',[(railX+frameX)/2,c[1]-.12,c[2]+z*(cell.depth/2+.025)],[Math.abs(railX-frameX)+.07,.1,.06]);
          }
        });
      }else{
        const fraction=mode==='shelf'?.44:.34, h=mode==='shelf'?.09:.13;
        for(const sign of [-1,1]){
          const z=p[2]+sign*d*fraction;
          // Continuous bay beams replace the former disconnected per-cell bars.
          b.profile(parent,'beam',[centerX,p[1]-h/2-(mode==='roller'?.07:0),z],[span+thickness,h,.11]);
          for(const x of [bay.left,bay.right])b.plate(parent,[x,p[1]-.095,z+.058],[.095,.18,.012]);
        }
        if(mode==='shelf')rows.forEach(cell=>{const c=position(cell,closed);b.box(parent,'deck',[c[0],c[1]-.018,c[2]],[cell.width+.025,.036,cell.depth+.025]);});
        if(mode==='roller')rows.forEach(cell=>support(b,parent,cell,closed,mode,config));
      }
      rows.forEach(cell=>{
        const c=position(cell,closed), code=cell.code||'M'+(cell.bay+1)+'-N'+(cell.level+1)+'-P'+(cell.column+1)+'-F'+(cell.depthIndex+1);
        const railX=c[0]-cell.width*.41, plateX=mode==='rail'?(railX+bay.left)/2:c[0], plateWidth=mode==='rail'?Math.max(.12,Math.min(.45,Math.abs(railX-bay.left)+.05)):Math.min(cell.width*.93,1.22);
        const z=c[2]+cell.depth*(mode==='rail'?.5:mode==='shelf'?.44:.34)+(mode==='rail'?.056:.056);
        b.label(parent,code,[plateX,c[1]-(mode==='roller'?.137:mode==='rail'?.12:.067),z],plateWidth,.065);b.detail.slotsLabeled++;
      });
    });
  });
  const header=(config.rackAisleCode||'A01')+' / '+(config.rackRowCode||'R01');
  b.label(parent,header,[frames[0].left+.14,top-.045,postZs[1]+thickness/2+.001],.36,.12);
  return a;
}

function cantilever(THREE, b, parent, cells, config) {
  const a = bounds(cells), top = a.maxY + .12, posts = distinct(cells.reduce((xs, cell) => {xs.push(cell.position[0] - cell.width * .3, cell.position[0] + cell.width * .3); return xs;}, [])), rear = a.minZ - .06;
  for (const x of posts) {
    b.profile(parent, 'frame', [x, (FLOOR + top) / 2, rear], [.11, top - FLOOR, .12], 'y');
    b.profile(parent, 'frame', [x, FLOOR + .09, (a.minZ + a.maxZ) / 2], [.16, .18, a.maxZ - a.minZ + .35], 'z');
    b.box(parent,'steel',[x,FLOOR+.018,rear],[.24,.036,.23]);for(const dx of [-.075,.075])b.bolt(parent,[x+dx,FLOOR+.041,rear],.012,'y');
    distinct(cells.map(c => c.position[1])).forEach(y => {
      b.profile(parent, 'beam', [x, y - .06, (a.minZ + a.maxZ) / 2], [.11, .12, a.maxZ - a.minZ + .1], 'z');
      b.plate(parent,[x,y-.075,rear+.066],[.15,.21,.018]);
      b.box(parent, 'guard', [x, y + .025, a.maxZ + .025], [.11, .12, .045]);
    });
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const x1 = posts[i], x2 = posts[i + 1];
    b.rod(parent, 'steel', [x1, FLOOR + .2, rear], [x2, top - .2, rear], .022);
  }
  cells.forEach(cell=>{const p=position(cell);b.label(parent,cell.code||'M'+(cell.bay+1)+'-N'+(cell.level+1),[p[0],p[1]-.035,a.maxZ+.052],Math.min(1.25,cell.width*.9),.07);b.detail.slotsLabeled++;});
  b.label(parent,(config.rackAisleCode||'A01')+' / '+(config.rackRowCode||'R01'),[(a.minX+a.maxX)/2,top-.045,rear+.071],1.2,.12);
}

function mezzanine(THREE, b, parent, cells, config, rig) {
  const a = bounds(cells), levels = distinct(cells.map(c => c.position[1])), highest = levels[levels.length - 1], width = a.maxX - a.minX + .35, depth = a.maxZ - a.minZ + .35;
  const centerX = (a.minX + a.maxX) / 2, centerZ = (a.minZ + a.maxZ) / 2, stairWidth = 1.05, run = .28, stairX = a.minX - .1 + stairWidth / 2, lastZ = a.maxZ + .17;
  const returnWidth = 1.05, returnX = stairX + stairWidth + .1, flights = [];
  for (const x of [a.minX - .1, a.maxX + .1]) for (const z of [a.minZ - .1, a.maxZ + .1]) {
    b.profile(parent, 'frame', [x, (FLOOR + highest) / 2, z], [.13, highest - FLOOR, .13], 'y');
    b.box(parent, 'steel', [x, FLOOR + .02, z], [.3, .04, .3]);
    for(const dx of [-.1,.1])b.bolt(parent,[x+dx,FLOOR+.045,z],.014,'y');
  }
  levels.forEach((top, level) => {
    const base = level ? levels[level - 1] : FLOOR, count = Math.ceil((top - base) / .18), rise = (top - base) / count, firstZ = lastZ + count * run;
    // Every authored floor has a genuine solid deck and its own stair flight.
    b.box(parent, 'deck', [centerX, top - .06, centerZ], [width, .12, depth]);
    for(const z of [a.minZ-.1,a.maxZ+.1])b.profile(parent,'frame',[centerX,top-.16,z],[a.maxX-a.minX+.33,.2,.13]);
    for(const x of [a.minX-.1,a.maxX+.1]){b.profile(parent,'frame',[x,top-.16,centerZ],[.13,.2,a.maxZ-a.minZ+.33],'z');for(const z of [a.minZ-.1,a.maxZ+.1])b.plate(parent,[x,top-.16,z+.07],[.16,.24,.018]);}
    for (let i = 0; i < count; i++) {
      const h = rise * (i + 1), z = lastZ + (count - i - .5) * run;
      b.box(parent, 'deck', [stairX, base + h / 2, z], [stairWidth, h, run + .012]);
    }
    for (const side of [-1, 1]) {
      const x = stairX + side * (stairWidth / 2 + .025);
      b.rod(parent, 'guard', [x, base + .95, firstZ], [x, top + .95, lastZ], .024);
      for (let i = 0; i <= count; i += 3) b.box(parent, 'guard', [x, base + rise * i + .47, firstZ - run * i], [.035, .94, .035]);
    }
    if (level > 0) {
      // The previous floor's adjacent return walk reaches this flight's base.
      // It does not seal the stair opening or create a low ceiling over it.
      b.box(parent, 'deck', [returnX, base - .045, (lastZ + firstZ + .35) / 2], [returnWidth, .09, firstZ - lastZ + .35]);
      b.box(parent, 'deck', [(stairX + returnX) / 2, base - .045, firstZ + .18], [returnX - stairX + stairWidth, .09, .36]);
      for (const h of [.55, 1.05]) {
        b.box(parent, 'guard', [returnX + returnWidth / 2, base + h, (lastZ + firstZ + .35) / 2], [.04, .04, firstZ - lastZ + .35]);
        b.box(parent, 'guard', [(stairX + returnX) / 2, base + h, firstZ + .36], [returnX - stairX + stairWidth, .04, .04]);
      }
      for (let z = lastZ; z <= firstZ + .35; z += 1.25) b.box(parent, 'guard', [returnX + returnWidth / 2, base + .53, z], [.04, 1.06, .04]);
    }
    const nextFlight = level < levels.length - 1, openingEnd = nextFlight ? returnX + returnWidth / 2 + .08 : stairX + stairWidth / 2 + .08;
    for (const z of [a.minZ - .15, a.maxZ + .15]) {
      const start = z > centerZ ? openingEnd : a.minX - .15, end = a.maxX + .15;
      if (end > start) for (const h of [.55, 1.05]) b.box(parent, 'guard', [(start + end) / 2, top + h, z], [end - start, .04, .04]);
      for (let x = start; x <= end + .01; x += 1.4) b.box(parent, 'guard', [x, top + .53, z], [.04, 1.06, .04]);
    }
    for (const x of [a.minX - .15, a.maxX + .15]) {
      for (const h of [.55, 1.05]) b.box(parent, 'guard', [x, top + h, centerZ], [.04, .04, depth]);
      for (let z = a.minZ; z <= a.maxZ + .01; z += 1.4) b.box(parent, 'guard', [x, top + .53, z], [.04, 1.06, .04]);
    }
    flights.push({base, deckTop: top, stairCount: count, stairRise: rise, stairRun: run, stairWidth, stairX, firstZ, lastZ});
  });
  rig.mezzanine = Object.assign({levels, flights}, flights[0]);
  // Low pick dividers on top do not enclose a warehouse-sized solid block.
  cells.forEach(cell => {const p = position(cell); b.box(parent, 'steel', [p[0], p[1] + .015, p[2] - cell.depth / 2], [cell.width, .03, .035]);b.label(parent,cell.code||'M'+(cell.bay+1)+'-N'+(cell.level+1),[p[0],p[1]-.065,a.maxZ+.178],Math.min(1.3,cell.width*.9),.075);b.detail.slotsLabeled++;});
}

function automatic(THREE, b, parent, cells, config, layout, rig, system) {
  const a = frame(THREE, b, parent, cells, config, {support: 'shelf', light: true}), access = layout.accessPosition || [0, 0, a.maxZ + 1.1];
  const shaft = layout.shaftPosition || [0, a.maxZ + .6], shaftZ = shaft.length === 3 ? shaft[2] : shaft[1], top = Math.max(a.maxY + .22, access[1] + ((cells[0] && cells[0].clearHeight) || .8) + .3);
  const carrier = rig.carriage = group(THREE, parent, system === 'vertical-lift' ? 'Bandeja del elevador vertical' : 'Carro del transelevador miniload');
  carrier.position.fromArray(access); Object.assign(carrier.userData, {warehouseRackMovingGeometry: system, homePosition: access.slice(), supportTop: 0});
  rig.lift = carrier; rig.shuttle = carrier;
  const cell = cells[0] || {width: 1, depth: .7}, cw = Math.max(.5, cell.width), cd = Math.max(.4, cell.depth);
  b.box(carrier, 'deck', [0, -.035, 0], [cw + .08, .07, cd + .08]);
  for (const x of [-1, 1]) b.box(carrier, 'guard', [x * (cw / 2 + .035), .045, 0], [.035, .09, cd + .08]);
  // Twin columns leave the full load envelope and the insertion trajectory free.
  const shaftWidth = Math.max(cw + .35, .95);
  for (const x of [-1, 1]) b.box(parent, 'dark', [x * shaftWidth / 2, (FLOOR + top) / 2, shaftZ + cd / 2 + .12], [.1, top - FLOOR, .1]);
  b.box(parent, 'dark', [0, FLOOR + .04, shaftZ + cd / 2 + .12], [Math.max(shaftWidth, a.maxX - a.minX), .08, .12]);
  if (system === 'vertical-lift') {
    const minX = a.minX - .16, maxX = a.maxX + .16, minZ = a.minZ - .16, front = access[2] + cd / 2 + .16;
    const middleY = (FLOOR + top) / 2, height = top - FLOOR, midZ = (minZ + front) / 2;
    b.box(parent, 'frame', [minX, middleY, midZ], [.055, height, front - minZ]);
    b.box(parent, 'frame', [maxX, middleY, midZ], [.055, height, front - minZ]);
    b.box(parent, 'frame', [(minX + maxX) / 2, middleY, minZ], [maxX - minX, height, .055]);
    b.box(parent, 'frame', [(minX + maxX) / 2, top + .025, midZ], [maxX - minX, .05, front - minZ]);
    const windowBottom = Math.max(FLOOR + .12, access[1] - .1), windowTop = Math.min(top - .1, access[1] + (cell.clearHeight || .8) + .18), windowHalf = Math.min((maxX - minX) / 2 - .08, cw / 2 + .13);
    if (windowBottom > FLOOR) b.box(parent, 'frame', [(minX + maxX) / 2, (FLOOR + windowBottom) / 2, front], [maxX - minX, windowBottom - FLOOR, .055]);
    if (top > windowTop) b.box(parent, 'frame', [(minX + maxX) / 2, (windowTop + top) / 2, front], [maxX - minX, top - windowTop, .055]);
    for (const side of [-1, 1]) {const edge = side < 0 ? minX : maxX, inside = side * windowHalf; if (Math.abs(edge - inside) > .02) b.box(parent, 'frame', [(edge + inside) / 2, (windowBottom + windowTop) / 2, front], [Math.abs(edge - inside), windowTop - windowBottom, .055]);}
    rig.window = {frontZ: front, minX: -windowHalf, maxX: windowHalf, bottom: windowBottom, top: windowTop};
  } else {
    // A miniload is an open rack plus travelling mast, not a closed cupboard.
    for (const z of [shaftZ - .15, shaftZ + .15]) b.box(parent, 'steel', [(a.minX + a.maxX) / 2, FLOOR + .025, z], [a.maxX - a.minX + .5, .05, .055]);
  }
}

function createVisual(THREE, value, suppliedLayout) {
  const config = racks.normalize ? racks.normalize(value) : value, layout = suppliedLayout || racks.layout(config), cells = layout.cells || layout.pallets || [];
  const root = new THREE.Group(); root.name = 'Estantería · ' + (config.rackSystem || 'selective');
  const system = config.rackSystem, b = createBuilder(THREE, config), rig = {system, pallets: [], banks: [], supports: [], carriage: null, lift: null, shuttle: null};
  Object.defineProperty(root.userData, 'warehouseRackRig', {value: rig, writable: true, configurable: true, enumerable: false});
  if (system === 'mobile') {
    const bankIds = distinct(cells.map(c => c.bank || 0));
    bankIds.forEach(bank => {
      const next = group(THREE, root, 'Base móvil · bloque ' + (bank + 1)), rows = cells.filter(c => (c.bank || 0) === bank);
      const offset = racks.mobileOffset ? racks.mobileOffset(config, bank, config.rackOpenAisle) : [0, 0, 0]; next.position.fromArray(offset);
      Object.assign(next.userData, {warehouseRackBank: bank, homePosition: offset.slice(), basePosition: [0, 0, 0]}); rig.banks[bank] = next;
      const a = frame(THREE, b, next, rows, config, {closed: true});
      b.box(next, 'dark', [(a.minX + a.maxX) / 2, FLOOR + .07, (a.minZ + a.maxZ) / 2], [a.maxX - a.minX + .3, .14, a.maxZ - a.minZ + .25]);
      for (const x of [a.minX, a.maxX]) for (const z of [a.minZ - .07, a.maxZ + .07]) b.roller(next, [x, FLOOR + .07, z], .14, .07);
    });
    const a = bounds(cells, true), back = a.minZ - (config.rackAisleWidth || 2) - .2, front = a.maxZ + .2;
    for (const x of [a.minX, a.maxX]) b.box(root, 'steel', [x, FLOOR + .008, (back + front) / 2], [.07, .016, front - back]);
  } else if (system === 'cantilever') cantilever(THREE, b, root, cells, config);
  else if (system === 'mezzanine') mezzanine(THREE, b, root, cells, config, rig);
  else if (system === 'vertical-lift' || system === 'miniload') automatic(THREE, b, root, cells, config, layout, rig, system);
  else {
    const mode = system === 'light-duty' || system === 'medium-duty' ? 'shelf' : system === 'pallet-flow' || system === 'carton-flow' ? 'roller' : system === 'drive-in' || system === 'drive-through' ? 'rail' : 'beam';
    frame(THREE, b, root, cells, config, {support: mode, light: system === 'light-duty' || system === 'carton-flow', drive: system === 'drive-in' || system === 'drive-through'});
    if (system === 'drive-in') {
      const a = bounds(cells);
      for (const h of [.35, .9]) b.box(root, 'guard', [(a.minX + a.maxX) / 2, FLOOR + h, a.minZ - .13], [a.maxX - a.minX + .18, .07, .06]);
    }
    if (system === 'push-back') {
      const lanes = new Map(); cells.forEach(cell => {const id = cell.lane || [cell.bay, cell.column, cell.level].join(':'); if (!lanes.has(id)) lanes.set(id, []); lanes.get(id).push(cell);});
      rig.carts = [];
      lanes.forEach((rows, lane) => rows.forEach(cell => {
        const p = position(cell), cart = group(THREE, root, 'Carro push-back · ' + lane + '/' + cell.depthIndex); cart.position.fromArray(p);
        Object.assign(cart.userData, {warehouseRackMovingGeometry: 'push-back', warehouseRackCell: cell.index, homePosition: p.slice()}); rig.carts.push(cart);
        for (const x of [-1, 1]) b.box(root, 'steel', [p[0] + x * cell.width * .4, p[1] - .035, p[2]], [.065, .07, cell.depth * .92], undefined, cart);
        for (const z of [-1, 1]) b.box(root, 'dark', [p[0], p[1] - .06, p[2] + z * cell.depth * .38], [cell.width * .8, .05, .065], undefined, cart);
      }));
    }
  }
  cells.forEach(cell => {
    const bank = system === 'mobile' ? rig.banks[cell.bank || 0] : root, p = position(cell, system === 'mobile'), marker = group(THREE, bank || root, 'Apoyo de carga ' + (cell.code || cell.index + 1)); marker.position.fromArray(p);
    marker.userData.warehouseRackCell = cell.index; marker.userData.warehouseRackLocationCode=cell.code||'';marker.userData.editorNonCollidable = true;
    const entry = {object: marker, config: {width: cell.width, depth: cell.depth, top: 0}, items: [], cell}; rig.pallets[cell.index] = entry;
    rig.supports.push({index: cell.index, position: (cell.position || p).slice(), width: cell.width, depth: cell.depth});
  });
  b.finish(); rig.syncMotion = b.syncMotion; root.userData.warehouseRackVisualStats = b.detail;root.userData.warehouseRackLocationCodes=cells.map(cell=>cell.code||''); root.updateMatrixWorld(true); return root;
}

/** A physical logistics plate, reusable on pallets without a canvas per unit.
 * The caller owns the returned group and disposes it with disposeVisual(). */
function createLocationLabel(THREE, text, options = {}) {
  const root=new THREE.Group(),b=createBuilder(THREE,{}),width=options.width||.65,height=options.height||.075;
  root.name='Identificación de ubicación · '+String(text);root.userData.warehouseLocationLabel=String(text);root.userData.warehouseLocationRenderedText=String(text||'').replace(/[^\x20-\x7e]/g,'?');root.userData.editorNonCollidable=true;
  b.label(root,text,[0,0,0],width,height);b.finish();root.userData.warehouseRackVisualStats=b.detail;return root;
}

function disposeVisual(root) {
  if (!root||root.userData&&root.userData.warehouseRackVisualDisposed) return;
  if(root.userData)root.userData.warehouseRackVisualDisposed=true;
  const geometries = new Set(), materials = new Set(), textures=new Set(); root.traverse(node => {if (node.geometry) geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(m => {materials.add(m);for(const key of ['map','bumpMap'])if(m[key])textures.add(m[key]);});});
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());textures.forEach(t=>{if(!t.warehouseRackSharedAtlas)t.dispose();});
}
function stats(root) {
  let meshes = 0, triangles = 0, vertices = 0; const materials = new Set(); root.traverse(n => {if (!n.isMesh) return; meshes++; vertices += n.geometry.attributes.position.count; triangles += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3; materials.add(n.material);});
  return Object.assign({meshes, draws: meshes, triangles, vertices, materials: materials.size},root.userData.warehouseRackVisualStats||{});
}

module.exports = {createVisual, createLocationLabel, disposeVisual, stats};
