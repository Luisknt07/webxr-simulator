'use strict';

// Linear PBR factors and small neutral maps for the actual manufactured parts.
// A colour is paint, not exposed steel; material roles are independent of names
// used to restore older documents. Textures belong to each material owner.
const PROFILES = {
  paint: {metalness: .06, roughness: .48, bumpScale: .00022},
  steel: {metalness: .88, roughness: .33, bumpScale: .00012},
  aluminum: {metalness: .82, roughness: .40, bumpScale: .00010},
  rubber: {metalness: 0, roughness: .88, bumpScale: .00024},
  plastic: {metalness: 0, roughness: .51, bumpScale: .00010},
  wood: {metalness: 0, roughness: .83, bumpScale: .0003},
  cardboard: {metalness: 0, roughness: .91, bumpScale: .00015},
  glass: {metalness: 0, roughness: .15, bumpScale: 0},
  optical: {metalness: .03, roughness: .12, bumpScale: 0}
};
function folded(value) {return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();}
function roleFor(name, extra = {}) {
  const text = folded(name);
  if (/lente|optica|emisor|reflector|laser|display|pantalla|piloto|baliza/.test(text)) return 'optical';
  if (/vidrio|glass|transparente/.test(text)) return 'glass';
  if (/carton|cardboard|kraft/.test(text)) return 'cardboard';
  if (/madera|tablas|tablon|taco de estiba/.test(text)) return 'wood';
  if (/cable|manguera|junta|reten|antideslizante|antivibr|cojinete sellado|pie nivelador|retorno.*cinta|superficie de la cinta|neumatic|caucho/.test(text)) return 'rubber';
  if (/polimero|modular|poliuretano|plastico|botella|tote/.test(text)) return 'plastic';
  if (/aluminio|aluminum|aluminium/.test(text)) return 'aluminum';
  if (/tornillo|tuerca|perno|arandela|pasador|husillo|vastago|crom|acero|inoxidable|brida|eje |rodill|rodamiento|guia lineal|casquillo|nervio de la rejilla|transmision/.test(text)) return 'steel';
  if (/pint|bancada|carcasa|redactor|reductor|armario|tapa|perfil|larguero|soporte|bastidor|pata|anclaje|refuerzo|men[s]?ula|cabezal|placa de herramienta/.test(text)) return 'paint';
  return extra.metalness >= .75 ? 'steel' : 'paint';
}
function neutralMap(THREE, role, seed = 29) {
  const size = 64, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4, noise = ((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0;
    const grain = role === 'steel' || role === 'aluminum' ? Math.sin(x * 1.7) * 3 + noise % 5 : role==='rubber'?noise%10:noise % 7;
    const value = Math.max(225, Math.min(255, 247 - grain));
    bytes[index] = bytes[index + 1] = bytes[index + 2] = value; bytes[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.name = 'Microacabado neutro / ' + role;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipMapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
function createSurface(THREE, name, color, extra = {}, explicitRole) {
  const role = explicitRole || roleFor(name, extra), profile = PROFILES[role] || PROFILES.paint;
  const options = Object.assign({color, metalness: profile.metalness, roughness: profile.roughness}, extra);
  // These are generated native defaults, never an authored surface override.
  // Preserve optical/emissive and map choices, but correct metallic paint and
  // rubber inherited from the previous universal 65% metallic base material.
  if (['paint','rubber','plastic','wood','cardboard'].includes(role)) options.metalness = profile.metalness;
  const material = new THREE.MeshStandardMaterial(options);
  material.name = name || role;
  material.color.convertSRGBToLinear();
  if (material.emissive && material.emissive.getHex()) material.emissive.convertSRGBToLinear();
  Object.assign(material.userData, {industrialManufacturedFinish: true, industrialMaterialRole: role === 'paint' ? 'frame' : role, studioColorSpace: 'linear', industrialSurfaceName: name || role, industrialMicrofinish:'brushed-metal-or-fine-manufactured-grain'});
  if (!options.map && !options.transparent && !options.emissiveIntensity && profile.bumpScale) {
    const texture = neutralMap(THREE, role);
    material.map = texture; material.bumpMap = texture; material.bumpScale = profile.bumpScale;
  }
  return material;
}
module.exports = {PROFILES, roleFor, neutralMap, createSurface};
