'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {ApiError, plain} = require('./validation');
const {ROOM_IDS} = require('../../../packages/project-model/shared/studio-document');
const publicExamples = require('../../../projects/smarttwin/public-scenes');
const DEFAULT_BYTES = 20 * 1024 * 1024, DAY = 86400000;
const fail = (status, message, code) => { throw new ApiError(status, message, code); };
const hashPattern = /^[a-f0-9]{64}$/;
const copy = value => JSON.parse(JSON.stringify(value));

class ProjectAccess {
  constructor(service) {
    this.service = service; this.store = service.store; this.db = service.db; this.now = service.now; this.inflight = new Map();
    this.usersDir = path.join(this.store.dataDir, 'users');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_user_resources (
        user_id TEXT PRIMARY KEY REFERENCES studio_users(id) ON DELETE CASCADE,
        max_projects INTEGER NOT NULL DEFAULT 2, storage_bytes INTEGER NOT NULL DEFAULT 20971520,
        last_seen_at INTEGER NOT NULL, initialized_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_project_owners (
        project_id TEXT PRIMARY KEY REFERENCES projects(id), user_id TEXT REFERENCES studio_users(id)
      );
      CREATE TABLE IF NOT EXISTS studio_project_shares (
        project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES studio_users(id),
        permission TEXT NOT NULL CHECK(permission IN ('viewer','editor')), created_at INTEGER NOT NULL,
        PRIMARY KEY(project_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS studio_asset_owners (
        user_id TEXT NOT NULL REFERENCES studio_users(id), asset_hash TEXT NOT NULL REFERENCES assets(hash),
        created_at INTEGER NOT NULL, PRIMARY KEY(user_id,asset_hash)
      );
      CREATE TABLE IF NOT EXISTS studio_public_scenes (
        id TEXT PRIMARY KEY, project_id TEXT, room_id TEXT NOT NULL, name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, asset_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS studio_cleanup_audit (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, details TEXT NOT NULL
      );
      INSERT OR IGNORE INTO studio_project_owners(project_id,user_id) SELECT id,NULL FROM projects;
    `);
    // Legacy accounts receive a full grace period. No old files or projects are
    // deleted by this additive migration, and unowned projects remain admin-only.
    this.db.prepare(`INSERT OR IGNORE INTO studio_user_resources(user_id,last_seen_at,initialized_at)
      SELECT id,?,? FROM studio_users`).run(this.now(), this.now());
    if (!this.db.prepare("SELECT value FROM studio_settings WHERE key='public-scenes-initialized'").get()) {
      this.db.prepare('INSERT OR IGNORE INTO studio_public_scenes VALUES(?,NULL,?,?,1,?)').run('l-transfer', 'hall', 'Transferencia rectangular a 90°', '[]');
      this.db.prepare('INSERT OR IGNORE INTO studio_public_scenes VALUES(?,NULL,?,?,1,?)').run('inspection-sorting', 'sound', 'Inspección y clasificación', '[]');
      this.db.prepare("INSERT INTO studio_settings VALUES('public-scenes-initialized','1')").run();
    }
  }

  admin(user) { return !!user && this.service._owner(user.id); }
  ensureUser(userId) {
    if (!this.db.prepare('SELECT 1 FROM studio_users WHERE id=?').get(userId)) fail(404, 'La cuenta no existe.', 'not_found');
    this.db.prepare('INSERT OR IGNORE INTO studio_user_resources(user_id,last_seen_at,initialized_at) VALUES(?,?,?)').run(userId, this.now(), this.now());
    return this.db.prepare('SELECT * FROM studio_user_resources WHERE user_id=?').get(userId);
  }
  touch(userId) { const row = this.ensureUser(userId); if (this.now() - row.last_seen_at > 60000) this.db.prepare('UPDATE studio_user_resources SET last_seen_at=? WHERE user_id=?').run(this.now(), userId); }
  userFolder(userId) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(userId)) fail(400, 'Identificador de cuenta inválido.');
    const target = path.resolve(this.usersDir, userId);
    if (!target.startsWith(path.resolve(this.usersDir) + path.sep)) fail(400, 'Carpeta inválida.');
    return target;
  }
  usage(userId) {
    const quota = this.ensureUser(userId);
    const owned = this.db.prepare('SELECT project_id FROM studio_project_owners WHERE user_id=?').all(userId);
    const framework = this.db.prepare("SELECT COUNT(*) AS projects,COALESCE(SUM(length(CAST(document AS BLOB))+length(CAST(module_state AS BLOB))+length(CAST(name AS BLOB))),0) AS bytes FROM framework_projects WHERE owner_id=?").get(userId);
    const projects = owned.length + framework.projects;
    let documentBytes = 0, telemetryBytes = 0;
    for (const {project_id: projectId} of owned) {
      documentBytes += this.db.prepare('SELECT COALESCE(SUM(length(CAST(document AS BLOB))),0) AS n FROM revisions WHERE project_id=?').get(projectId).n;
      telemetryBytes += this.db.prepare(`SELECT COALESCE(SUM(length(CAST(s.variables AS BLOB))),0) AS n FROM simulation_samples s JOIN simulation_runs r ON r.id=s.run_id WHERE r.project_id=?`).get(projectId).n;
      telemetryBytes += this.db.prepare(`SELECT COALESCE(SUM(length(CAST(e.message AS BLOB))),0) AS n FROM simulation_events e JOIN simulation_runs r ON r.id=e.run_id WHERE r.project_id=?`).get(projectId).n;
    }
    documentBytes += framework.bytes;
    const assetBytes = this.db.prepare('SELECT COALESCE(SUM(a.size),0) AS n FROM studio_asset_owners o JOIN assets a ON a.hash=o.asset_hash WHERE o.user_id=?').get(userId).n;
    const checkpointBytes = this.db.prepare('SELECT COALESCE(SUM(length(CAST(state AS BLOB))),0) AS n FROM studio_checkpoints WHERE user_id=?').get(userId).n;
    const progressBytes = this.db.prepare('SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) AS n FROM studio_progress WHERE user_id=?').get(userId).n;
    const roomBytes = this.db.prepare('SELECT COALESCE(SUM(length(CAST(state AS BLOB))),0) AS n FROM studio_rooms WHERE host_id=?').get(userId).n;
    const roomEventBytes = this.db.prepare('SELECT COALESCE(SUM(length(CAST(e.payload AS BLOB))),0) AS n FROM studio_room_events e JOIN studio_rooms r ON r.id=e.room_id WHERE r.host_id=?').get(userId).n;
    const profile = this.db.prepare('SELECT length(CAST(COALESCE(image,\'\') || avatar || preferences AS BLOB)) AS n FROM studio_users WHERE id=?').get(userId);
    const usedBytes = documentBytes + telemetryBytes + assetBytes + checkpointBytes + progressBytes + roomBytes + roomEventBytes + (profile && profile.n || 0);
    return {projects, usedBytes, documentBytes, frameworkProjects:framework.projects, frameworkBytes:framework.bytes, assetBytes, checkpointBytes, progressBytes, telemetryBytes, roomBytes, roomEventBytes,
      maxProjects: quota.max_projects, storageBytes: quota.storage_bytes, remainingBytes: Math.max(0, quota.storage_bytes - usedBytes), lastSeenAt: new Date(quota.last_seen_at).toISOString()};
  }
  setQuota(userId, value) {
    this.ensureUser(userId);
    const previous = this.usage(userId), maxProjects = value.maxProjects === undefined ? previous.maxProjects : value.maxProjects,
      storageBytes = value.storageBytes === undefined ? previous.storageBytes : value.storageBytes;
    if (!Number.isSafeInteger(maxProjects) || maxProjects < 1 || maxProjects > 10000 || !Number.isSafeInteger(storageBytes) || storageBytes < 1024 || storageBytes > 1024 * 1024 * 1024 * 1024) fail(400, 'La cuota no es válida.', 'invalid_quota');
    this.db.prepare('UPDATE studio_user_resources SET max_projects=?,storage_bytes=? WHERE user_id=?').run(maxProjects, storageBytes, userId);
    return this.usage(userId);
  }
  checkQuota(userId, extra = 0) {
    const user = this.db.prepare('SELECT * FROM studio_users WHERE id=?').get(userId); if (this.admin(user)) return;
    const usage = this.usage(userId);
    if (usage.projects > usage.maxProjects) fail(413, 'Alcanzaste el límite de proyectos de tu cuenta.', 'project_quota_exceeded');
    if (usage.usedBytes + extra > usage.storageBytes) fail(413, 'Alcanzaste el espacio de tu cuenta. Solicita una ampliación al administrador.', 'storage_quota_exceeded');
  }
  owner(projectId) { this.store._requireProject(projectId); return this.db.prepare('SELECT user_id FROM studio_project_owners WHERE project_id=?').get(projectId)?.user_id || null; }
  role(user, projectId) {
    if (!user) return null;
    const owner = this.owner(projectId); if (this.admin(user)) return 'admin'; if (owner === user.id) return 'owner';
    const shared = this.db.prepare('SELECT permission FROM studio_project_shares WHERE project_id=? AND user_id=?').get(projectId, user.id)?.permission;
    if (shared) return shared;
    return this.db.prepare('SELECT 1 FROM studio_members m JOIN studio_rooms r ON r.id=m.room_id WHERE m.user_id=? AND m.active=1 AND r.closed=0 AND r.project_id=? LIMIT 1').get(user.id, projectId) ? 'viewer' : null;
  }
  canRead(user, projectId) { try { return !!this.role(user, projectId); } catch (_) { return false; } }
  require(user, projectId, permission = 'read') {
    if (!user) fail(401, 'Inicia sesión para acceder al proyecto.', 'authentication_required');
    const role = this.role(user, projectId);
    if (!role || permission === 'edit' && !['admin','owner','editor'].includes(role) || permission === 'owner' && !['admin','owner'].includes(role)) fail(403, 'Tu cuenta no tiene permiso sobre este proyecto.', 'project_forbidden');
    return role;
  }
  metadata(user, project) {
    const role = this.role(user, project.id);
    const editor = !!user && user.role === 'creator';
    return Object.assign({}, project, {access: {role, ownerId: this.owner(project.id), canEdit: editor && ['admin','owner','editor'].includes(role), canShare: editor && ['admin','owner'].includes(role)}});
  }
  list(user) { if (!user) fail(401, 'Inicia sesión para ver tus proyectos.', 'authentication_required'); return this.store.listProjects().filter(project => this.canRead(user, project.id)).map(project => this.metadata(user, project)); }
  get(user, projectId, revision) { this.require(user, projectId); return this.metadata(user, this.store.getProject(projectId, revision)); }
  shares(user, projectId) {
    this.require(user, projectId, 'owner'); return this.db.prepare('SELECT s.user_id AS userId,u.username,u.display_name AS displayName,s.permission FROM studio_project_shares s JOIN studio_users u ON u.id=s.user_id WHERE s.project_id=? ORDER BY u.username').all(projectId);
  }
  share(user, projectId, targetId, permission) {
    this.require(user, projectId, 'owner'); if (!['viewer','editor'].includes(permission)) fail(400, 'Selecciona un permiso compatible.');
    if (targetId && typeof targetId === 'object') targetId = targetId.userId || this.db.prepare('SELECT id FROM studio_users WHERE username=?').get(String(targetId.username || '').trim().toLowerCase())?.id;
    if (typeof targetId !== 'string') fail(404, 'La cuenta no existe.', 'not_found');
    if (!this.db.prepare('SELECT 1 FROM studio_users WHERE id=?').get(targetId)) fail(404, 'La cuenta no existe.', 'not_found');
    if (this.owner(projectId) === targetId) fail(400, 'La cuenta ya es propietaria.');
    this.db.prepare('INSERT INTO studio_project_shares VALUES(?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET permission=excluded.permission').run(projectId, targetId, permission, this.now());
    return this.shares(user, projectId);
  }
  unshare(user, projectId, targetId) { this.require(user, projectId, 'owner'); this.db.prepare('DELETE FROM studio_project_shares WHERE project_id=? AND user_id=?').run(projectId, targetId); return this.shares(user, projectId); }
  asset(user, hash) {
    if (!hashPattern.test(hash)) fail(404, 'El archivo no existe.', 'not_found');
    const asset = this.store.asset(hash);
    if (this.admin(user) || user && this.db.prepare('SELECT 1 FROM studio_asset_owners WHERE user_id=? AND asset_hash=?').get(user.id, hash)) return asset;
    if (user) for (const project of this.list(user)) if (this.db.prepare("SELECT 1 FROM revisions r,json_each(r.document,'$.imports') j WHERE r.project_id=? AND json_extract(j.value,'$.sha256')=? LIMIT 1").get(project.id, hash)) return asset;
    if (user && this.db.prepare(`SELECT 1 FROM studio_users u JOIN studio_members other ON other.user_id=u.id JOIN studio_members me ON me.room_id=other.room_id JOIN studio_rooms room ON room.id=me.room_id
      WHERE u.image=? AND me.user_id=? AND me.active=1 AND other.active=1 AND room.closed=0 LIMIT 1`).get('/api/assets/' + hash, user.id)) return asset;
    for (const entry of this.publicCatalog().scenes.filter(scene => !scene.included)) if ((this.publicProject(entry.id).document.imports || []).some(item => item.sha256 === hash)) return asset;
    fail(user ? 403 : 401, 'No tienes permiso para acceder a este archivo.', user ? 'asset_forbidden' : 'authentication_required');
  }
  grantAsset(userId, hash) {
    this.db.prepare('INSERT OR IGNORE INTO studio_asset_owners VALUES(?,?,?)').run(userId, hash, this.now());
  }
  linkAssets(userId, imports) {
    const folder = path.join(this.userFolder(userId), 'assets'); fs.mkdirSync(folder, {recursive: true});
    for (const record of imports) {
      if (!hashPattern.test(record.sha256 || '')) continue;
      const source = this.store.asset(record.sha256).filename, destination = path.join(folder, record.sha256 + '.blob');
      if (!fs.existsSync(destination)) { try { fs.linkSync(source, destination); } catch (_) { fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); } }
    }
  }
  save(user, projectId, payload) {
    if (!user || user.role !== 'creator' && !this.admin(user)) fail(user ? 403 : 401, 'Inicia sesión con permiso de edición.', 'editor_forbidden');
    if (projectId) this.require(user, projectId, 'edit');
    const ownerId = projectId ? this.owner(projectId) : user.id;
    // Only the administrator may edit a legacy project; never silently assign it.
    const chargedId = ownerId || user.id;
    const existing = this.usage(chargedId);
    if (!projectId && !this.admin(user) && existing.projects >= existing.maxProjects) fail(413, 'Tu cuenta admite como máximo ' + existing.maxProjects + ' proyectos.', 'project_quota_exceeded');
    const newHashes = new Set();
    try {
      const result = this.store.saveProject(projectId, payload, {
        beforeImport: record => {
          if (record.dataUrl === undefined) this.asset(user, record.sha256);
          else {
            const match = typeof record.dataUrl === 'string' && /;base64,([A-Za-z0-9+/]*={0,2})$/.exec(record.dataUrl);
            if (match) {
              const size = Math.floor(match[1].length * .75);
              if (!this.admin(user) && size > this.usage(chargedId).remainingBytes) fail(413, 'El archivo supera el espacio disponible de tu cuenta.', 'storage_quota_exceeded');
              const hash = createHash('sha256').update(Buffer.from(match[1], 'base64')).digest('hex'); if (!this.store.sql.asset.get(hash)) newHashes.add(hash);
            }
          }
        },
        beforeCommit: ({projectId: savedId, document}) => {
          if (!projectId) this.db.prepare('INSERT INTO studio_project_owners VALUES(?,?)').run(savedId, user.id);
          for (const item of document.imports || []) this.grantAsset(chargedId, item.sha256);
          this.checkQuota(chargedId);
        }
      });
      const folder = path.join(this.userFolder(chargedId), 'projects', result.id); fs.mkdirSync(folder, {recursive: true});
      // SQLite is authoritative; folders expose ownership without a second full
      // history or duplicate model payloads. Assets use same-volume hard links.
      fs.writeFileSync(path.join(folder, 'project.json'), JSON.stringify({id: result.id, name: result.name, revision: result.revision, ownerId}, null, 2));
      this.linkAssets(chargedId, result.document.imports || []);
      return this.metadata(user, result);
    } catch (error) {
      for (const hash of newHashes) if (!this.store.sql.asset.get(hash)) try { fs.unlinkSync(path.join(this.store.uploadDir, hash + '.blob')); } catch (_) { /* Failed uploads are never exposed by API. */ }
      throw error;
    }
  }
  async upload(user, req) {
    if (!user || user.role !== 'creator' && !this.admin(user)) fail(user ? 403 : 401, 'Inicia sesión con permiso de edición.', 'editor_forbidden');
    const administrator = this.admin(user);
    const remaining = administrator ? this.store.maxAssetBytes : this.usage(user.id).remainingBytes;
    const reserved = administrator ? 0 : this.inflight.get(user.id) || 0;
    const allowance = Math.max(0, remaining - reserved), expected = Number(req.headers['content-length']);
    if (!administrator && (!allowance || Number.isFinite(expected) && expected > allowance)) fail(413, 'El archivo supera el espacio disponible de tu cuenta.', 'storage_quota_exceeded');
    const reservation = Number.isSafeInteger(expected) && expected >= 0 ? expected : allowance;
    if (!administrator) this.inflight.set(user.id, reserved + reservation);
    req.assetBudgetBytes = Math.min(allowance, this.store.maxAssetBytes);
    let asset;
    try {
      asset = await this.store.receiveAsset(req);
      if (req.studioWriteGuard) req.studioWriteGuard();
      this.db.exec('BEGIN IMMEDIATE');
      try { this.grantAsset(user.id, asset.sha256); this.checkQuota(user.id); this.db.exec('COMMIT'); }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.linkAssets(user.id, [asset]); return asset;
    } catch (error) { if (asset && req.committedNewAsset) this.collectAsset(asset.sha256); throw error; }
    finally { if (!administrator) { const left = (this.inflight.get(user.id) || 0) - reservation; if (left > 0) this.inflight.set(user.id, left); else this.inflight.delete(user.id); } delete req.assetBudgetBytes; delete req.committedNewAsset; }
  }
  projectProjection(document, roomId, assetIds = []) {
    if (!document.rooms || !document.rooms[roomId]) fail(404, 'La escena no existe.', 'not_found');
    const result = copy(document); result.rooms = {[roomId]: result.rooms[roomId]};
    const allowed = new Set(assetIds); result.imports = (result.imports || []).filter(item => allowed.has(item.id));
    // Global templates carry complete object payloads without room ownership;
    // organization can contain names from every private scene. Project only
    // explicit scene-owned fields so future global extensions stay private.
    const sourceStudio = result.studio || {}, studio = {version: 1, startRoomId: roomId};
    for (const key of ['scenes','environments','entities','spawns','widgets','missions','groups']) if (sourceStudio[key]) studio[key] = sourceStudio[key].filter(item => (item.roomId || item.id) === roomId);
    result.studio = studio;
    return result;
  }
  defaultDocument() {
    if (!this.defaultCache) this.defaultCache = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../projects/smarttwin/examples/industrial-study-fundamentals.json'), 'utf8'));
    return this.defaultCache;
  }
  publicCatalog() {
    if (this.service.publicSceneId) {
      const scene = this.exampleCatalog().scenes.find(value => value.id === this.service.publicSceneId);
      if (!scene) fail(503, 'El escenario público no está disponible.', 'public_scene_unavailable');
      return {scenes:[Object.assign({}, scene, {projectId:'public-' + scene.id, public:true, revision:1})], maxActive:1, requiresLogin:true, previewAllExamples:false, fixedPublicScene:true};
    }
    if (this.previewAllExamples()) return Object.assign({}, this.exampleCatalog(), {previewAllExamples: true, requiresLogin: false});
    const scenes = this.db.prepare('SELECT * FROM studio_public_scenes WHERE enabled=1 ORDER BY rowid LIMIT 2').all().map(row => ({id: row.id, name: row.name, projectId: 'public-' + row.id, roomId: row.room_id, revision: row.project_id ? this.store._requireProject(row.project_id).revision : 1, public: true}));
    return {scenes, maxActive: 2, requiresLogin: true, previewAllExamples: false};
  }
  previewAllExamples() {if (this.service.publicSceneId) return false; const row = this.db.prepare("SELECT value FROM studio_settings WHERE key='public-examples-preview'").get(); return row ? row.value === '1' : publicExamples.POLICY.previewAllExamples;}
  exampleCatalog() {if (!this.exampleMetadata) this.exampleMetadata = JSON.parse(fs.readFileSync(this.service.exampleCatalogPath || path.join(this.service.projectionsDir || path.join(__dirname, '../../../projects/smarttwin/scenes'), 'catalog.json'), 'utf8')); return this.exampleMetadata;}
  exampleProject(sceneId) {
    const scene = this.exampleCatalog().scenes.find(value => value.id === sceneId); if (!scene) fail(404, 'El ejemplo incluido no existe.', 'not_found');
    if (!this.exampleProjects) this.exampleProjects = new Map();
    if (!this.exampleProjects.has(sceneId)) {const result = JSON.parse(fs.readFileSync(path.join(this.service.projectionsDir || path.join(__dirname, '../../../projects/smarttwin/scenes'), scene.id + '.json'), 'utf8')).project; const safe = publicExamples.project(result.document, scene); this.exampleProjects.set(sceneId, safe); if (this.exampleProjects.size > 2) this.exampleProjects.delete(this.exampleProjects.keys().next().value);}
    return copy(this.exampleProjects.get(sceneId));
  }
  publicProject(sceneId) {
    if (this.service.publicSceneId) {if (sceneId !== this.service.publicSceneId) fail(404, 'Esta escena requiere autenticación.', 'not_found'); return this.exampleProject(sceneId);}
    if (this.previewAllExamples()) return this.exampleProject(sceneId);
    const row = this.db.prepare('SELECT * FROM studio_public_scenes WHERE id=? AND enabled=1').get(sceneId); if (!row) fail(404, 'Esta escena no está publicada.', 'not_found');
    const project = row.project_id ? this.store.getProject(row.project_id) : {revision: 1, document: this.defaultDocument()};
    return {id: 'public-' + row.id, name: row.name, revision: project.revision, document: this.projectProjection(project.document, row.room_id, JSON.parse(row.asset_ids)),
      access: {role: 'public', canEdit: false, canShare: false}, allowedRoomIds: [row.room_id], publicSceneId: row.id};
  }
  libraryEntries() {
    if (!this.libraryCache) {
      this.libraryCache = [];
      for (const [key, file, collection] of [['fundamentals','industrial-study-fundamentals','Fundamentos'],['advanced','industrial-study-advanced','Aplicaciones avanzadas'],['cedi','industrial-cedi-complete','CEDI']]) {
        const document = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../projects/smarttwin/examples/' + file + '.json'), 'utf8'));
        for (const scene of document.studio && document.studio.scenes || []) {
          if (key === 'cedi' && scene.id === 'hall') continue;
          this.libraryCache.push({id: key + '-' + scene.id, name: scene.name, roomId: scene.id, collection, document});
        }
      }
    }
    return this.libraryCache;
  }
  libraryCatalog(user) {
    if (this.service.publicSceneId) {if (!user) fail(401, 'Inicia sesión para explorar todos los escenarios.', 'authentication_required'); return {scenes:this.exampleCatalog().scenes.map(scene => Object.assign({}, scene, {projectId:'library-' + scene.id, library:true, public:false, revision:1}))};}
    if (!user && !this.previewAllExamples()) fail(401, 'Inicia sesión para explorar todos los ejemplos.', 'authentication_required');
    if (this.previewAllExamples()) return {scenes: [], includedInPublicCatalog: true};
    return {scenes: this.libraryEntries().map(({id, name, roomId, collection}) => ({id, name, roomId, collection, projectId: 'library-' + id, revision: 1, library: true}))};
  }
  libraryProject(user, sceneId) {
    if (this.service.publicSceneId) {if (!user) fail(401, 'Inicia sesión para abrir este escenario.', 'authentication_required'); const result = this.exampleProject(sceneId); result.id = 'library-' + sceneId; result.librarySceneId = sceneId; delete result.publicSceneId; result.access = {role:'library',canEdit:false,canShare:false}; return result;}
    if (!user && !this.previewAllExamples()) fail(401, 'Inicia sesión para explorar todos los ejemplos.', 'authentication_required');
    const entry = this.libraryEntries().find(value => value.id === sceneId); if (!entry) fail(404, 'El ejemplo no existe.', 'not_found');
    return {id: 'library-' + entry.id, name: entry.name, revision: 1, document: this.projectProjection(entry.document, entry.roomId),
      access: {role: 'library', canEdit: false, canShare: false}, allowedRoomIds: [entry.roomId], librarySceneId: entry.id};
  }
  publicationSettings() {if(this.service.publicSceneId) return Object.assign({locked:true},this.publicCatalog()); return {previewAllExamples: this.previewAllExamples(), scenes: this.db.prepare('SELECT id,project_id AS projectId,room_id AS roomId,name,enabled,asset_ids AS assetIds FROM studio_public_scenes ORDER BY rowid').all().map(row => Object.assign({}, row, {enabled: !!row.enabled, assetIds: JSON.parse(row.assetIds)}))};}
  configurePublic(user, scenes, options = {}) {
    if (!this.admin(user)) fail(403, 'Solo el administrador publica escenas.', 'owner_required');
    if (this.service.publicSceneId) fail(403, 'El perfil público contiene un único escenario fijo.', 'public_policy_locked');
    if (options.previewAllExamples !== undefined && typeof options.previewAllExamples !== 'boolean') fail(400, 'El modo de ejemplos públicos debe ser verdadero o falso.');
    if (scenes === undefined) {if (options.previewAllExamples === undefined) fail(400, 'Falta la selección o política pública.'); this.db.prepare("INSERT OR REPLACE INTO studio_settings(key,value) VALUES('public-examples-preview',?)").run(options.previewAllExamples ? '1' : '0'); return this.publicCatalog();}
    if (!Array.isArray(scenes) || scenes.length > 100 || scenes.filter(value => value.enabled !== false).length > 2) fail(400, 'Publica como máximo dos escenas activas.', 'public_scene_limit');
    const ids = new Set();
    const rows = scenes.map(value => {
      if (!plain(value) || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id) || ids.has(value.id) || !ROOM_IDS.includes(value.roomId) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160) fail(400, 'La publicación no es válida.'); ids.add(value.id);
      const projectId = value.projectId || null, document = projectId ? this.store.getProject(projectId).document : this.defaultDocument();
      const assetIds = value.assetIds || []; if (!Array.isArray(assetIds) || assetIds.some(id => !(document.imports || []).some(item => item.id === id))) fail(400, 'Los archivos publicados no son válidos.');
      const projection = this.projectProjection(document, value.roomId, assetIds);
      const requested = new Set(); (function walk(node) { if (typeof node === 'string' && (document.imports || []).some(item => item.id === node)) requested.add(node); else if (node && typeof node === 'object') Object.values(node).forEach(walk); })(projection.rooms);
      if ([...requested].some(id => !assetIds.includes(id))) fail(400, 'Selecciona los archivos que necesita la escena pública.', 'public_assets_required');
      return [value.id, projectId, value.roomId, value.name.trim(), value.enabled === false ? 0 : 1, JSON.stringify(assetIds)];
    });
    this.db.exec('BEGIN IMMEDIATE'); try { this.db.prepare('DELETE FROM studio_public_scenes').run(); for (const row of rows) this.db.prepare('INSERT INTO studio_public_scenes VALUES(?,?,?,?,?,?)').run(...row); if (options.previewAllExamples !== undefined) this.db.prepare("INSERT OR REPLACE INTO studio_settings(key,value) VALUES('public-examples-preview',?)").run(options.previewAllExamples ? '1' : '0'); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.publicCatalog();
  }
  canDownloadExamples(req) { return !!this.service.user(req, false); }
  canDownloadPublicExample(req, filename) {
    if (!/^[a-z0-9-]+\.json$/.test(filename)) return false;
    if (this.service.publicSceneId) return !!this.service.user(req, false) || filename === this.service.publicSceneId + '.json';
    if (filename === 'catalog.json' || this.previewAllExamples() || this.service.user(req, false)) return true;
    const sceneId = filename.slice(0, -5);
    return this.publicCatalog().scenes.some(scene => scene.id === sceneId);
  }
  _deleteRoomRows(roomId) {
    for (const table of ['studio_locks','studio_room_events','studio_members']) this.db.prepare('DELETE FROM ' + table + ' WHERE room_id=?').run(roomId);
    this.db.prepare('DELETE FROM studio_rooms WHERE id=?').run(roomId);
  }
  _deleteProjectRows(projectId) {
    if (this.service.administration && this.service.administration.beforeDeleteProject) this.service.administration.beforeDeleteProject(projectId);
    for (const room of this.db.prepare('SELECT id FROM studio_rooms WHERE project_id=?').all(projectId)) this._deleteRoomRows(room.id);
    for (const table of ['studio_rooms','studio_progress','studio_checkpoints','simulation_runs','studio_project_shares','studio_project_owners','revisions']) this.db.prepare('DELETE FROM ' + table + ' WHERE project_id=?').run(projectId);
    this.db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
  }
  deleteProject(user, projectId) {
    this.require(user, projectId, 'owner');
    if (this.db.prepare('SELECT 1 FROM studio_public_scenes WHERE project_id=? AND enabled=1').get(projectId)) fail(409, 'Despublica la escena antes de eliminar el proyecto.', 'project_published');
    const owner = this.owner(projectId);
    this.db.exec('BEGIN IMMEDIATE'); try { this.db.prepare('DELETE FROM studio_public_scenes WHERE project_id=?').run(projectId); this._deleteProjectRows(projectId); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    if (owner) this.removeFolder(path.join(this.userFolder(owner), 'projects', projectId));
  }
  removeFolder(folder) {
    const target = path.resolve(folder), root = path.resolve(this.usersDir) + path.sep;
    if (!target.startsWith(root) || target === root.slice(0, -1)) throw new Error('Carpeta de limpieza fuera del espacio de usuarios.');
    fs.rmSync(target, {recursive: true, force: true});
  }
  assetReferenced(hash) {
    return !!this.db.prepare("SELECT 1 FROM revisions r,json_each(r.document,'$.imports') j WHERE json_extract(j.value,'$.sha256')=? LIMIT 1").get(hash) ||
      !!this.db.prepare('SELECT 1 FROM studio_users WHERE image=? LIMIT 1').get('/api/assets/' + hash);
  }
  collectAsset(hash) {
    if (!hashPattern.test(hash) || this.db.prepare('SELECT 1 FROM studio_asset_owners WHERE asset_hash=? LIMIT 1').get(hash) || this.assetReferenced(hash)) return false;
    this.db.prepare('DELETE FROM assets WHERE hash=?').run(hash);
    const file = path.join(this.store.uploadDir, hash + '.blob'); if (path.dirname(path.resolve(file)) !== path.resolve(this.store.uploadDir)) throw new Error('Archivo de limpieza inválido.');
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } return true;
  }
  maintenance(options = {}) {
    const dryRun = options.dryRun !== false, cutoff = this.now() - 30 * DAY, result = {dryRun, inactiveDays: 30, eligible: [], deleted: [], skipped: []};
    const candidates = this.db.prepare('SELECT u.*,r.last_seen_at,r.initialized_at FROM studio_users u JOIN studio_user_resources r ON r.user_id=u.id WHERE r.last_seen_at<? AND r.initialized_at<?').all(cutoff, cutoff);
    for (const user of candidates) {
      if (this.admin(user)) { result.skipped.push({userId: user.id, reason: 'superadmin'}); continue; }
      const owned = this.db.prepare('SELECT project_id FROM studio_project_owners WHERE user_id=?').all(user.id);
      const activeHostedRoom = this.db.prepare('SELECT r.id FROM studio_rooms r JOIN studio_members m ON m.room_id=r.id WHERE r.host_id=? AND r.closed=0 AND m.active=1 AND m.user_id<>? AND m.seen_at>=? LIMIT 1').get(user.id, user.id, cutoff);
      if (activeHostedRoom) { result.skipped.push({userId: user.id, reason: 'active-shared-room', roomId: activeHostedRoom.id}); continue; }
      const protectedProject = owned.find(row => this.db.prepare('SELECT 1 FROM studio_public_scenes WHERE project_id=? AND enabled=1').get(row.project_id) ||
        this.db.prepare('SELECT 1 FROM studio_project_shares s JOIN studio_user_resources r ON r.user_id=s.user_id WHERE s.project_id=? AND r.last_seen_at>=?').get(row.project_id, cutoff) ||
        this.db.prepare('SELECT 1 FROM studio_rooms r JOIN studio_members m ON m.room_id=r.id WHERE r.project_id=? AND r.closed=0 AND m.active=1 AND m.user_id<>? AND m.seen_at>=?').get(row.project_id, user.id, cutoff));
      if (protectedProject) { result.skipped.push({userId: user.id, reason: 'active-shared-or-published-project', projectId: protectedProject.project_id}); continue; }
      const assets = this.db.prepare('SELECT asset_hash FROM studio_asset_owners WHERE user_id=?').all(user.id);
      const hostedRooms = this.db.prepare('SELECT id FROM studio_rooms WHERE host_id=?').all(user.id), usage = this.usage(user.id);
      if (!owned.length && !assets.length && !hostedRooms.length && !usage.checkpointBytes && !usage.progressBytes && !user.image) continue;
      result.eligible.push({userId: user.id, projects: owned.length, assetCount: assets.length, usedBytes: usage.usedBytes, lastSeenAt: usage.lastSeenAt});
      if (dryRun) continue;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of owned) { this.db.prepare('DELETE FROM studio_public_scenes WHERE project_id=?').run(row.project_id); this._deleteProjectRows(row.project_id); }
        for (const room of hostedRooms) this._deleteRoomRows(room.id);
        this.db.prepare('DELETE FROM studio_asset_owners WHERE user_id=?').run(user.id);
        this.db.prepare('DELETE FROM studio_checkpoints WHERE user_id=?').run(user.id);
        this.db.prepare('DELETE FROM studio_progress WHERE user_id=?').run(user.id);
        this.db.prepare('UPDATE studio_users SET image=NULL WHERE id=?').run(user.id);
        this.db.prepare('DELETE FROM studio_sessions WHERE user_id=?').run(user.id);
        this.db.prepare('INSERT INTO studio_cleanup_audit(user_id,at,details) VALUES(?,?,?)').run(user.id, this.now(), JSON.stringify({projects: owned.length, assetCount: assets.length, usedBytes: usage.usedBytes}));
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.removeFolder(this.userFolder(user.id));
      for (const item of assets) this.collectAsset(item.asset_hash);
      result.deleted.push(user.id);
    }
    return result;
  }
}

module.exports = {ProjectAccess, DEFAULT_BYTES, DAY};
