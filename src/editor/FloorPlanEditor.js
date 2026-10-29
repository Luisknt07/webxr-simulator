import * as THREE from 'three';
import floorSchema from '../../shared/industrialFloor.js';

const TYPES = [['walkways', 'Pasillo'], ['zones', 'Zona de trabajo'], ['bays', 'Bahía'], ['crossings', 'Paso peatonal'], ['arrows', 'Flecha'], ['labels', 'Texto en piso'], ['signs', 'Cartel']];
const clone = value => JSON.parse(JSON.stringify(value));
const rectType = type => ['walkways', 'zones', 'bays', 'crossings'].includes(type);
const textType = type => type === 'labels' || type === 'signs';
const degrees = angle => Math.round(angle * 180 / Math.PI * 1000) / 1000;

/** A bounded, serializable floor plan, with one shared text atlas. */
export default class FloorPlanEditor {
  constructor(editor) { this.editor = editor; }
  rows(plan) {
    const names = floorSchema.LABELS.concat(plan.texts || []), rows = [];
    TYPES.forEach(([type]) => (plan[type] || []).forEach(v => {
      if (rectType(type)) rows.push({type, x:(v[0]+v[2])/2, z:(v[1]+v[3])/2, width:v[2]-v[0], depth:v[3]-v[1], angle:0, text:''});
      else rows.push({type, x:v[0], z:v[1], angle:degrees(v[2]), width:type==='labels'?v[3]:.96, depth:type==='labels'?v[4]:.56, kind:type==='signs'?v[3]:1, text:textType(type)?names[v[type==='labels'?5:4]]:''});
    }));
    return rows;
  }
  descriptor(base, rows) {
    const value = {type:'industrialFloor', version:1, bounds:base.bounds.map(Number), floorY:Number(base.floorY)}, texts = [];
    TYPES.forEach(([type]) => {value[type]=[];});
    rows.forEach(row => {
      const x=Number(row.x), z=Number(row.z), width=Number(row.width), depth=Number(row.depth), angle=Number(row.angle)*Math.PI/180;
      if (!value[row.type]) throw new Error('Tipo de señalización desconocido.');
      if (rectType(row.type)) value[row.type].push([x-width/2,z-depth/2,x+width/2,z+depth/2]);
      else if (row.type==='arrows') value.arrows.push([x,z,angle]);
      else {
        const text=String(row.text).trim(); let label=floorSchema.LABELS.indexOf(text);
        if(label<0){if(!texts.includes(text))texts.push(text);label=floorSchema.LABELS.length+texts.indexOf(text);}
        value[row.type].push(row.type==='labels'?[x,z,angle,width,depth,label]:[x,z,angle,Number(row.kind),label]);
      }
    });
    if(texts.length)value.texts=texts;
    return floorSchema.normalize(value);
  }
  scope(object) { const e=this.editor; return {document:e.document,roomId:e.roomId,generation:e.projectGeneration,object}; }
  apply(plan, scope) {
    const e=this.editor;
    if (!e.active || e.loadingProject || !e.canEditDocument()) throw new Error('Abre una variante editable y entra en el editor para diseñar el piso.');
    if(e.document!==scope.document||e.roomId!==scope.roomId||e.projectGeneration!==scope.generation)throw new Error('El escenario cambió. Abre de nuevo el diseño de piso.');
    if(scope.object && e.document.getObject(scope.object.userData.editorId)!==scope.object)throw new Error('La capa ya no existe. Abre de nuevo el diseño de piso.');
    return scope.object?e.document.updateIndustrialFloorPresentation(scope.object,plan):e.document.addIndustrialFloorPresentation(e.roomId,plan);
  }
  defaultPlan() {
    const e=this.editor, root=e.document.getRoot(e.roomId); root.updateWorldMatrix(true,true);
    const floor=e.document.getObjects(e.roomId).find(o=>/suelo|piso|floor|ground/i.test(o.name||'')&&o.visible&&['box','plane'].includes((o.userData.editorDescriptor||{}).type));
    let bounds=[-10,-10,10,10],floorY=0;
    if(floor){const b=new THREE.Box3().setFromObject(floor).applyMatrix4(new THREE.Matrix4().getInverse(root.matrixWorld));if(!b.isEmpty()){bounds=[b.min.x,b.min.z,b.max.x,b.max.z];floorY=b.max.y;}}
    return floorSchema.normalize({type:'industrialFloor',version:1,bounds,floorY});
  }
  open(selected) {
    const e=this.editor;
    if(!e.active||!e.canEditDocument())return e.toast('Abre una variante editable y entra en el editor para diseñar el piso.');
    this.close();
    const object=selected&&(selected.userData.editorDescriptor||{}).type==='industrialFloor'?selected:e.document.getObjects(e.roomId).find(o=>o.visible&&(o.userData.editorDescriptor||{}).type==='industrialFloor');
    const scope=this.scope(object),base=clone(object?object.userData.editorDescriptor:this.defaultPlan()),rows=this.rows(base),previousFocus=document.activeElement;
    e.clearNavigation();
    const node=(tag,text,parent)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.appendChild(n);return n;};
    const dialog=this.dialog=node('dialog');dialog.className='ed-scene-name-dialog ed-floor-plan-dialog';dialog.setAttribute('aria-label','Diseño de piso y textos');
    const form=node('form',undefined,dialog);node('h2','Diseño de piso y textos',form);
    node('p','Adapta pasillos, zonas, flechas y nombres al tamaño de tu operación. La pintura permite colocar equipos; los carteles conservan su espacio.',form);
    const limits=node('div',undefined,form);limits.className='ed-floor-plan-bounds';const bounds=[];
    ['X mínima','Z mínima','X máxima','Z máxima','Altura del piso'].forEach((text,i)=>{const label=node('label',text,limits),input=node('input',undefined,label);input.type='number';input.step='.01';input.required=true;input.value=i<4?base.bounds[i]:base.floorY;input.setAttribute('aria-label',text);bounds.push(input);});
    const actions=node('div',undefined,form);actions.className='ed-actions';const select=node('select',undefined,actions);select.setAttribute('aria-label','Añadir señalización');
    TYPES.forEach(([value,text])=>{const option=node('option',text,select);option.value=value;});
    const add=node('button','Añadir',actions);add.type='button';
    const wrapper=node('div',undefined,form);wrapper.className='ed-floor-plan-scroll';const table=node('table',undefined,wrapper),head=node('tr',undefined,node('thead',undefined,table));
    ['Elemento','Texto','X · m','Z · m','Ancho · m','Largo · m','Giro · °',''].forEach(text=>node('th',text,head));const body=node('tbody',undefined,table);
    const error=node('p','',form);error.className='ed-error';error.setAttribute('role','status');
    const render=()=>{
      body.textContent='';
      rows.forEach((row,index)=>{
        const tr=node('tr',undefined,body);node('td',TYPES.find(t=>t[0]===row.type)[1],tr);
        ['text','x','z','width','depth','angle'].forEach(key=>{
          const input=node('input',undefined,node('td',undefined,tr));input.type=key==='text'?'text':'number';input.value=row[key];input.setAttribute('aria-label',TYPES.find(t=>t[0]===row.type)[1]+' '+(index+1)+' '+key);
          input.disabled=key==='text'?!textType(row.type):key==='angle'?rectType(row.type):['width','depth'].includes(key)?!rectType(row.type)&&row.type!=='labels':false;
          if(key==='text')input.maxLength=64;else {input.step=key==='angle'?'1':'.05';input.required=true;if(['width','depth'].includes(key))input.min='.05';}
          input.addEventListener('input',()=>{row[key]=input.value;});
        });
        const remove=node('button','Quitar',node('td',undefined,tr));remove.type='button';remove.addEventListener('click',()=>{rows.splice(index,1);render();});
      });
    };
    add.addEventListener('click',()=>{const type=select.value;if(rows.filter(r=>r.type===type).length>=floorSchema.LIMITS[type]){error.textContent='Alcanzaste el límite de este tipo de señalización.';return;}rows.push({type,x:0,z:0,width:type==='labels'?2.6:1.6,depth:type==='labels'?.55:4,angle:0,kind:1,text:textType(type)?'NUEVO TEXTO':''});error.textContent='';render();});
    const footer=node('div',undefined,form);footer.className='ed-actions';const cancel=node('button','Cancelar',footer);cancel.type='button';cancel.addEventListener('click',()=>this.close());const save=node('button','Aplicar diseño',footer);save.type='submit';save.className='ed-button primary';
    node('p','Las medidas y posiciones son locales al nivel. Puedes deshacer el diseño y guardar sus textos con el proyecto.',form).className='ed-hint';
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      try{const plan=this.descriptor({bounds:bounds.slice(0,4).map(i=>Number(i.value)),floorY:Number(bounds[4].value)},rows);const result=await e.perform(()=>this.apply(plan,scope));if(result&&this.dialog===dialog){e.select(result);this.close();}else if(!result)error.textContent='No se pudo aplicar. Revisa el aviso del editor.';}
      catch(failure){error.textContent=failure.message;}finally{save.disabled=false;}
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.code==='Escape'){event.preventDefault();this.close();}});
    this.previousFocus=previousFocus;e.ui.appendChild(dialog);render();if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');bounds[0].focus();
    return dialog;
  }
  close() {if(this.dialog){if(this.dialog.open&&this.dialog.close)this.dialog.close();this.dialog.remove();this.dialog=null;if(this.previousFocus&&this.previousFocus.focus)this.previousFocus.focus();}}
}
