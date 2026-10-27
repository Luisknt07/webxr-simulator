'use strict';
const PROFILES=[
 {id:'steel',name:'Acero satinado',provider:'ambientCG',source:'https://ambientcg.com/a/Metal032',normalStrength:.14,roughnessMean:.4081,metalness:.9,roughness:.34,color:'#bac3ca'},
 {id:'paint',name:'Pintura industrial desgastada',provider:'ambientCG',source:'https://ambientcg.com/a/PaintedMetal012',normalStrength:.20,roughnessMean:.2761,metalness:.08,roughness:.55,color:'#c5a42c'},
 {id:'cardboard',name:'Cartón kraft',provider:'ambientCG',source:'https://ambientcg.com/a/Cardboard004',normalStrength:.19,roughnessMean:.6353,metalness:0,roughness:.85,color:'#b18b59'},
 {id:'wood',name:'Madera con veta y desgaste',provider:'Poly Haven',source:'https://polyhaven.com/a/wood_planks',normalStrength:.20,roughnessMean:.8614,metalness:0,roughness:.83,color:'#b18a58'},
 {id:'rubber',name:'Caucho con micrograno',provider:'Poly Haven',source:'https://polyhaven.com/a/rubberized_track',normalStrength:.14,roughnessMean:.9243,metalness:0,roughness:.9,color:'#252b30'},
 {id:'vinyl',name:'Tapicería con grano',provider:'Poly Haven',source:'https://polyhaven.com/a/fabric_leather_01',normalStrength:.12,roughnessMean:.6432,metalness:0,roughness:.72,color:'#34383b'},
 {id:'concrete',name:'Hormigón industrial',provider:'Poly Haven',source:'https://polyhaven.com/a/concrete_floor',normalStrength:.17,roughnessMean:.8335,metalness:0,roughness:.89,color:'#999b93'}
];
function path(id,channel,edge=512){if(!PROFILES.some(p=>p.id===id)||!['color','neutral','normal','roughness'].includes(channel)||![256,512,1024].includes(edge))throw Error('Material fotográfico inválido.');return 'assets/materials/pbr/'+id+'-'+channel+'-'+edge+'.jpg';}
function classify(material,mesh){const label=[material.name,material.userData&&material.userData.industrialMaterialRole,mesh.name,mesh.userData&&mesh.userData.industrialMaterialRole].filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if(/decal|sticker|etiqueta|label|calcomania|shipping|barcode|text|screen|display|hmi|lente|emisor|reflector|haz laser/.test(label)||material.isShaderMaterial||material.isMeshBasicMaterial||material.opacity<.75||material.emissive&&material.emissiveIntensity>.1&&material.emissive.getHex()!==0)return null;
 const role=String(material.userData&&material.userData.industrialMaterialRole||'').toLowerCase();
 if(/^(?:metal|steel|aluminum|aluminium|chrome|fork|forks|tool|rim|hardware)$/.test(role))return 'steel';
 if(/^(?:frame|accent|body|chassis|cabin|paint)$/.test(role))return role==='frame'&&material.metalness>.8?'steel':'paint';
 if(/^(?:seat|vinyl|leather|upholstery)$/.test(role))return 'vinyl';
 if(/^(?:rubber|tire|tyre|wheel)$/.test(role))return 'rubber';
 if(/asiento|seat|tapicer|vinyl|vinilo|cuero|cojin|respaldo/.test(label))return 'vinyl';
 if(/rubber|caucho|goma|tire|neumatic|rodadura|banda de transporte|cinta continua|banda modular/.test(label))return 'rubber';
 if(/cardboard|carton|kraft|carton-body|cuerpo de caja|caja manipulable/.test(label))return 'cardboard';
 if(/wood|madera|tablon|tabla |tablas|patin de|taco de estiba/.test(label))return 'wood';
 if(/concrete|hormigon|concreto/.test(label))return 'concrete';
 if(/plastic|plastico|tote|polimero|pvc/.test(label))return 'rubber';
 if(/frame|accent|carcasa|capo|contrapeso|cabina|panel|armario|gabinete|paint|pintur|pintad|bastidor|estructura|eslabon|brazo|base de robot|lamina/.test(label))return 'paint';
 if(/steel|metal|acero|alumin|rodill|roller|llanta|rim|chrome|crom|shaft|eje |tornill|perno|tuerca|cilindro|vastago|piston|hidraulic|brida|fijacion|corredera|guias/.test(label)||material.metalness>.5)return 'steel';
 return material.metalness>.15?'paint':null;
}
module.exports={PROFILES,path,classify};
