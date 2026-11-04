const point = p => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite);
const distance = (a,b) => Math.hypot(a[0]-b[0],a[2]-b[2]);

/** Pure display hysteresis. A carried pallet is never a proximity target. */
export default class VehicleInspectionMode {
  constructor({enterM=2.0,exitM=2.8}={}) {this.enterM=enterM;this.exitM=exitM;this.reset();}
  reset() {this.mode='layout';this.target=null;this.entryId='';this.latch=null;this.near=false;this.hologram=false;this.hologramOverride=null;this.automaticNear=false;}
  // A manual choice lasts for the current approach/travel zone. The next
  // actual proximity transition restores automatic operation, so a truck
  // cannot remain transparent throughout a journey after leaving a pallet.
  setHologramOverride(value) {this.hologramOverride=!!value;this.hologram=!!value;return this.hologram;}
  update({available=true,automatic=true,forceLayout=false,mirror=false,position,target=null,entryId=''}={}) {
    if(!available){this.reset();return this.mode;}
    const custodyChanged=this.entryId!==entryId;
    if(custodyChanged){
      // Retain the fixed source/destination after custody changes, while the
      // forks withdraw. Do not follow the newly attached moving cargo.
      this.latch=this.target&&point(this.target.position)?{id:this.target.id,position:this.target.position.slice()}:null;
      this.entryId=entryId;
    }
    // A newly selected bay/slot gets the entry threshold, not the previous
    // receiver's wider exit threshold. Custody withdrawal latches stay fixed.
    if(!custodyChanged&&!this.latch&&this.target&&target&&this.target.id!==target.id){this.mode='layout';this.near=false;}
    this.target=target&&point(target.position)?target:null;
    if(this.latch&&point(position)&&distance(position,this.latch.position)>this.exitM)this.latch=null;
    const active=this.latch||this.target;
    this.near=!!(active&&point(position)&&distance(position,active.position)<=(this.near?this.exitM:this.enterM));
    const automaticNear=!!(automatic&&!forceLayout&&this.near);
    if(automaticNear!==this.automaticNear)this.hologramOverride=null;
    this.automaticNear=automaticNear;
    this.hologram=this.hologramOverride===null?automaticNear:this.hologramOverride;
    if(!automatic||forceLayout){this.mode='layout';return this.mode;}
    if(mirror){this.mode='rear';return this.mode;}
    this.mode=this.near?'inspection':'layout';return this.mode;
  }
}
