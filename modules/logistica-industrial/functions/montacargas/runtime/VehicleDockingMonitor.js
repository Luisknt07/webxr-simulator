import * as THREE from 'three';
import VehicleForkCamera from './VehicleForkCamera.js';
import VehicleMissionPanel from './VehicleMissionPanel.js';
import VehicleFacilityLayout from './VehicleFacilityLayout.js';
import VehicleInspectionMode from './VehicleInspectionMode.js';

const WIDTH = 768, HEIGHT = 432;
const COLORS = {ready: '#71e6b3', near: '#f1c66c', blocked: '#ff8f93'};
const finite = value => Number.isFinite(value);
const point = value => Array.isArray(value) && value.length >= 3 && value.every(finite);
const polygon = value => Array.isArray(value) && value.length >= 3 && value.every(point);
const measure = (value, scale, suffix) => finite(value) ? (value * scale).toFixed(1) + suffix : '—';
const signed = (value, scale, suffix) => finite(value) ? (value > .00005 ? '+' : '') + (value * scale).toFixed(1) + suffix : '—';

/** Read-only contour guidance plus an optional, bounded real-camera feed. Both
 * use the runtime's physical pickup/release data and never mutate custody. */
export default class VehicleDockingMonitor {
  constructor(driving) { this.driving = driving; this.ctx = driving.ctx; this.visible = true; this.expanded = false; this.page = 'alignment'; this.lastUpdate = -Infinity; this.forkCamera = new VehicleForkCamera(driving); this.inspectionMode = new VehicleInspectionMode(); this.facilityLayout = null; this.forceLayout = false; this.mode = 'layout'; }
  static dropView(placement,snapshot={},vehicle={},blocked=false) {
    const valid=!!(placement&&placement.valid&&placement.matrix&&placement.matrix.isMatrix4&&placement.matrix.elements.every(finite)&&placement.bounds&&placement.bounds.isBox3&&!placement.bounds.isEmpty()&&[...placement.bounds.min.toArray(),...placement.bounds.max.toArray()].every(finite)&&polygon(placement.targetFootprint)&&polygon(placement.actualFootprint));
    if(!valid)return {valid:false,ready:false,severity:'blocked',stage:'target',instruction:'Selecciona una bahía o una posición de estantería compatible. El pallet sujeto no es el destino.',errors:{},supportText:'Sin confirmar'};
    const center=points=>points.reduce((p,q)=>p.map((v,i)=>v+q[i]/points.length),[0,0,0]);
    const observed=polygon(snapshot.geometry&&snapshot.geometry.target)&&snapshot.geometry.target;
    const sameGeometry=observed&&observed.every(p=>placement.targetFootprint.some(q=>Math.hypot(...p.slice(0,3).map((v,i)=>v-q[i]))<.08));
    const matches=!!(placement.snapshotMatches&&placement.exactSlotMatch&&snapshot.phase==='drop'&&snapshot.destination&&snapshot.destination.id===placement.targetId&&sameGeometry);
    const errors=placement.errors||{},support=placement.support||{},completeSupport=!Number.isInteger(support.count)||support.count===(support.total||4);
    const ready=!!(!blocked&&Math.abs(vehicle.actualSpeed||0)<=.06&&vehicle.powered!==false&&vehicle.running!==false&&!vehicle.paused&&!vehicle.emergency&&placement.admissible&&placement.physicallyReady&&matches&&snapshot.ready&&completeSupport);
    let instruction=placement.instruction||placement.reason||snapshot.reason||'Alinea el pallet con el contorno y baja lentamente hasta que el apoyo se confirme.';
    if(blocked)instruction='Controles bloqueados: cierra el menú o reanuda la simulación.';
    else if(Math.abs(vehicle.actualSpeed||0)>.06)instruction='Frena y detén el montacargas antes de depositar la carga.';
    else if(ready)instruction='Apoyo y destino confirmados. Pulsa K / Depositar; después retira lentamente ambas horquillas.';
    else if(!completeSupport)instruction='Baja y nivela la carga: todavía no se confirman las cuatro zonas de apoyo.';
    else if(placement.physicallyReady&&!matches)instruction='La lectura física no coincide con la posición seleccionada. Conserva la carga y vuelve a comprobar el destino.';
    return {valid:true,ready,severity:ready?'ready':placement.admissible||placement.canAlign?'near':'blocked',stage:ready?'release':placement.stage||'align',instruction,errors,
      supportText:Number.isInteger(support.count)?support.count+'/'+(support.total||4)+' zonas':ready?'Validado por el sistema':'Sin confirmar',placement};
  }
  get cameraEnabled() { return this.forkCamera.enabled && this.cameraSupported; }
  toggleCamera() { if (!this.cameraSupported) return false; const enabled = this.forkCamera.setEnabled(this.forceLayout || !this.forkCamera.enabled); this.forceLayout = false; this.update(true); return enabled; }
  toggleRearView() { if (!this.cameraSupported || this.driving.blocked()) return false; this.forceLayout = false; this.forkCamera.setEnabled(true); const rear = this.forkCamera.toggleRearView(); this.update(true); return rear; }
  guidance() { return this.driving.holographicGuide || null; }
  applyHologramState(value) {
    const guide=this.guidance();
    if(guide&&typeof guide.setEnabled==='function'&&guide.enabled!==!!value)guide.setEnabled(!!value);
    if(this.driving.frontVisibility)this.driving.frontVisibility.update();
    return !!(guide&&guide.enabled);
  }
  resetAssistance() {this.inspectionMode.reset();return this.applyHologramState(false);}
  toggleHologramPreference() {
    const guide=this.guidance();if(!guide||this.driving.blocked())return false;
    return this.applyHologramState(this.inspectionMode.setHologramOverride(!guide.enabled));
  }
  guidanceModel() {
    const guide = this.guidance(), model = guide && guide.getState ? guide.getState() : null;
    const record = this.driving.record(), vehicle = record && record.components.vehicle, next = this.driving.nextStep;
    // Vehicle readiness takes priority over spatial coaching. A marker can be
    // visible while the motor, parking brake or emergency still prevents work.
    const priority = vehicle && (!vehicle.powered || !vehicle.running || vehicle.paused || vehicle.parkingBrake || vehicle.emergency || vehicle.blocked || vehicle.missionObstacle || vehicle.towedBy || finite(vehicle.batteryPercent) && vehicle.batteryPercent <= 0);
    if (model && next && (priority || this.driving.blocked())) return Object.assign({}, model, {title: next.title || model.title, instruction: [next.instruction, next.control && 'Mando: ' + next.control].filter(Boolean).join(' · ')});
    return model;
  }
  toggleHologram() {
    const guide = this.guidance(); if (!guide || this.driving.blocked()) return false;
    if (this.driving.command) this.driving.command('holographicGuide'); else this.toggleHologramPreference();
    this.update(true); return guide.enabled;
  }
  renderBefore(scene, delta) { return this.forkCamera.renderBefore(scene, delta); }
  postRender() { const result=this.forkCamera.postRender();this.updateCameraFallback();return result; }
  mount() {
    this.unmount(); const dom = this.driving.document;
    if (!dom || !dom.createElement) return;
    this.canvas = dom.createElement('canvas'); this.canvas.width = WIDTH; this.canvas.height = HEIGHT;
    this.canvas.setAttribute('aria-label', 'Plano de alineación de horquillas y pallet');
    this.context = this.canvas.getContext && this.canvas.getContext('2d'); if (!this.context) return;
    this.element = dom.createElement('section'); this.element.className = 'vehicle-docking-monitor vehicle-navigation-display'; this.element.dataset.vehicleDockingMonitor = '';
    this.expanded=false;this.element.dataset.expanded='false';
    this.element.setAttribute('aria-label', 'Plano de instalación e inspección de carga');
    this.navigationHeader = dom.createElement('div'); this.navigationHeader.className = 'vehicle-navigation-header';
    this.navigationTitle = dom.createElement('strong'); this.navigationTitle.className = 'vehicle-navigation-title';
    this.navigationActions = dom.createElement('div'); this.navigationActions.className = 'vehicle-navigation-actions';
    this.navigationHeader.appendChild(this.navigationTitle); this.navigationHeader.appendChild(this.navigationActions);
    this.summary = dom.createElement('p'); this.summary.className = 'vehicle-docking-summary'; this.summary.setAttribute('aria-live', 'polite');
    this.coach = dom.createElement('p'); this.coach.className = 'vehicle-guidance-instruction'; this.coach.setAttribute('aria-live', 'polite');
    this.metrics = dom.createElement('p'); this.metrics.className = 'vehicle-docking-metrics'; this.metrics.setAttribute('aria-label', 'Medidas físicas de alineación');
    this.guidanceBar = dom.createElement('div'); this.guidanceBar.className = 'vehicle-guidance-controls';
    this.guidancePanel = dom.createElement('section'); this.guidancePanel.className = 'vehicle-guidance-panel'; this.guidancePanel.dataset.vehicleGuidancePanel = ''; this.guidancePanel.setAttribute('aria-label', 'Objetivos de carga y descarga');
    this.missionPanel = new VehicleMissionPanel(dom, {expanded: !!(dom.defaultView && dom.defaultView.innerWidth >= 1440 && dom.defaultView.innerHeight >= 800 && !this.ctx.vrMode)}); this.trainingPanel = this.missionPanel.mount();
    this.hologramButton = dom.createElement('button'); this.hologramButton.type = 'button'; this.hologramButton.textContent = 'Holograma · Shift+G'; this.hologramButton.dataset.vehicleHolographicGuide = '';
    this.targetLabel = dom.createElement('label'); this.targetLabel.className = 'vehicle-guidance-target'; this.targetLabel.textContent = 'Objetivo';
    this.targetSelect = dom.createElement('select'); this.targetSelect.dataset.vehicleGuidanceTarget = ''; this.targetSelect.setAttribute('aria-label', 'Lugar donde recoger o descargar el pallet'); this.targetLabel.appendChild(this.targetSelect);
    this.guidanceBar.appendChild(this.hologramButton); this.guidanceBar.appendChild(this.targetLabel);
    this.body = dom.createElement('div'); this.body.className = 'vehicle-docking-body';
    this.plan = dom.createElement('section'); this.plan.className = 'vehicle-docking-plan'; this.plan.setAttribute('aria-label', 'Plano compacto de alineación'); this.plan.appendChild(this.canvas);
    this.feed = dom.createElement('section'); this.feed.className = 'vehicle-fork-camera'; this.feed.dataset.vehicleForkCamera = '';
    const header = dom.createElement('div'); header.className = 'vehicle-fork-camera-header';
    this.cameraButton = dom.createElement('button'); this.cameraButton.type = 'button'; this.cameraButton.textContent = 'Cámara horquillas · C'; this.cameraButton.dataset.vehicleForkCameraToggle = '';
    this.sideButton = dom.createElement('button'); this.sideButton.type = 'button'; this.sideButton.textContent = 'Cambiar lado · Shift+N'; this.sideButton.dataset.vehicleForkCameraSide = '';
    this.cameraModeButton = dom.createElement('button'); this.cameraModeButton.type = 'button'; this.cameraModeButton.textContent = 'Vista: Isométrica'; this.cameraModeButton.dataset.vehicleForkCameraMode = '';
    this.planButton = dom.createElement('button'); this.planButton.type = 'button'; this.planButton.className = 'vehicle-navigation-plan-toggle'; this.planButton.textContent = 'Plano'; this.planButton.dataset.vehicleDockingPlanToggle = ''; this.planVisible = true;
    this.rearButton = dom.createElement('button'); this.rearButton.type = 'button'; this.rearButton.dataset.vehicleRearViewToggle = ''; this.rearButton.textContent = 'Retrovisor · Shift+R';
    this.expandButton=dom.createElement('button');this.expandButton.type='button';this.expandButton.className='vehicle-navigation-expand';this.expandButton.dataset.vehicleNavigationExpand='';this.expandButton.textContent='⛶ Ampliar';this.expandButton.setAttribute('aria-expanded','false');this.expandButton.setAttribute('aria-label','Ampliar plano o cámara de inspección');
    this.feedViewport = dom.createElement('div'); this.feedViewport.className = 'vehicle-fork-camera-viewport'; this.feedViewport.dataset.vehicleForkCameraViewport = ''; this.feedViewport.setAttribute('aria-label', 'Cámara real de inspección de horquillas y pallet');
    this.cameraViews = dom.createElement('div'); this.cameraViews.className = 'vehicle-camera-views'; this.cameraViews.appendChild(this.feedViewport);
    this.cameraFallback=dom.createElement('div');this.cameraFallback.className='vehicle-camera-fallback';this.cameraFallback.hidden=true;
    this.cameraFallbackLabel=dom.createElement('p');this.cameraFallbackLabel.className='vehicle-camera-fallback-label';
    this.cameraFallbackCanvas=dom.createElement('canvas');this.cameraFallbackCanvas.width=WIDTH;this.cameraFallbackCanvas.height=HEIGHT;this.cameraFallbackCanvas.setAttribute('aria-label','Guía de apoyo mientras se prepara la imagen real');
    this.cameraFallbackContext=this.cameraFallbackCanvas.getContext&&this.cameraFallbackCanvas.getContext('2d');this.cameraFallback.appendChild(this.cameraFallbackLabel);this.cameraFallback.appendChild(this.cameraFallbackCanvas);this.feedViewport.appendChild(this.cameraFallback);
    this.rear = dom.createElement('section'); this.rear.className = 'vehicle-rear-camera'; this.rear.setAttribute('aria-label', 'Retrovisor trasero');
    const rearTitle = dom.createElement('span'); rearTitle.className = 'vehicle-rear-camera-label'; rearTitle.textContent = 'RETROVISOR';
    this.rearViewport = dom.createElement('div'); this.rearViewport.className = 'vehicle-rear-camera-viewport'; this.rearViewport.dataset.vehicleRearCameraViewport = ''; this.rearViewport.setAttribute('aria-label', 'Imagen real trasera reflejada');
    this.rear.appendChild(rearTitle); this.rear.appendChild(this.rearViewport); this.rear.hidden = true;
    this.navigationActions.appendChild(this.cameraButton); this.navigationActions.appendChild(this.planButton); this.navigationActions.appendChild(this.rearButton);this.navigationActions.appendChild(this.expandButton);
    header.appendChild(this.cameraModeButton); header.appendChild(this.sideButton); this.feed.appendChild(header); this.feed.appendChild(this.cameraViews);
    this.cameraClick = () => { if (!this.driving.blocked()) this.toggleCamera(); };
    this.sideClick = () => { if (!this.driving.blocked()) {this.forkCamera.switchSide(); this.update(true);} };
    this.cameraModeClick = () => { if (!this.driving.blocked()) { this.forkCamera.toggleMode(); this.update(true); } };
    this.planClick = () => { if (!this.driving.blocked()) { this.forceLayout = !this.forceLayout; this.update(true); } };
    this.rearClick = () => this.toggleRearView(); this.rearButton.addEventListener('click', this.rearClick);
    this.cameraButton.addEventListener('click', this.cameraClick); this.sideButton.addEventListener('click', this.sideClick);
    this.cameraModeButton.addEventListener('click', this.cameraModeClick);
    this.planButton.addEventListener('click', this.planClick);
    this.expandClick=()=>this.setExpanded(!this.expanded);this.expandButton.addEventListener('click',this.expandClick);
    this.navigationKey=event=>{if(event.key==='Escape'&&this.expanded){if(event.stopPropagation)event.stopPropagation();this.setExpanded(false);}};this.element.addEventListener('keydown',this.navigationKey);
    this.hologramClick = () => this.toggleHologram(); this.hologramButton.addEventListener('click', this.hologramClick);
    this.targetChange = () => {const guide = this.guidance(); if (!guide || this.driving.blocked()) return; guide.setTarget(this.targetSelect.value); if (this.driving.resetInput) this.driving.resetInput(); if (this.driving.updateGuide) this.driving.updateGuide(true); if (this.driving.updateHUD) this.driving.updateHUD(); this.update(true);}; this.targetSelect.addEventListener('change', this.targetChange);
    this.body.appendChild(this.plan); this.body.appendChild(this.feed); this.element.appendChild(this.navigationHeader); this.element.appendChild(this.body); this.element.appendChild(this.summary); this.element.appendChild(this.metrics);
    this.guidancePanel.appendChild(this.trainingPanel); this.guidancePanel.appendChild(this.guidanceBar); this.guidancePanel.appendChild(this.coach);
    this.panels = dom.createElement('div'); this.panels.className = 'vehicle-operation-panels'; this.panels.id = 'vehicle-operation-panels';
    this.operatorColumn = dom.createElement('div'); this.operatorColumn.className = 'vehicle-operator-column';
    this.operatorColumn.appendChild(this.guidancePanel);
    // Keep the existing console and its commands; the shared layout only owns
    // placement while seated, so objectives cannot overlap the controls.
    if (this.driving.hud) this.operatorColumn.appendChild(this.driving.hud);
    this.panels.appendChild(this.operatorColumn); this.panels.appendChild(this.element);
    if (dom.body) dom.body.appendChild(this.panels);
    this.click = event => {
      if (event.stopPropagation) event.stopPropagation();
      if (!this.ctx.vrMode || this.driving.blocked()) return;
      const rect = this.canvas.getBoundingClientRect && this.canvas.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      this.select((event.clientX - rect.left) * WIDTH / rect.width, (event.clientY - rect.top) * HEIGHT / rect.height);
    };
    this.canvas.addEventListener('click', this.click);
    this.stopEvent = event => { if (event.stopPropagation) event.stopPropagation(); };
    ['pointerdown', 'mousedown', 'mouseup'].forEach(type => {this.element.addEventListener(type, this.stopEvent); this.guidancePanel.addEventListener(type, this.stopEvent);});
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.encoding = THREE.sRGBEncoding; this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    this.plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(.66, .37125), new THREE.MeshBasicMaterial({map: this.texture}));
    const panelLayout = this.driving.cabPanelLayout();
    this.plane.name = 'Monitor de alineación de cargas'; this.driving.placeCabPanel(this.plane, panelLayout.alignment);
    this.plane.userData.editorRuntimeHelper = true; this.driving.seat.add(this.plane);
    const rig = this.driving.visualRoot && this.driving.visualRoot.userData.vehicleRig;
    this.cameraSupported = !!(rig && rig.forks && rig.config && !['tow', 'cart'].includes(rig.config.family));
    if (this.cameraSupported) this.forkCamera.mount({element: this.feedViewport, parent: this.driving.seat,
      planeLayout: {front: panelLayout.front, mirror: panelLayout.mirror}});
    const input = this.ctx.raycontrol;
    this.stateName = this.driving.simulation.statePrefix + 'vehicle-docking-monitor';
    this.state = {colliderMesh: this.plane, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: (hit, controller) => !!this.driving.id && !!this.ctx.vrMode && !!this.plane && this.plane.visible && !this.driving.blocked() && this.driving.panelSelectable(controller),
      onSelectStart: (hit, controller) => { if (this.state.isSelectable(hit, controller) && hit && hit.uv) this.select(hit.uv.x * WIDTH, (1 - hit.uv.y) * HEIGHT); }};
    if (input) { input.addState(this.stateName, this.state); input.activateState(this.stateName); }
    this.facilityLayout = new VehicleFacilityLayout(this.driving);
    this.inspectionMode.reset(); this.forceLayout = false; this.mode = 'layout'; this.planeMode = null; this.lastUpdate = -Infinity; this.update(true);
  }
  targetForInspection(record,data,lesson) {
    const simulation=this.driving.simulation,training=simulation.vehicleTraining,vehicle=record.components.vehicle,guide=this.guidance();
    const center=(matrix,bounds)=>bounds&&matrix?bounds.getCenter(new THREE.Vector3()).applyMatrix4(matrix).toArray():null;
    if(vehicle.entry){
      const logical=guide&&guide.getState&&guide.getState();
      if(logical&&logical.phase==='withdraw-source')return null;
      // A loaded truck is always close to its own pallet: only the actual
      // receiving position can activate the unloading camera.
      const placement=this.dropPlacement;
      if(placement&&placement.valid&&polygon(placement.targetFootprint))return {id:placement.selectionKey||placement.id,position:this.polygonCenter(placement.targetFootprint)};
      const chosen=guide&&guide.currentTarget;
      const matches= !lesson || chosen&&chosen.targetId===lesson.destinationId&&(!lesson.locationCode||chosen.locationCode===lesson.locationCode)&&(!Number.isInteger(lesson.destinationSlot)||chosen.slotIndex===lesson.destinationSlot);
      if(chosen&&chosen.allowed&&chosen.kind==='drop'&&matches)return {id:chosen.id,position:center(chosen.matrix,chosen.bounds)};
      const destination=training&&lesson&&training.destination(record);
      if(destination){const product=vehicle.entry.product;return {id:'drop:'+destination.targetId,position:center(destination.matrix,product.bounds)};}
      // Raw drop geometry can be the carried pallet when releasePlan has no
      // receiver yet. It must never activate its own proximity camera.
      return null;
    }
    if(lesson&&['complete','error','withdraw'].includes(lesson.phase))return null;
    const chosen=guide&&guide.currentTarget;
    const product=training&&lesson?training.product(lesson.productId):chosen&&chosen.kind==='pickup'&&chosen.allowed&&chosen.product||this.forkCamera.product&&this.forkCamera.product(record,data);
    if(product){product.object.updateWorldMatrix(true,false);return {id:lesson&&lesson.productId||product.record&&product.record.id||data.targetId,position:center(product.object.matrixWorld,product.bounds)};}
    if(polygon(data.geometry&&data.geometry.target))return {id:data.targetId,position:this.polygonCenter(data.geometry.target)};
    return null;
  }
  polygonCenter(points) { const p=[0,0,0];points.forEach(q=>q.forEach((v,i)=>{p[i]+=v/points.length;}));return p; }
  displayMode(record,data,lesson,available) {
    const rig=this.driving.visualRoot&&this.driving.visualRoot.userData.vehicleRig,forks=rig&&rig.forks;
    const position=forks&&forks.getWorldPosition?forks.getWorldPosition(new THREE.Vector3()).toArray():null;
    return this.inspectionMode.update({available,automatic:this.cameraEnabled&&this.visible,forceLayout:this.forceLayout,mirror:this.forkCamera.selectedFeed==='mirror',position,target:this.targetForInspection(record,data,lesson),entryId:record.components.vehicle.entry&&record.components.vehicle.entry.id||''});
  }
  select(x, y) {
    if(y>=15&&y<=57){
      if(x>=16&&x<=246){this.toggleCamera();return true;}
      if(x>=264&&x<=494){if(!this.driving.blocked()){this.forceLayout=!this.forceLayout;this.update(true);}return true;}
      if(x>=512&&x<=752){this.toggleRearView();return true;}
    }
    if (this.page === 'guide' && y >= 374 && y <= 420) {
      if (x >= 16 && x <= 208 && this.guidance()) {this.toggleHologram(); return true;}
      if (x >= 224 && x <= 454 && this.guidance() && this.guidance().nextTarget && !this.driving.blocked()) {if (this.driving.command) this.driving.command('guidanceNext'); else this.guidance().nextTarget(); this.update(true); return true;}
      if (x >= 470 && x <= 752 && this.cameraSupported && this.forkCamera.mode === 'isometric' && !this.driving.blocked()) {this.forkCamera.switchSide(); this.update(true); return true;}
    }
    return false;
  }
  toggle() { this.visible = !this.visible; this.update(true); return this.visible; }
  setExpanded(value){
    if(!this.element||this.ctx.vrMode)return false;
    this.expanded=!!value;this.element.dataset.expanded=String(this.expanded);this.expandButton.setAttribute('aria-expanded',String(this.expanded));
    this.expandButton.textContent=this.expanded?'↙ Reducir':'⛶ Ampliar';this.expandButton.setAttribute('aria-label',this.expanded?'Reducir plano para continuar conduciendo':'Ampliar plano o cámara de inspección');
    if(this.driving.resetInput)this.driving.resetInput();if(this.expanded&&this.driving.releaseCursor)this.driving.releaseCursor();this.update(true);return this.expanded;
  }
  update(force = false) {
    if (!this.element) return;
    const driving = this.driving, record = driving.record(), available = !!record && !(this.ctx.editor && this.ctx.editor.active),visible=available&&this.visible;
    this.element.hidden = !visible || !!this.ctx.vrMode;
    if (this.guidancePanel) this.guidancePanel.hidden = !visible || !!this.ctx.vrMode;
    if (this.plane) this.plane.visible = visible && !!this.ctx.vrMode && this.mode !== 'rear';
    if(!available){this.forkCamera.setAvailable(false);this.resetAssistance();return;}
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (!force && now - this.lastUpdate < 100) return; this.lastUpdate = now;
    const runtime = driving.simulation.vehicleRuntime;
    this.snapshot = (runtime && runtime.getDockingState && runtime.getDockingState(record)) || {ready: false, reason: 'Esperando datos de alineación', severity: 'blocked'};
    const data = this.snapshot, blocked = driving.blocked(),training=driving.simulation.vehicleTraining,lesson=training&&training.guidance(record);
    const dropGuide=this.guidance(),logical=dropGuide&&dropGuide.getState&&dropGuide.getState(),displayDrop=!!(record.components.vehicle.entry&&(!logical||logical.phase==='drop'));
    this.dropPlacement=displayDrop&&dropGuide&&dropGuide.getDropPlacement?dropGuide.getDropPlacement():null;
    this.dropView=displayDrop?VehicleDockingMonitor.dropView(this.dropPlacement,data,record.components.vehicle,blocked):null;
    this.mode=this.displayMode(record,data,lesson,available);
    this.applyHologramState(!blocked&&this.inspectionMode.hologram);
    this.page=this.mode==='layout'?'layout':'alignment';
    this.forkCamera.setAvailable(visible && !blocked && this.mode!=='layout');
    this.feed.hidden = this.mode==='layout'; this.cameraButton.setAttribute('aria-pressed', String(!!this.cameraEnabled));
    this.cameraButton.textContent='Cámara auto '+(this.cameraEnabled?'ON':'OFF')+' · C';
    this.cameraButton.title='La cámara aparece cerca de la recogida o del destino; durante el trayecto se muestra el plano.';
    this.navigationTitle.textContent=this.mode==='layout'?'Plano de la instalación':this.mode==='rear'?'Retrovisor':'Inspección de carga';
    this.planButton.setAttribute('aria-pressed',String(this.forceLayout));
    const rearView = this.forkCamera.selectedFeed === 'mirror';
    this.cameraModeButton.textContent = 'Vista: ' + (rearView ? 'Posterior' : {isometric: 'Isométrica', entry: 'Frontal', tips: 'Puntas'}[this.forkCamera.mode] || 'Isométrica') + ' · Shift+C';
    this.sideButton.hidden = rearView || this.forkCamera.mode !== 'isometric'; this.sideButton.textContent = 'Lado: ' + (this.forkCamera.side === 1 ? 'Der.' : 'Izq.') + ' · Shift+N';
    this.rearButton.textContent = (rearView ? 'Horquillas' : 'Retrovisor') + ' · Shift+R'; this.rearButton.setAttribute('aria-pressed', String(rearView)); this.feedViewport.setAttribute('aria-label', rearView ? 'Retrovisor real posterior reflejado' : 'Inspección real de horquillas'); this.element.dataset.feed = rearView ? 'mirror' : 'front';
    this.element.dataset.camera = this.mode!=='layout' ? 'on' : 'off'; this.element.dataset.display=this.mode;
    this.element.dataset.operation=this.dropView?'drop':'pickup';
    const showPlan = true;
    this.plan.hidden = !showPlan; this.element.dataset.plan = showPlan ? 'open' : 'closed'; this.planButton.setAttribute('aria-expanded', String(showPlan));
    this.plan.hidden=this.mode==='rear';
    if(this.planeMode!==this.mode&&this.plane){const layout=driving.cabPanelLayout();driving.placeCabPanel(this.plane,this.mode==='layout'?layout.front.position:layout.alignment);this.planeMode=this.mode;}
    if(this.plane)this.plane.visible=visible&&!!this.ctx.vrMode&&this.mode!=='rear';
    this.severity = data.ready && !blocked ? 'ready' : data.severity === 'near' && !blocked ? 'near' : 'blocked';
    let reason = blocked ? 'Controles bloqueados: cierra el menú o reanuda la simulación.' : data.reason || 'Ajusta la posición y la altura de las horquillas.';
    const guide = this.guidance(), guided = guide && guide.getState ? guide.getState() : null;
    const withdrawing = !!(guide && guided && ['withdraw', 'withdraw-source'].includes(guided.phase));
    if(withdrawing)this.element.dataset.operation='withdraw';
    if (!blocked && guide && guided && guided.explicitTarget && data.ready && !guided.targetMatchesSnapshot) {
      this.severity = 'near'; reason = 'Lectura actual: ' + (data.targetName || 'otro pallet') + '. Sigue el objetivo seleccionado: ' + (guided.targetName || 'sin confirmar') + '.';
    }
    if (withdrawing && !blocked) {
      this.severity = 'near';
      const model = this.guidanceModel();
      reason = model && model.instruction || 'Retrocede lentamente hasta retirar por completo ambas horquillas.';
    }
    if(this.dropView&&!withdrawing){this.severity=this.dropView.severity;reason=this.dropView.instruction;}
    const phase = withdrawing ? 'RETIRADA' : data.phase === 'drop' ? 'DEPÓSITO' : 'TOMA DE PALLET';
    [this.cameraButton, this.cameraModeButton, this.sideButton, this.planButton, this.rearButton].forEach(button => {button.disabled = blocked;});
    this.summary.textContent = (withdrawing ? 'RETIRADA · ' : this.severity === 'ready' ? 'LISTO · ' : this.severity === 'near' ? 'AJUSTAR · ' : 'NO DISPONIBLE · ') + reason;
    this.updateGuidance(data, blocked);
    if(this.mode==='layout'){
      const model=this.guidanceModel(),layout=this.facilityLayout.update(record,{lesson,guide:model,snapshot:data});
      if(layout&&this.element.style&&this.element.style.setProperty){const b=layout.bounds,x=Math.max(1,b.maxX-b.minX),z=Math.max(1,b.maxZ-b.minZ),aspect=Math.max(1,Math.min(2.6,Math.round(Math.max(x/z,z/x)*10)/10));if(this.mapAspect!==aspect){this.mapAspect=aspect;this.element.style.setProperty('--vehicle-layout-aspect',String(aspect));}}
      const navigation=layout&&layout.mission;
      this.summary.textContent=lesson?lesson.phase==='complete'?'Práctica completada · todas las entregas verificadas.':(lesson.phase==='pickup'?'Recoger: ':'Llevar a: ')+(lesson.phase==='pickup'?lesson.sourceLocationCode||lesson.title:lesson.locationCode||lesson.title):navigation?(navigation.phase==='pickup'?'Recoger: ':'Llevar a: ')+(navigation.locationCode||navigation.title)+(navigation.verified?'':' · referencia local, sin itinerario validado'):'Vista en tiempo real · la cámara se activa al acercarse a una carga o receptor.';
      this.metrics.hidden=true;this.element.dataset.state=layout&&layout.mission&&layout.mission.blocked?'blocked':'navigation';
      this.canvas.setAttribute('aria-label','Plano de la instalación en tiempo real. '+this.summary.textContent);
      this.paintLayout(layout);this.texture.needsUpdate=true;return;
    }
    if(this.mode==='rear'){this.summary.textContent='Retrovisor · comprueba que el recorrido esté libre.';this.metrics.hidden=true;this.element.dataset.state='navigation';}
    this.element.dataset.state = this.mode==='rear'?'navigation':this.severity; this.canvas.setAttribute('aria-label', phase + '. ' + this.summary.textContent);
    this.paint(data, phase, reason); this.texture.needsUpdate = true;
    this.updateCameraFallback();
  }
  updateGuidance(data, blocked) {
    const guide = this.guidance(), model = this.guidanceModel(), targets = guide && guide.getTargets ? guide.getTargets() : model && model.targets || [];
    const record = this.driving.record(), simulation = this.driving.simulation, training = simulation && simulation.vehicleTraining, lesson = training && training.guidance(record);
    const vehicle=record&&record.components.vehicle,interlock=vehicle&&vehicle.enabled===false&&vehicle.operatorInterlock;
    const displayedLesson=lesson&&interlock?Object.assign({},lesson,{stage:'preparation',stageTitle:interlock.title,instruction:interlock.instruction,
      hint:interlock.instruction,stages:[{id:'preparation',title:interlock.title,status:'active'}]}):lesson;
    if (this.missionPanel) this.missionPanel.update(displayedLesson, lesson ? training.tasks(record) : []);
    this.guidancePanel.dataset.training = lesson ? 'active' : 'off';
    this.guidanceBar.hidden = !guide || !this.cameraSupported && !targets.length;
    this.hologramButton.setAttribute('aria-pressed', String(!!guide && guide.enabled)); this.hologramButton.disabled = blocked || !guide;
    this.hologramButton.title = 'Automático junto a un pallet o destino, con la cámara. Shift+G alterna la transparencia manualmente hasta entrar o salir de esa zona. Las flechas de ruta siguen visibles.';
    this.hologramButton.dataset.assistanceMode=this.inspectionMode.hologramOverride===null?'auto':'manual';
    this.hologramButton.textContent = 'Holograma ' + (guide && guide.enabled ? 'ON' : 'OFF') + ' · Shift+G';
    const withdrawing = !!(guide && model && ['withdraw', 'withdraw-source'].includes(model.phase));
    const automaticText = targets.length ? 'Selección automática' : withdrawing ? 'Retira las horquillas' : 'Sin objetivo compatible';
    const signature = JSON.stringify([automaticText, targets.map(target => [target.id, target.name, target.kind, target.allowed !== false])]);
    if (signature !== this.targetSignature) {
      while (this.targetSelect.firstChild) this.targetSelect.removeChild(this.targetSelect.firstChild);
      const option = this.driving.document.createElement('option'); option.value = ''; option.textContent = automaticText; this.targetSelect.appendChild(option);
      targets.forEach(target => {const item = this.driving.document.createElement('option'); item.value = target.id; item.textContent = ((target.kind === 'drop' || target.kind === 'delivery') ? 'Descargar · ' : target.kind === 'pickup' ? 'Recoger · ' : '') + target.name + (target.allowed === false ? ' — No disponible' : ''); item.disabled = target.allowed === false; item.title = target.reason || ''; this.targetSelect.appendChild(item);});
      this.targetSignature = signature;
    }
    this.targetSelect.value = model && targets.some(target => target.id === model.targetId) ? model.targetId : '';
    this.targetSelect.disabled = blocked || !guide || !targets.length || !!lesson;
    const distance = model && finite(model.distanceM) ? ' · ' + model.distanceM.toFixed(1) + ' m' : '';
    const bearing = model && model.bearingText ? ' · ' + model.bearingText : '';
    this.coach.hidden = !model; this.coach.textContent = model ? (model.targetName ? model.targetName + distance + bearing + ' — ' : '') + (model.instruction || model.title || '') : '';
    if(this.dropView){
      const view=this.dropView,e=view.errors;this.metrics.hidden=false;this.metrics.dataset.kind='drop';
      this.metrics.textContent='Lateral '+signed(e.lateralM,100,' cm')+' · Fondo '+signed(e.longitudinalM,100,' cm')+' · Altura '+signed(e.verticalM,100,' cm')+' · Giro '+signed(e.yawRad,180/Math.PI,'°')+' · Apoyo: '+view.supportText;
      this.metrics.title='Desvíos respecto al destino: positivo a la derecha, al fondo, por encima del apoyo y en sentido horario.';
      return;
    }
    this.metrics.dataset.kind='pickup';this.metrics.title='';const errors = data.errors || {}, insertion = data.insertion || {};
    this.metrics.hidden = false;
    this.metrics.textContent = 'Lateral ' + measure(errors.lateralM, 100, ' cm') + ' · Altura ' + measure(errors.verticalM, 100, ' cm') + ' · Ángulo ' + measure(errors.yawRad, 180 / Math.PI, '°') + ' · Inserción ' + measure(insertion.actualM, 100, ' cm') + ' / ' + measure(insertion.requiredM, 100, ' cm');
  }
  paintScreenActions(c) {
    const labels = ['CÁMARA AUTO ' + (this.cameraEnabled ? 'ON' : 'OFF'), 'PLANO', this.forkCamera.selectedFeed === 'mirror' ? 'HORQUILLAS' : 'RETROVISOR'];
    labels.forEach((label,index)=>{const x=16+index*248;c.fillStyle=index===0&&this.cameraEnabled?'#226856':'#294551';c.fillRect(x,15,230,42);c.fillStyle='#eff8fa';c.font='bold 20px sans-serif';c.fillText(label,x+12,43);});
  }
  paintLayout(model) {
    const c=this.context;
    let width=WIDTH,height=HEIGHT;
    const win=this.canvas.ownerDocument&&this.canvas.ownerDocument.defaultView;
    if(!this.ctx.vrMode&&win){
      const rect=this.canvas.getBoundingClientRect();
      if(rect.width>0&&rect.height>0){const dpr=Math.max(1,Math.min(2,win.devicePixelRatio||1));width=Math.max(480,Math.min(1400,Math.round(rect.width*dpr)));height=Math.max(150,Math.min(1000,Math.round(width*rect.height/rect.width)));}
    }
    // Match the actual expanded/compact slot at a bounded device resolution.
    // Unlike CSS stretching, one metric scale preserves every pallet and aisle.
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
    if(this.ctx.vrMode&&c.save&&c.translate){
      c.fillStyle='#0b1d28';c.fillRect(0,0,WIDTH,HEIGHT);this.paintScreenActions(c);
      c.save();c.translate(0,66);try{this.facilityLayout.paint(c,WIDTH,HEIGHT-66,model);}finally{c.restore();}
    }else this.facilityLayout.paint(c,width,height,model);
  }
  paint(data, phase, reason) {
    if(this.dropView&&phase!=='RETIRADA'){this.paintDrop(this.context,this.dropPlacement,this.dropView,{width:WIDTH,height:this.ctx.vrMode?HEIGHT:WIDTH,store:true});return;}
    const c=this.context,accent=COLORS[this.severity],xr=!!this.ctx.vrMode;
    if(this.canvas.width!==WIDTH)this.canvas.width=WIDTH;
    if(this.canvas.height!==HEIGHT)this.canvas.height=HEIGHT;
    c.fillStyle='#0b1d28';c.fillRect(0,0,WIDTH,HEIGHT);
    if(xr)this.paintScreenActions(c);
    c.fillStyle=accent;c.font='bold 32px sans-serif';
    c.fillText(phase==='RETIRADA'?'RETIRADA':(data.phase==='drop'?'DEPÓSITO':'TOMA')+' · '+(this.severity==='ready'?'LISTO':this.severity==='near'?'AJUSTAR':'REVISAR'),20,xr?100:40);
    if(!c.beginPath)return;
    // The diagram has its own column. Large contours replace the tiny nested
    // dashboard; desktop measurements live below both views, never over them.
    const area={x:18,y:xr?112:62,w:WIDTH-36,h:xr?242:330};
    c.fillStyle='#132b37';c.fillRect(area.x,area.y,area.w,area.h);
    this.paintContours(c,data.geometry||{},area);
    c.fillStyle='#bdd2d9';c.font='22px sans-serif';
    c.fillText('PLANO DE INSERCIÓN · frente ↑',26,xr?343:417);
    if(xr){
      const e=data.errors||{},i=data.insertion||{};c.fillStyle=accent;c.font='bold 23px sans-serif';
      this.text(c,'Lateral '+measure(e.lateralM,100,' cm')+' · Altura '+measure(e.verticalM,100,' cm')+' · Ángulo '+measure(e.yawRad,180/Math.PI,'°'),20,385,WIDTH-40);
      c.fillStyle='#d6e8ed';c.font='21px sans-serif';this.text(c,'Inserción '+measure(i.actualM,100,' cm')+' / '+measure(i.requiredM,100,' cm'),20,418,WIDTH-40);
    }
  }
  updateCameraFallback(){
    if(!this.cameraFallback||!this.feed)return;
    let current=true;try{if(this.forkCamera.hasCurrentFrame)current=this.forkCamera.hasCurrentFrame();}catch(_){current=false;}
    this.cameraFallback.hidden=this.feed.hidden||current;this.element.dataset.frame=current?'ready':this.forkCamera.failed?'unavailable':'pending';
    if(this.cameraFallback.hidden)return;
    const rear=this.mode==='rear',label=rear?'Retrovisor no disponible · comprueba el entorno':this.forkCamera.failed?'Cámara no disponible · usa el plano de apoyo':'Vista de apoyo · preparando la cámara real';
    if(this.cameraFallbackLabel.textContent!==label)this.cameraFallbackLabel.textContent=label;
    if(!this.cameraFallbackContext)return;
    if(this.fallbackPaintModel===this.dropPlacement&&this.fallbackPaintSnapshot===this.snapshot&&this.fallbackPaintMode===this.mode)return;
    this.fallbackPaintModel=this.dropPlacement;this.fallbackPaintSnapshot=this.snapshot;this.fallbackPaintMode=this.mode;
    const c=this.cameraFallbackContext;
    if(!rear&&this.dropView)this.paintDrop(c,this.dropPlacement,this.dropView,{width:WIDTH,height:HEIGHT});
    else{c.fillStyle='#102b35';c.fillRect(0,0,WIDTH,HEIGHT);c.fillStyle='#d4e9ed';c.font='bold 28px sans-serif';this.text(c,label,24,55,WIDTH-48,34,2);if(!rear&&c.beginPath)this.paintContours(c,this.snapshot&&this.snapshot.geometry||{},{x:20,y:110,w:WIDTH-40,h:280});}
  }
  paintDrop(c,placement,view,{width=WIDTH,height=WIDTH,store=false}={}){
    const canvas=store?this.canvas:this.cameraFallbackCanvas;
    if(canvas){if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;}
    c.fillStyle='#0b1f29';c.fillRect(0,0,width,height);const accent=COLORS[view.severity]||COLORS.blocked,offset=store&&this.ctx.vrMode?66:0;
    if(offset)this.paintScreenActions(c);
    c.fillStyle=accent;c.font='bold 30px sans-serif';this.text(c,'DESCARGA · '+(view.ready?'APOYO CONFIRMADO':'ALINEAR Y APOYAR'),20,38+offset,width-40);
    c.fillStyle='#c8dfe4';c.font='22px sans-serif';this.text(c,placement&&(placement.locationCode||placement.targetName)||'Ubicación seleccionada',20,70+offset,width-40);
    if(!c.beginPath)return;
    if(!view.valid||!placement||!placement.matrix||!placement.bounds){c.fillStyle='#d5e5e9';c.font='25px sans-serif';this.text(c,view.instruction,26,132+offset,width-52,34,5);if(store)this.dropProjection=null;return;}
    const target=placement.targetFootprint,actual=placement.actualFootprint,origin=new THREE.Vector3();target.forEach(p=>origin.add(new THREE.Vector3().fromArray(p)));origin.multiplyScalar(1/target.length);
    const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(placement.matrix)).inverse();
    const local=p=>new THREE.Vector3().fromArray(p).sub(origin).applyQuaternion(rotation),top=p=>{const q=local(p);return[q.x,-q.z];},side=p=>[local(p).z,p[1]-origin.y];
    const boxPoints=matrix=>{const points=[];for(const x of [placement.bounds.min.x,placement.bounds.max.x])for(const y of [placement.bounds.min.y,placement.bounds.max.y])for(const z of [placement.bounds.min.z,placement.bounds.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(matrix).toArray());return points;};
    const desiredBox=boxPoints(placement.matrix),actualMatrix=placement.actualMatrix||placement.load&&placement.load.matrix,actualBox=actualMatrix&&actualMatrix.isMatrix4?boxPoints(actualMatrix):actual;
    const stacked=height>width*.8,areas=stacked?{top:{x:20,y:116,w:width-40,h:290},side:{x:20,y:475,w:width-40,h:210}}:{top:{x:20,y:112+offset,w:430,h:258-offset},side:{x:474,y:112+offset,w:274,h:258-offset}};
    const fit=(groups,transform,area)=>{const values=groups.flatMap(points=>points.map(transform));let minX=Math.min(...values.map(p=>p[0])),maxX=Math.max(...values.map(p=>p[0])),minY=Math.min(...values.map(p=>p[1])),maxY=Math.max(...values.map(p=>p[1]));const cx=(minX+maxX)/2,cy=(minY+maxY)/2,rangeX=Math.max(.6,maxX-minX)*1.2,rangeY=Math.max(.35,maxY-minY)*1.25,scale=Math.min((area.w-44)/rangeX,(area.h-44)/rangeY);return{area,scale,screen:p=>{const q=transform(p);return[area.x+area.w/2+(q[0]-cx)*scale,area.y+area.h/2+(q[1]-cy)*(transform===side?-scale:scale)];}};};
    const plan=fit([target,actual],top,areas.top),elevation=fit([desiredBox,actualBox],side,areas.side);
    const trace=(points,projection,fill,stroke,dashed=false)=>{if(!points.length)return;if(c.setLineDash)c.setLineDash(dashed?[10,7]:[]);c.beginPath();points.map(projection.screen).forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();c.fillStyle=fill;c.strokeStyle=stroke;c.lineWidth=4;c.fill();c.stroke();if(c.setLineDash)c.setLineDash([]);};
    const hull=points=>{const values=points.map(side).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),lower=[],upper=[];for(const p of values){while(lower.length>1&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}for(const p of values.slice().reverse()){while(upper.length>1&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}return lower.slice(0,-1).concat(upper.slice(0,-1));};
    for(const [key,text]of [['top','VISTA SUPERIOR · receptor'],['side','VISTA LATERAL · altura y apoyo']]){const a=areas[key];c.fillStyle='#15323e';c.fillRect(a.x,a.y,a.w,a.h);c.fillStyle='#cce5e8';c.font='bold 24px sans-serif';this.text(c,text,a.x,a.y-12,a.w);}
    trace(target,plan,'rgba(42,130,160,.16)','#6ad4e8',true);trace(actual,plan,'rgba(224,166,76,.28)','#ffd184');
    const sideTrace=(points,fill,stroke,dashed)=>{const values=hull(points),toWorld=values.map(p=>{const q=new THREE.Vector3(0,0,p[0]).applyQuaternion(rotation.clone().inverse()).add(origin);q.y=origin.y+p[1];return q.toArray();});trace(toWorld,elevation,fill,stroke,dashed);};
    sideTrace(desiredBox,'rgba(42,130,160,.10)','#6ad4e8',true);sideTrace(actualBox,'rgba(224,166,76,.22)','#ffd184');
    const corners=placement.support&&placement.support.corners||[];
    actual.forEach((p,index)=>{const support=corners[index],at=plan.screen(support&&point(support.point)?support.point:p);c.fillStyle=support&&support.contact===true?'#79e9b3':support&&support.contact===false?'#f4b55c':'#c8d7df';c.beginPath();if(c.arc)c.arc(at[0],at[1],8,0,Math.PI*2);else c.rect?c.rect(at[0]-7,at[1]-7,14,14):c.fillRect(at[0]-7,at[1]-7,14,14);c.fill();c.fillStyle='#e9f5f5';c.font='bold 20px sans-serif';c.fillText(String(index+1),at[0]+11,at[1]-10);});
    c.fillStyle='#bdd9df';c.font='22px sans-serif';this.text(c,'Cian: ubicación · Ámbar: carga actual',20,height-26,width-40);
    if(store)this.dropProjection={origin:origin.toArray(),top:plan,side:elevation};
  }
  paintContours(c, geometry, area) {
    const frame = geometry.frame || {}, origin = point(frame.position) ? frame.position : [0, 0, 0], yaw = finite(frame.yaw) ? frame.yaw : 0;
    // +Z is vehicle forward and the seated operator's right is -X.
    const local = p => { const dx = p[0] - origin[0], dz = p[2] - origin[2]; return [-dx * Math.cos(yaw) + dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw)]; };
    const groups = [
      {polys: [geometry.chassis].filter(polygon), fill: '#365462', stroke: '#9ab5c0', width: 2},
      {polys: [geometry.target].filter(polygon), fill: '#765f36', stroke: COLORS[this.severity], width: 3},
      {polys: (geometry.pockets || []).filter(polygon), fill: '#091b24', stroke: '#ffd78c', width: 2},
      {polys: (geometry.forks || []).filter(polygon), fill: '#c0d0da', stroke: '#f0f7fa', width: 2}
    ];
    const points = groups.flatMap(group => group.polys.flatMap(poly => poly.map(local)));
    if (!points.length) { c.fillStyle = '#a8c4ce'; c.font = '18px sans-serif'; c.fillText('Sin geometría de acoplamiento', area.x + 34, area.y + area.h / 2); return; }
    let minX = -1, maxX = 1, minY = -.5, maxY = .5;
    points.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    const scale = Math.min((area.w - 50) / (maxX - minX), (area.h - 50) / (maxY - minY));
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const screen = p => { const q = local(p); return [area.x + area.w / 2 + (q[0] - centerX) * scale, area.y + (area.h - 20) / 2 + (q[1] - centerY) * scale]; };
    this.projection = {origin: origin.slice(), yaw, scale, screen};
    c.strokeStyle = '#284954'; c.lineWidth = 1;
    for (let xx = Math.ceil(minX * 2) / 2; xx <= maxX; xx += .5) { const x = area.x + area.w / 2 + (xx - centerX) * scale; c.beginPath(); c.moveTo(x, area.y + 10); c.lineTo(x, area.y + area.h - 25); c.stroke(); }
    groups.forEach(group => group.polys.forEach(poly => { c.beginPath(); poly.map(screen).forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = group.fill; c.strokeStyle = group.stroke; c.lineWidth = group.width; c.fill(); c.stroke(); }));
    const base = screen(origin); c.strokeStyle = '#80ddcf'; c.lineWidth = 2; c.beginPath(); c.moveTo(base[0], base[1]); c.lineTo(base[0], base[1] - 26); c.lineTo(base[0] - 5, base[1] - 19); c.moveTo(base[0], base[1] - 26); c.lineTo(base[0] + 5, base[1] - 19); c.stroke();
    const ruler = .5 * scale; c.strokeStyle = '#bdd2d9'; c.beginPath(); c.moveTo(area.x + 12, area.y + area.h - 38); c.lineTo(area.x + 12 + ruler, area.y + area.h - 38); c.stroke(); c.fillStyle = '#bdd2d9'; c.font = '14px sans-serif'; c.fillText('0.5 m', area.x + 12, area.y + area.h - 43);
  }
  paintGuide(c) {
    const guide = this.guidance(), model = this.guidanceModel();
    if (model) {
      c.fillStyle = '#e5f8f3'; c.font = 'bold 25px sans-serif'; this.text(c, model.title || 'Guía de carga y descarga', 25, 100, WIDTH - 50);
      c.font = '22px sans-serif'; this.text(c, model.instruction || '', 25, 138, WIDTH - 50, 27, 3);
      c.fillStyle = '#a9d5ce'; c.font = '20px sans-serif'; this.text(c, model.targetName ? 'Objetivo: ' + model.targetName + (finite(model.distanceM) ? ' · ' + model.distanceM.toFixed(1) + ' m' : '') + (model.bearingText ? ' · ' + model.bearingText : '') : 'Selecciona una carga o un receptor compatible.', 25, 234, WIDTH - 50, 24, 2);
      c.fillStyle = '#c0d2d9'; c.font = '19px sans-serif'; this.text(c, 'Agarrar volante: alinear · Palancas: ajustar altura y alcance.', 25, 299, WIDTH - 50);
      this.text(c, model.routeNote || 'Orientación local: comprueba que el pasillo esté libre.', 25, 335, WIDTH - 50);
      c.fillStyle = guide.enabled ? '#215b50' : '#294551'; c.fillRect(16, 374, 192, 46); c.fillStyle = '#eff8fa'; c.font = 'bold 17px sans-serif'; c.fillText(guide.enabled ? 'HOLOGRAMA ON' : 'HOLOGRAMA OFF', 31, 403);
      c.fillStyle = '#294551'; c.fillRect(224, 374, 230, 46); c.fillStyle = '#eff8fa'; c.fillText('SIGUIENTE OBJETIVO', 239, 403);
      if (this.cameraSupported && this.forkCamera.mode === 'isometric') {c.fillStyle = '#294551'; c.fillRect(470, 374, 282, 46); c.fillStyle = '#eff8fa'; c.fillText('CAMBIAR LADO ISOMÉTRICO', 482, 403);}
      return;
    }
    const rows = this.ctx.vrMode ? ['1 · Agarra el volante para alinear ambas horquillas.', '2 · Usa las palancas de altura e inclinación con agarre.', '3 · Detente: verde confirma la validación real.', '4 · Pulsa Tomar / Depositar en el tablero de la cabina.', 'VISTA alterna Isométrica / Frontal / Puntas.', 'El retrovisor muestra detrás; la vista del visor permanece libre.'] : ['1 · A / D: alinea ambas horquillas con los huecos.', '2 · Q / E: altura · R / T: inclinación · W / S: aproximar.', '3 · Espacio: frena; verde confirma el apoyo real.', '4 · G: tomar · Shift+K: preparar depósito · K: depositar.', 'C: cámara · Shift+C: vistas · Shift+N: lado isométrico.', 'Sigue la siguiente acción resaltada en los mandos.'];
    c.font = '22px sans-serif'; c.fillStyle = '#d8edf4'; rows.forEach((row, index) => this.text(c, row, 25, 100 + index * 47, WIDTH - 50));
    c.fillStyle = '#f1c66c'; c.font = '18px sans-serif'; c.fillText('Amarillo: ajustar · Rojo: revisar impedimento · Verde: operación disponible', 25, 407);
  }
  text(c, value, x, y, width, lineHeight = 24, maxLines = 1) {
    const measured=text=>c.measureText?c.measureText(text).width:String(text).length*12;
    const words = String(value).split(/\s+/); let line = '', index = 0;
    words.forEach(word => { const candidate = line ? line + ' ' + word : word;
      if (line && measured(candidate) > width && index < maxLines - 1) { c.fillText(line, x, y + index++ * lineHeight); line = word; } else line = candidate; });
    while (line && measured(line) > width) line = line.slice(0, -2); c.fillText(line, x, y + index * lineHeight);
  }
  unmount() {
    this.forkCamera.unmount();
    if(this.facilityLayout)this.facilityLayout.dispose();this.facilityLayout=null;this.inspectionMode.reset();
    if (this.missionPanel) { this.missionPanel.unmount(); this.missionPanel = null; }
    const input = this.ctx.raycontrol;
    if (input && this.stateName) { if (input.deactivateState) input.deactivateState(this.stateName); if (input.removeState) input.removeState(this.stateName); else if (input.states && input.states[this.stateName] === this.state) delete input.states[this.stateName]; }
    if (this.plane) { if (this.plane.parent) this.plane.parent.remove(this.plane); this.plane.geometry.dispose(); this.plane.material.dispose(); }
    if (this.texture) this.texture.dispose(); if (this.canvas && this.click) this.canvas.removeEventListener('click', this.click);
    if (this.cameraButton) this.cameraButton.removeEventListener('click', this.cameraClick); if (this.sideButton) this.sideButton.removeEventListener('click', this.sideClick);
    if (this.cameraModeButton) this.cameraModeButton.removeEventListener('click', this.cameraModeClick);
    if (this.planButton) this.planButton.removeEventListener('click', this.planClick);
    if(this.expandButton)this.expandButton.removeEventListener('click',this.expandClick);if(this.element)this.element.removeEventListener('keydown',this.navigationKey);
    if (this.rearButton) this.rearButton.removeEventListener('click', this.rearClick);
    if (this.hologramButton) this.hologramButton.removeEventListener('click', this.hologramClick); if (this.targetSelect) this.targetSelect.removeEventListener('change', this.targetChange);
    if (this.element) { ['pointerdown', 'mousedown', 'mouseup'].forEach(type => this.element.removeEventListener(type, this.stopEvent)); this.element.remove(); }
    if (this.guidancePanel) {['pointerdown', 'mousedown', 'mouseup'].forEach(type => this.guidancePanel.removeEventListener(type, this.stopEvent)); this.guidancePanel.remove();}
    if(this.panels){if(this.driving.hud&&this.driving.document.body)this.driving.document.body.appendChild(this.driving.hud);this.panels.remove();}
    this.panels=this.operatorColumn=this.navigationHeader=this.navigationActions=this.navigationTitle=this.planeMode=this.expandButton=this.expandClick=this.navigationKey=this.mapAspect=null;
    this.cameraFallback=this.cameraFallbackLabel=this.cameraFallbackCanvas=this.cameraFallbackContext=this.fallbackPaintModel=this.fallbackPaintSnapshot=this.fallbackPaintMode=this.dropPlacement=this.dropView=this.dropProjection=null;
    this.body = this.plan = this.feed = this.feedViewport = this.cameraViews = this.rear = this.rearViewport = this.cameraButton = this.sideButton = this.cameraModeButton = this.planButton = this.rearButton = this.guidancePanel = null; this.cameraSupported = false;
    this.guidanceBar = this.hologramButton = this.targetLabel = this.targetSelect = this.coach = this.metrics = this.targetSignature = this.trainingPanel = this.trainingSignature = null;
    this.plane = this.texture = this.element = this.canvas = this.context = this.state = this.stateName = this.snapshot = null;
  }
  dispose() { this.unmount(); this.forkCamera.dispose(); }
}
