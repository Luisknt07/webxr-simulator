const point = p => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite);
const distance = (a,b) => Math.hypot(a[0]-b[0],a[2]-b[2]);

/** Pure display hysteresis. A carried pallet is never a proximity target. */
export default class VehicleInspectionMode {
  constructor({enterM=2.0,exitM=2.8}={}) {this.enterM=enterM;this.exitM=exitM;this.reset();}
  reset() {this.mode='layout';this.target=null;this.entryId='';this.latch=null;}
  update({available=true,automatic=true,forceLayout=false,mirror=false,position,target=null,entryId=''}={}) {
    if(!available){this.reset();return this.mode;}
    if(this.entryId!==entryId){
      // Retain the fixed source/destination after custody changes, while the
      // forks withdraw. Do not follow the newly attached moving cargo.
      this.latch=this.target&&point(this.target.position)?{id:this.target.id,position:this.target.position.slice()}:null;
      this.entryId=entryId;
    }
    this.target=target&&point(target.position)?target:null;
    if(this.latch&&point(position)&&distance(position,this.latch.position)>this.exitM)this.latch=null;
    if(!automatic||forceLayout){this.mode='layout';return this.mode;}
    if(mirror){this.mode='rear';return this.mode;}
    const active=this.latch||this.target;
    const near=active&&point(position)&&distance(position,active.position)<=(this.mode==='inspection'?this.exitM:this.enterM);
    this.mode=near?'inspection':'layout';return this.mode;
  }
}
