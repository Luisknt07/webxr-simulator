'use strict';
const {randomUUID}=require('node:crypto');
const progress=require('../schema/PracticeProgress.cjs');
const recipes=require('../configurable/Recipes.cjs');
const sessionSchema=require('../schema/PracticeSession.cjs');
const canonicalSettings=value=>sessionSchema.normalizeAttemptSettings(recipes.normalizedOptions(value));
const stableEvidence=receipt=>JSON.stringify({config:receipt.config,done:receipt.checkpoint&&receipt.checkpoint.done,baseline:receipt.checkpoint&&receipt.checkpoint.baseline,penalty:receipt.checkpoint&&receipt.checkpoint.penalty});

/** Private campaign storage. The host supplies authentication and HTTP guards. */
module.exports=class PracticeProgressService {
 constructor(host){this.host=host;this.db=host.db;this.initialized=false;}
 init(){if(this.initialized)return;this.db.exec(`
 CREATE TABLE IF NOT EXISTS logistics_practice_progress(user_id TEXT PRIMARY KEY REFERENCES studio_users(id) ON DELETE CASCADE,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS logistics_practice_attempts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,practice_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,settings TEXT NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,receipt TEXT,checkpoint TEXT);
 CREATE INDEX IF NOT EXISTS logistics_practice_attempt_owner ON logistics_practice_attempts(user_id,created_at);
 `);if(!this.db.prepare('PRAGMA table_info(logistics_practice_attempts)').all().some(row=>row.name==='checkpoint'))this.db.exec('ALTER TABLE logistics_practice_attempts ADD COLUMN checkpoint TEXT');this.initialized=true;}
 fail(status,message,code='practice_invalid'){throw this.host.error(status,message,code);}
 read(userId){const row=this.db.prepare('SELECT value FROM logistics_practice_progress WHERE user_id=?').get(userId),value=row?JSON.parse(row.value):null;return progress.normalize(value&&value.sourceSha256!==progress.SOURCE_SHA256?null:value,userId);}
 settings(data){const value=recipes.normalizedOptions(data),plan=recipes.plan(data.practiceId,Object.assign({},data,value));if(plan.cediData)value.cediData=plan.cediData;return value;}
 async handle(req,res,parts,method,body,user,send){
  this.init();const route=parts.slice(1).join('/'),now=this.host.now();
  if(route==='progress'&&method==='GET'){send(200,{progress:this.read(user.id),routes:progress.ROUTES,capabilities:recipes.matrix(),sourceSha256:progress.SOURCE_SHA256});return true;}
  if(route==='attempts'&&method==='POST'){
   const data=await body(32768);let settings;try{settings=this.settings(data);}catch(error){this.fail(400,error.message);}
   const access=progress.access(this.read(user.id),data.practiceId);if(!access.routeId)this.fail(400,access.reason);if(settings.executionMode==='campaign'&&!access.allowed)this.fail(403,access.reason,'practice_locked');
   const availability=recipes.availability(data.practiceId,settings.mode,settings);if(data.preview===true||!availability.ready)this.fail(400,availability.reasons.join(' ')||'Este montaje está disponible para consulta, todavía no como intento evaluado.','practice_not_verified');
   this.db.prepare('DELETE FROM logistics_practice_attempts WHERE user_id=? AND completed_at IS NULL AND created_at<?').run(user.id,now-7*86400000);
   const open=this.db.prepare('SELECT COUNT(*) AS count FROM logistics_practice_attempts WHERE user_id=? AND completed_at IS NULL').get(user.id).count;
   if(open>=64)this.db.prepare('DELETE FROM logistics_practice_attempts WHERE id IN (SELECT id FROM logistics_practice_attempts WHERE user_id=? AND completed_at IS NULL ORDER BY created_at LIMIT ?)').run(user.id,open-63);
   const attempt={id:randomUUID(),practiceId:data.practiceId,routeId:access.routeId,sourceSha256:progress.SOURCE_SHA256,settings};
   this.db.prepare('INSERT INTO logistics_practice_attempts(id,user_id,practice_id,source_sha256,settings,created_at) VALUES(?,?,?,?,?,?)').run(attempt.id,user.id,attempt.practiceId,attempt.sourceSha256,JSON.stringify(settings),now);
   send(201,{attempt,progress:this.read(user.id),capabilities:recipes.matrix()});return true;
  }
  if(route==='progress'&&method==='POST'){
   const data=await body(131072),receipt=data.receipt;
   if(!receipt||typeof receipt.attemptId!=='string')this.fail(400,'Falta el identificador de intento.');
   const attempt=this.db.prepare('SELECT * FROM logistics_practice_attempts WHERE id=? AND user_id=?').get(receipt.attemptId,user.id);
   if(!attempt)this.fail(404,'El intento no pertenece a esta cuenta.','practice_attempt_missing');
   if(attempt.practice_id!==receipt.practiceId||attempt.source_sha256!==receipt.sourceSha256)this.fail(409,'El resultado pertenece a otra práctica o edición.');
   const settings=JSON.parse(attempt.settings),config=receipt.config||{};
   for(const key of ['mode','caseId','difficulty'])if(settings[key]!==config[key])this.fail(409,'El resultado cambió las condiciones del intento.');
   try{if(JSON.stringify(sessionSchema.normalizeAttemptSettings(config.settings))!==JSON.stringify(canonicalSettings(settings)))this.fail(409,'El resultado cambió los equipos, layout, ayudas o condiciones del intento.');}catch(error){if(error.status===409||error.statusCode===409)throw error;this.fail(409,error.message);}
   const canonical=recipes.plan(attempt.practice_id,settings);
   if(config.sku!==canonical.id+'-ORDER')this.fail(400,'El SKU no corresponde a la orden de esta práctica.');
   if(config.expectedUnits!==canonical.units)this.fail(400,'El lote o documento no corresponde al intento.');
   if(!Array.isArray(config.steps)||JSON.stringify(config.steps.map(step=>[step.id,step.guard]))!==JSON.stringify(canonical.steps.map(step=>[step.id,step.guard])))this.fail(400,'Los objetivos no corresponden a esta práctica.');
   try{const expected=sessionSchema.normalizeAdapter({kind:'workflow',requirements:recipes.workflowRequirements(canonical)}),actual=sessionSchema.normalizeAdapter(config.evidenceAdapter);if(JSON.stringify(expected)!==JSON.stringify(actual))this.fail(400,'Las etapas y los actores no corresponden al proceso original.');}catch(error){this.fail(400,error.message);}
   if(attempt.completed_at&&stableEvidence(JSON.parse(attempt.receipt))!==stableEvidence(receipt))this.fail(409,'Este intento ya tiene un resultado confirmado. Inicia otro ensayo para cambiarlo.');
   let merged;try{progress.validateCompletion(receipt);merged=settings.executionMode==='campaign'&&settings.evaluation==='assessed'?progress.mergeCompletion(this.read(user.id),receipt,{userId:user.id,now:new Date(now).toISOString()}):this.read(user.id);}catch(error){this.fail(400,error.message);}
   // SQLite serializes this synchronous merge and write; a delayed request must
   // still satisfy the currently persisted predecessor chain.
   this.db.prepare('INSERT INTO logistics_practice_progress(user_id,value,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(user.id,JSON.stringify(merged),now);
   this.db.prepare('UPDATE logistics_practice_attempts SET completed_at=?,receipt=? WHERE id=? AND user_id=?').run(now,JSON.stringify(receipt),attempt.id,user.id);
   this.db.prepare('DELETE FROM logistics_practice_attempts WHERE id IN (SELECT id FROM logistics_practice_attempts WHERE user_id=? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT -1 OFFSET 64)').run(user.id);
   send(200,{progress:merged,access:progress.access(merged,receipt.practiceId)});return true;
  }
  if(parts.length===4&&parts[1]==='attempts'&&parts[3]==='checkpoint'&&method==='POST'){
   const data=await body(98304),attempt=this.db.prepare('SELECT * FROM logistics_practice_attempts WHERE id=? AND user_id=?').get(parts[2],user.id);if(!attempt)this.fail(404,'El intento no pertenece a esta cuenta.');
   if(!data.checkpoint||!Array.isArray(data.checkpoint.done)||data.checkpoint.done.length>6)this.fail(400,'El registro de intento no es válido.');
   this.db.prepare('UPDATE logistics_practice_attempts SET checkpoint=? WHERE id=? AND user_id=?').run(JSON.stringify(data.checkpoint),attempt.id,user.id);send(200,{recorded:true,resumable:false,message:'Evidencias del intento guardadas. Volver a entrar inicia un ensayo nuevo; este registro no desbloquea niveles.'});return true;
  }
  this.fail(404,'Acción de campaña no disponible.','not_found');
 }
};
