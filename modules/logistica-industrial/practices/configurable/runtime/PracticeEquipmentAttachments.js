import * as THREE from 'three';
import schema from '../../../contracts/behaviors.js';
import catalogue from '../../../functions/equipamiento/schema/equipmentCatalog.cjs';
import geometryFactory from '../../../functions/equipamiento/runtime/EquipmentGeometry.cjs';

const MACHINE_TYPES=['conveyor','source','processor','palletQueue','robot','vehicle','product'];
const BODY_FINISH={frame:{preset:'paintedMetal',color:'#526b74',metalness:.06,roughness:.57},steel:{preset:'steel',color:'#b9c5c8',metalness:.86,roughness:.4},aluminum:{preset:'aluminum',color:'#bdc7ca',metalness:.8,roughness:.45},rubber:{preset:'rubber',color:'#29343a',metalness:0,roughness:.9},plastic:{preset:'plastic',color:'#344e5a',metalness:0,roughness:.57},optical:{preset:'custom',color:'#173a49',metalness:.03,roughness:.2},wood:{preset:'wood',color:'#b99d70',metalness:0,roughness:.85},cardboard:{preset:'wood',color:'#bca273',metalness:0,roughness:.85}};
const cfg=(doc,o)=>doc.getBehaviors(o).find(row=>MACHINE_TYPES.includes(row.type))||{};
const id=o=>o.userData.editorId;
const r=n=>Math.round(n*1e6)/1e6;
const finishRole=role=>role==='aluminum'?'steel':role==='plastic'?'rubber':BODY_FINISH[role]?role:'frame';
const materiallyStock = definition => definition.role==='product'||definition.role==='vehicle'||definition.role==='storage';

/** Material hardware uses the same native equipment recipes. Small parts are
 * baked by finish into typed CAD frame attachments, not a second stock system.
 * Native sensor/control behaviours remain the authoritative local runtime. */
export function buildPracticeEquipmentAttachments(doc,roomId,plan,rows,objects){
  const created=[],components=[],connections=[],inventoryComponents=[],owners=new Map(rows.map(row=>[row.alias,doc.getObject(row.objectId)])),terminalTargets=new Map(),staticBanks=new Map();
  const temporaryGeometry=new Set(),temporaryMaterials=new Set(),temporaryTextures=new Set();
  const boxGeometry=new THREE.BoxBufferGeometry(1,1,1).toNonIndexed(),cylinderGeometry=new THREE.CylinderBufferGeometry(1,1,1,12,1).toNonIndexed();
  temporaryGeometry.add(boxGeometry);temporaryGeometry.add(cylinderGeometry);
  function assembly(owner,row,equipmentId,label,pose=[0,0,0],rotation=[0,0,0]){
    const banks=new Map(),shapeBounds=new THREE.Box3(),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
    const append=(role,geometry,position=[0,0,0],scale=[1,1,1],rot=[0,0,0])=>{
      const key=finishRole(role);if(!banks.has(key))banks.set(key,[]);
      matrix.compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),new THREE.Vector3(...scale));
      const positions=geometry.attributes.position,index=geometry.index,total=index?index.count:positions.count;
      for(let at=0;at<total;at++){point.fromBufferAttribute(positions,index?index.getX(at):at).applyMatrix4(matrix);banks.get(key).push(r(point.x),r(point.y),r(point.z));shapeBounds.expandByPoint(point);}
    };
    const box=(role,p,size)=>append(role,boxGeometry,p,size);
    const cylinder=(role,p,radius,length,axis='y')=>append(role,cylinderGeometry,p,[radius,length,radius],axis==='z'?[Math.PI/2,0,0]:axis==='x'?[0,0,Math.PI/2]:[0,0,0]);
    const tube=(role,points,radius=.008)=>{if(points.length<2)return;const g=new THREE.TubeBufferGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.min(24,points.length*4),radius,5,false);temporaryGeometry.add(g);append(role,g);};
    function native(equipment,options={},filter){
      const definition=catalogue.definition(equipment),config=catalogue.normalize(equipment,Object.assign({detail:'low',withPanel:false,wear:.16},options)),layout=Object.assign({},catalogue.layout(equipment,config));
      if(options.tabletop||options.noBuffers){if(options.tabletop)layout.floor=0;layout.length=config.length;layout.width=config.width;layout.height=config.height;delete layout.bodyLength;delete layout.inputPosition;delete layout.outputPosition;}
      const body=geometryFactory.createEquipmentGeometry(definition,config,{THREE,layout});if(!body)throw Error('Accesorio sin geometría nativa: '+equipment);
      body.updateWorldMatrix(true,true);
      body.traverse(node=>{
        if(node.geometry)temporaryGeometry.add(node.geometry);
        const materials=Array.isArray(node.material)?node.material:node.material?[node.material]:[];
        for(const m of materials){temporaryMaterials.add(m);for(const value of Object.values(m))if(value&&value.isTexture)temporaryTextures.add(value);}
        if(!node.isMesh||!node.geometry||filter&&!filter(node))return;
        const role=finishRole(node.material&&node.material.userData&&node.material.userData.industrialMaterialRole||'frame'),geometry=node.geometry,positions=geometry.attributes.position,index=geometry.index,total=index?index.count:positions.count;
        if(!banks.has(role))banks.set(role,[]);
        for(let at=0;at<total;at++){point.fromBufferAttribute(positions,index?index.getX(at):at).applyMatrix4(node.matrixWorld);banks.get(role).push(r(point.x),r(point.y),r(point.z));shapeBounds.expandByPoint(point);}
      });
      return body;
    }
    function persist({sensorSourceId,representation='frame-mounted-hardware',support,control,collision=false}={}){
      const objectIds=[];let sensorObjectId='';
      const component={ownerAlias:row.alias,ownerId:id(owner),equipmentId,objectIds,representation,pose:pose.slice(),rotation:rotation.slice(),bounds:{min:shapeBounds.min.toArray(),max:shapeBounds.max.toArray()},support:support||'native-equipment-frame'};
      // Mechanical hardware sharing the same finish and native parent is one
      // draw. Semantic parts retain their poses/bounds/source identities; sensors
      // keep independent roots and authoritative telemetry volumes.
      if(!sensorSourceId&&!control){
        const transform=new THREE.Matrix4().compose(new THREE.Vector3(...pose),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1)),v=new THREE.Vector3();
        for(const [role,positions]of banks){const key=id(owner)+':'+role+':'+collision;if(!staticBanks.has(key))staticBanks.set(key,{owner,row,role,collision,positions:[],parts:[]});const bank=staticBanks.get(key);for(let i=0;i<positions.length;i+=3){v.set(positions[i],positions[i+1],positions[i+2]).applyMatrix4(transform);bank.positions.push(r(v.x),r(v.y),r(v.z));}bank.parts.push(component);}
        components.push(component);return component;
      }
      for(const [role,positions]of banks){if(!positions.length)continue;
        const finish=BODY_FINISH[role]||BODY_FINISH.frame,descriptor={type:'cad',recipe:{steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:finish.color,smoothingAngle:38,attachment:{targetId:id(owner),part:'frame',position:pose.slice()},sourceData:{tool:'practice-hardware',version:1,assemblyId:plan.id+'-'+row.alias,document:{format:'smarttwin.practice-equipment-hardware',practiceId:plan.id,ownerAlias:row.alias,equipmentId,representation,support:support||'native-equipment-frame'}}};
        const object=doc.addCAD(roomId,descriptor);doc.setProperty(object,'name',row.alias+' · '+label+' · '+role);doc.setTransform(object,{position:pose,rotation,scale:[1,1,1]});
        const behaviors=[Object.assign(schema.defaultBehavior('collision'),{enabled:collision}),Object.assign(schema.defaultBehavior('surfaceMaterial'),finish,{wear:.14,wearType:role==='steel'?'scratches':'dirt',colorMapMode:'preserve',clearcoat:0})];
        if(sensorSourceId&&!sensorObjectId){behaviors.push(Object.assign(schema.defaultBehavior('sensor'),{sourceId:sensorSourceId,catalogueEquipmentId:equipmentId}),schema.defaultBehavior('analytics'));sensorObjectId=id(object);}
        if(control)behaviors.push(Object.assign(schema.defaultBehavior('control'),{targetId:id(owner),mode:'command',command:control,scope:'module'}));
        doc.setBehaviors(object,behaviors);objects.push(object);created.push(object);objectIds.push(id(object));
      }
      if(sensorObjectId){component.sensorObjectId=sensorObjectId;component.sourceId=sensorSourceId;connections.push({kind:'native-sensor-source',from:sensorObjectId,to:sensorSourceId,equipmentId});}
      components.push(component);row.componentObjectIds=[...new Set((row.componentObjectIds||[]).concat(objectIds))];return component;
    }
    return{box,cylinder,tube,native,persist,shapeBounds};
  }
  function existingComponent(row,equipmentId){
    for(const objectId of row.componentObjectIds||[]){const object=doc.getObject(objectId);if(object&&doc.getBehaviors(object).some(b=>b.catalogueEquipmentId===equipmentId))return object;}
    return null;
  }
  function existingPanel(owner){
    let own=false;owner.traverse(node=>{if(!node.userData.industrialDisplay)return;for(let p=node;p;p=p.parent)if(!p.visible||p.userData.editorGeometryReplaced)return;own=true;});if(own)return owner;
    const candidates=rows.map(row=>owners.get(row.alias)).filter(o=>o&&o.userData.editorPrefabKey==='plc');
    return candidates.sort((a,b)=>a.position.distanceToSquared(owner.position)-b.position.distanceToSquared(owner.position))[0]||null;
  }
  function controlReference(owner,row,equipmentId){
    const panel=existingPanel(owner);if(!panel)throw Error('La configuración necesita un panel real para '+row.alias+'.');
    let nativeControls=0;
    if(panel!==owner&&!terminalTargets.has(id(panel))){
      panel.traverse(node=>{if(!node.userData.editorId||doc.getObject(node.userData.editorId)!==node)return;const behaviors=doc.getBehaviors(node);if(!behaviors.some(b=>b.type==='control'))return;doc.setBehaviors(node,behaviors.map(b=>b.type==='control'?Object.assign({},b,{targetId:id(owner),scope:'module'}):b));nativeControls++;});
      if(nativeControls){terminalTargets.set(id(panel),id(owner));const behaviors=doc.getBehaviors(panel).filter(b=>b.type!=='lineMonitor');doc.setBehaviors(panel,behaviors.concat(Object.assign(schema.defaultBehavior('lineMonitor'),{targetId:id(owner),scope:'module',title:row.alias+' · control y estado'})));}
    }
    const commanded=panel===owner||terminalTargets.get(id(panel))===id(owner);
    components.push({ownerAlias:row.alias,ownerId:id(owner),equipmentId,objectIds:[id(panel)],representation:panel===owner?'native-integrated-control':'existing-native-cell-terminal',commandedByNativePanel:commanded,nativeControlsRetargeted:nativeControls,terminalCommandTargetId:terminalTargets.get(id(panel))||id(panel)});
    row.componentObjectIds=[...new Set((row.componentObjectIds||[]).concat(id(panel)))];connections.push({kind:commanded?'native-control-target':'existing-native-terminal-reference',from:id(panel),to:id(owner),equipmentId,externalPLC:false});
  }
  try{
    for(const row of rows){
      const owner=owners.get(row.alias);if(!owner)throw Error('Equipo de origen no encontrado para sus accesorios.');
      const config=cfg(doc,owner),definition=catalogue.definition(row.catalogueEquipmentId),L=config.length||row.sourceDimensions[0]||1,W=config.width||config.depth||row.sourceDimensions[1]||.8,ownerFloor=-owner.position.y,stand=definition.mechanism==='stand',top=stand?Math.max(.2,(config.height||1)-.13):['processor','conveyor','source'].includes(owner.userData.editorPrefabKey)?0:owner.userData.editorPrefabKey==='plc'?-.05:Math.min(1.2,Math.max(.65,(config.rackLevelPitch||1.2)))-owner.position.y;
      let toolIndex=0;
      for(const equipmentId of row.componentEquipmentIds||[]){
        const d=catalogue.definition(equipmentId);if(materiallyStock(d)){inventoryComponents.push({ownerAlias:row.alias,ownerId:id(owner),equipmentId,kind:'material-or-carrier-owned-by-workflow'});continue;}
        const found=existingComponent(row,equipmentId);if(found){components.push({ownerAlias:row.alias,ownerId:id(owner),equipmentId,objectIds:[id(found)],representation:'existing-native-component'});continue;}
        if(d.role==='control'){controlReference(owner,row,equipmentId);continue;}
        if(d.mechanism==='pick-to-light'){
          const rack=schema.warehouseRacks.isRack(config)?schema.warehouseRacks.layout(config):null,a=assembly(owner,row,equipmentId,'Indicadores de picking montados en entrepaño');
          const cells=rack?rack.cells.filter(cell=>cell.depthIndex===0).slice(0,16):[{position:[0,top,0],depth:W}];
          for(const cell of cells){const x=cell.position[0],y=cell.position[1]-.06,localZ=cell.position[2]+cell.depth/2+.04;
            a.box('plastic',[x,y,localZ],[.18,.065,.03]);a.box('optical',[x-.025,y,localZ+.018],[.08,.035,.006]);a.cylinder('plastic',[x+.058,y,localZ+.021],.014,.012,'z');
          }
          a.persist({representation:'shelf-mounted-light-and-confirmation-hardware',support:'front-face-of-native-shelf-beams'});continue;
        }
        if(d.role==='sensor'&&d.nativeKind==='sensor'){
          const shelf=definition.role==='storage',terminal=owner.userData.editorPrefabKey==='plc',target=terminal?rows.map(other=>owners.get(other.alias)).filter(o=>o&&['source','processor','palletQueue','conveyor'].includes(o.userData.editorPrefabKey)).sort((a,b)=>a.position.distanceToSquared(owner.position)-b.position.distanceToSquared(owner.position))[0]||owner:owner;
          const reader=d.mechanism==='barcode-rf',photo=d.mechanism==='photoelectric',mountX=photo?0:shelf?-Math.min(.6,L*.22):L*.26,mountY=photo?0:top+.16,mountZ=photo?0:shelf?W/2+.05:-W*.24;
          const a=assembly(owner,row,equipmentId,d.title,[mountX,mountY,mountZ]);
          if(photo){const half=W/2+.07;for(const side of [-1,1]){a.box('steel',[0,.015,side*half],[.045,.15,.045]);a.box('plastic',[0,.115,side*half],[.065,.09,.075]);a.cylinder('optical',[0,.115,side*(half-.042)],.018,.012,'z');}a.tube('rubber',[[0,-.02,-half],[.12,-.06,-half],[L*.24,-.06,-half],[L*.24,-.02,-half-.03]],.006);}
          else{
            a.native(equipmentId,{length:reader?.22:.35,width:reader?.13:.22,height:reader?.22:.32});
            // A scanner parks in its cradle; a camera portal is supported by
            // feet, not suspended beside an arbitrary centre point.
            const min=a.shapeBounds.min.y,base=min-.025;
            a.box('plastic',[0,base,0],[reader?.20:.4,.05,reader?.16:.26]);
            if(terminal){const length=mountY-base-ownerFloor;if(length>0)a.box('steel',[0,(ownerFloor-mountY+base)/2,0],[.045,Math.max(.1,base-(ownerFloor-mountY)),.045]);}
            else if(shelf){a.box('steel',[0,base-.04,-.065],[.19,.035,.24]);a.box('steel',[0,base+.015,-.17],[.19,.13,.035]);}
            else{const gap=mountY+base-top;if(gap>.001)a.box('steel',[0,base-gap/2,0],[.08,gap,.08]);}
            a.tube('rubber',[[.03,base+.04,-.05],[.10,base+.015,-.11],[.10,top-mountY+.04,-.15]],.006);
          }
          a.persist({sensorSourceId:id(target),representation:'native-sensor-behaviour-on-persisted-frame-attachment',support:terminal?'floor-supported-scanner-dock':shelf?'native-rack-upright-bracket':'native-work-surface-and-cradle'});continue;
        }
        if(d.role==='safety'){
          const reach=config.reach||Math.max(.75,L/2),distance=definition.role==='robot'?reach+.55:W/2+.55,placement=[0,ownerFloor,-distance],guardLength=Math.min(1.8,Math.max(1.2,L)),a=assembly(owner,row,equipmentId,'Resguardo posterior con acceso frontal libre',placement);
          a.native(equipmentId,{length:guardLength,width:.12,height:1.8});
          for(const x of [-guardLength/2,guardLength/2])a.box('steel',[x,.025,0],[.20,.05,.24]);
          a.persist({representation:'rear-fixed-guard-open-at-material-access',support:'floor-mounted-baseplates; outside-owner-working-radius',collision:true});continue;
        }
        if(d.role==='tool'){
          if(d.mechanism==='probe'&&definition.mechanism==='cmm'){
            let probe=false;owner.traverse(node=>{if((node.userData.equipmentSourceParts||[]).some(text=>/palpador/i.test(text)))probe=true;});
            if(probe){components.push({ownerAlias:row.alias,ownerId:id(owner),equipmentId,objectIds:[id(owner)],representation:'existing-native-CMM-probe'});continue;}
          }
          const index=toolIndex++,x=(index%2?1:-1)*Math.min(.26,L*.24),z=stand?0:W*.14,a=assembly(owner,row,equipmentId,d.title,[x,top+(d.mechanism==='stand'?.025:stand?.0535:.0525),z],d.mechanism==='stand'?[0,0,0]:[0,0,Math.PI]);
          if(d.mechanism==='stand'){
            a.box('steel',[0,0,0],[.44,.05,.28]);for(const xx of [-.14,.14])a.cylinder('plastic',[xx,.04,0],.07,.03);a.persist({representation:'bench-mounted-tool-parking-stand',support:'native-bench'});continue;
          }
          a.native(equipmentId,{length:.24,width:stand?.14:.20,height:.24});
          // The inverted flange seats directly in a dock whose base rests on
          // the host surface. The tool's working end points up, clear of it.
          if(!stand){a.cylinder('plastic',[0,.035,0],.075,.035);a.cylinder('steel',[0,.053,0],.038,.02);}
          a.persist({representation:'parked-native-tool-in-locating-nest',support:'flange-locating-nest-on-native-bench'});continue;
        }
        if(equipmentId==='equipment.machine.fixture'){
          const a=assembly(owner,row,equipmentId,'Mordaza y sujeción sobre el banco',[-L*.15,top+.09,0]);a.native(equipmentId,{length:.5,width:.34,height:.22,tabletop:true},node=>!['frame'].includes(node.parent&&node.parent.userData.equipmentPartRole));a.persist({representation:'native-fixture-jaws-and-workplate-on-bench',support:'native-bench'});continue;
        }
        if(equipmentId==='equipment.machine.vibratory-feeder'){
          const a=assembly(owner,row,equipmentId,'Alimentador vibratorio sobre soporte',[L*.25,top+.30,-W*.22]);a.native(equipmentId,{length:.65,width:.5,height:.6,tabletop:true});for(const x of [-.2,.2])for(const z of [-.15,.15])a.box('steel',[x,-.22,z],[.05,.16,.05]);a.persist({representation:'bench-mounted-native-vibratory-feeder',support:'native-bench'});continue;
        }
        if(equipmentId==='equipment.transport.stops-guides'||equipmentId==='equipment.transport.pusher'){
          const a=assembly(owner,row,equipmentId,equipmentId.endsWith('pusher')?'Desviador neumático montado al bastidor':'Guías laterales y tope del transportador');
          for(const sign of [-1,1]){a.box('steel',[0,.12,sign*(W/2+.025)],[Math.max(.5,L-.12),.045,.035]);for(const x of [-L*.3,L*.3])a.box('steel',[x,.035,sign*(W/2+.025)],[.035,.16,.045]);}
          if(equipmentId.endsWith('pusher')){a.cylinder('steel',[0,.13,-W/2-.2],.045,.28,'z');a.box('aluminum',[0,.13,-W/2+.08],[.4,.19,.025]);a.tube('rubber',[[.03,.12,-W/2-.25],[.1,.02,-W/2-.3],[L*.2,-.06,-W/2-.1]],.007);}
          a.persist({representation:'same-conveyor-mounted-guide-and-actuator-hardware',support:'native-side-frame; no-duplicate-conveyor'});continue;
        }
        if(equipmentId==='equipment.packaging.print-apply'){
          const a=assembly(owner,row,equipmentId,'Impresora y aplicador de etiquetas junto a la máquina',[L*.12,0,0]);a.native(equipmentId,{length:1,width:W,height:1.5,tabletop:true});a.box('steel',[0,ownerFloor/2,W*.55+.2],[.12,-ownerFloor,.12]);a.box('steel',[0,ownerFloor+.03,W*.55+.2],[.45,.06,.45]);a.persist({representation:'native-printer-and-applicator-supported-on-own-column',support:'floor-base-connected-to-native-machine-frame'});continue;
        }
        if(equipmentId==='equipment.sensor.platform-scale'||equipmentId==='equipment.dock.restraint'){
          const a=assembly(owner,row,equipmentId,d.title,[L/2+.8,ownerFloor+1,-W/2]);a.native(equipmentId,{length:equipmentId.includes('scale')?1.3:1.2,width:.8,height:.25,noBuffers:true});a.persist({representation:'native-floor-supported-accessory',support:'installation-floor'});continue;
        }
        throw Error('Accesorio de hardware sin montaje explícito: '+equipmentId);
      }
      for(const accessory of row.manualAccessories||[]){
        const a=assembly(owner,row,'manual.'+accessory,accessory==='label-printer'?'Impresora manual de etiquetas':'Dispensador manual de cinta',[accessory==='label-printer'?L*.25:-L*.25,top+.03,W*.08]);
        if(accessory==='label-printer'){a.box('plastic',[0,.09,0],[.32,.18,.25]);a.box('optical',[0,.155,.128],[.12,.035,.008]);a.box('rubber',[0,.045,.128],[.24,.025,.008]);a.cylinder('plastic',[.11,.175,0],.026,.02);}
        else if(accessory==='tape-dispenser'){a.box('plastic',[0,.025,0],[.25,.05,.15]);a.cylinder('cardboard',[-.04,.11,0],.075,.07,'z');a.cylinder('plastic',[-.04,.11,0],.032,.075,'z');a.box('steel',[.105,.065,0],[.035,.045,.14]);}
        else throw Error('Accesorio manual no reconocido.');
        a.persist({representation:'bench-mounted-manual-packing-hardware',support:'native-packing-bench'});
      }
    }
    for(const bank of staticBanks.values()){
      const finish=BODY_FINISH[bank.role]||BODY_FINISH.frame,positions=bank.positions,descriptor={type:'cad',recipe:{steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:finish.color,smoothingAngle:38,attachment:{targetId:id(bank.owner),part:'frame',position:[0,0,0]},sourceData:{tool:'practice-hardware',version:1,assemblyId:plan.id+'-'+bank.row.alias,document:{format:'smarttwin.practice-equipment-hardware-bank',practiceId:plan.id,ownerAlias:bank.row.alias,parts:bank.parts.map(part=>({equipmentId:part.equipmentId,pose:part.pose,rotation:part.rotation,representation:part.representation,support:part.support}))}}};
      const object=doc.addCAD(roomId,descriptor);doc.setProperty(object,'name',bank.row.alias+' · accesorios montados · '+bank.role);doc.setTransform(object,{position:[0,0,0],scale:[1,1,1]});doc.setBehaviors(object,[Object.assign(schema.defaultBehavior('collision'),{enabled:bank.collision}),Object.assign(schema.defaultBehavior('surfaceMaterial'),finish,{wear:.14,wearType:bank.role==='steel'?'scratches':'dirt',colorMapMode:'preserve',clearcoat:0})]);
      objects.push(object);created.push(object);for(const part of bank.parts)if(!part.objectIds.includes(id(object)))part.objectIds.push(id(object));bank.row.componentObjectIds=[...new Set((bank.row.componentObjectIds||[]).concat(id(object)))];
    }
    doc.syncCADAttachments();
    return {version:1,components,connections,inventoryComponents,createdObjectIds:created.map(id),limits:'Hardware y conexiones del simulador local. No representa un PLC/escáner externo ni introduce stock, genealogía, resultados o puntuaciones.'};
  }finally{temporaryGeometry.forEach(g=>g.dispose());temporaryMaterials.forEach(m=>m.dispose());temporaryTextures.forEach(t=>t.dispose());}
}
