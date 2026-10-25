'use strict';

const {randomBytes, randomUUID, createHash, scrypt, timingSafeEqual} = require('node:crypto');
const {ApiError, plain, safeTree} = require('./validation');

const COOKIE = 'hello_studio_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const PRESENCE_MS = 45000;
const LOCK_MS = 6000;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;
const COLORS = /^#[a-fA-F0-9]{6}$/;
const AVATAR_BASES = ['capsule', 'robot', 'explorer'];
const DEFAULT_AVATAR = {version: 1, base: 'capsule', bodyColor: '#5cead5', accentColor: '#26364b', skinColor: '#d4a77e'};

function fail(status, message, code) { throw new ApiError(status, message, code); }
function text(value, minimum = 1, maximum = 120) {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    fail(400, 'El texto no tiene una longitud o formato válido.');
  }
  return value.trim();
}
function id(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(400, 'Identificador inválido.');
  return value;
}
function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(400, 'El número no es válido.');
  return value;
}
function object(value, limit = MAX_STATE_BYTES) {
  if (!plain(value)) fail(400, 'Se esperaba un objeto JSON.');
  safeTree(value);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > limit) fail(413, 'El estado supera el límite permitido.', 'payload_too_large');
  return encoded;
}
function avatar(value) {
  if (!plain(value) || value.version !== 1 || !AVATAR_BASES.includes(value.base)) fail(400, 'El avatar no es compatible.');
  const result = {version: 1, base: value.base};
  ['bodyColor', 'accentColor', 'skinColor'].forEach(key => {
    if (typeof value[key] !== 'string' || !COLORS.test(value[key])) fail(400, 'El color del avatar no es válido.');
    result[key] = value[key].toLowerCase();
  });
  return result;
}
function preferences(value) {
  if (!plain(value)) fail(400, 'Preferencias inválidas.');
  if (!['left', 'right'].includes(value.handedness) || !['teleport', 'smooth'].includes(value.locomotion)) {
    fail(400, 'Selecciona una mano y un modo de desplazamiento compatibles.');
  }
  return {handedness: value.handedness, locomotion: value.locomotion};
}
function pose(value) {
  if (!plain(value)) fail(400, 'Pose inválida.');
  const vector = (v, length) => {
    if (!Array.isArray(v) || v.length !== length || v.some(n => !Number.isFinite(n) || Math.abs(n) > 10000)) fail(400, 'Pose inválida.');
    return v.slice();
  };
  const result = {position: vector(value.position, 3), quaternion: vector(value.quaternion, 4)};
  const magnitude = Math.hypot.apply(null, result.quaternion);
  if (magnitude < 0.99 || magnitude > 1.01) fail(400, 'Orientación inválida.');
  if (value.left) result.left = pose(value.left);
  if (value.right) result.right = pose(value.right);
  return result;
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function derive(password, salt) {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024},
    (error, key) => error ? reject(error) : resolve(key)));
}
function cookieToken(req) {
  const cookies = (req.headers.cookie || '').split(';');
  const matches = cookies.map(part => part.trim()).filter(part => part.startsWith(COOKIE + '='));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

// The project database remains the only durable store. All tables are additive;
// existing projects, revisions and binary files are left in their original place.
class StudioService {
  constructor(options) {
    if (!options || !options.store || !options.store.db) throw new Error('Studio necesita el almacén del proyecto.');
    this.store = options.store;
    this.db = options.store.db;
    this.json = options.json;
    this.readBody = options.readBody;
    this.verifyWrite = options.verifyWrite;
    this.now = options.now || Date.now;
    this.rate = new Map();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL, avatar TEXT NOT NULL, image TEXT, preferences TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('creator','viewer')), created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_sessions_expiry ON studio_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS studio_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_progress (
        user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id),
        mission_id TEXT NOT NULL, mission_version INTEGER NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, project_id, mission_id)
      );
      CREATE TABLE IF NOT EXISTS studio_checkpoints (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id), project_revision INTEGER NOT NULL,
        version INTEGER NOT NULL, name TEXT NOT NULL, room_id TEXT NOT NULL, state TEXT NOT NULL,
        created_at INTEGER NOT NULL, FOREIGN KEY(project_id,project_revision) REFERENCES revisions(project_id,revision)
      );
      CREATE INDEX IF NOT EXISTS studio_checkpoints_user ON studio_checkpoints(user_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS studio_rooms (
        id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, host_id TEXT NOT NULL REFERENCES studio_users(id),
        project_id TEXT NOT NULL REFERENCES projects(id), project_revision INTEGER NOT NULL,
        room_id TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
        state_sequence INTEGER NOT NULL DEFAULT 0,
        next_sequence INTEGER NOT NULL DEFAULT 1, closed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        FOREIGN KEY(project_id,project_revision) REFERENCES revisions(project_id,revision)
      );
      CREATE TABLE IF NOT EXISTS studio_members (
        room_id TEXT NOT NULL REFERENCES studio_rooms(id), user_id TEXT NOT NULL REFERENCES studio_users(id),
        role TEXT NOT NULL CHECK(role IN ('host','participant','observer')), active INTEGER NOT NULL DEFAULT 1,
        pose TEXT, seen_at INTEGER NOT NULL, PRIMARY KEY(room_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS studio_room_events (
        room_id TEXT NOT NULL REFERENCES studio_rooms(id), sequence INTEGER NOT NULL, user_id TEXT NOT NULL,
        type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(room_id,sequence)
      );
      CREATE TABLE IF NOT EXISTS studio_locks (
        room_id TEXT NOT NULL REFERENCES studio_rooms(id), object_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES studio_users(id), expires_at INTEGER NOT NULL,
        PRIMARY KEY(room_id,object_id)
      );
    `);
    // Additive migration for installations created by the first Studio build.
    // Row insertion order identifies its original local account unambiguously.
    if (!this.db.prepare("SELECT value FROM studio_settings WHERE key='owner'").get()) {
      const first = this.db.prepare('SELECT id FROM studio_users ORDER BY rowid LIMIT 1').get();
      if (first) this.db.prepare("INSERT OR IGNORE INTO studio_settings VALUES('owner',?)").run(first.id);
    }
  }

  _owner(userId) {
    const setting = this.db.prepare("SELECT value FROM studio_settings WHERE key='owner'").get();
    return !!setting && setting.value === userId;
  }

  _profile(row) {
    return {id: row.id, username: row.username, displayName: row.display_name, avatar: JSON.parse(row.avatar),
      profileImage: row.image, preferences: JSON.parse(row.preferences), role: row.role,
      permissions: {editor: row.role === 'creator', createProject: row.role === 'creator', manageUsers: this._owner(row.id)}};
  }

  user(req, required = true) {
    const token = cookieToken(req);
    const row = token && this.db.prepare(`SELECT u.* FROM studio_sessions s JOIN studio_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(hash(token), this.now());
    if (!row && required) fail(401, 'Inicia sesión para continuar.', 'authentication_required');
    return row || null;
  }

  requireEditor(req) {
    // Local projects created before accounts remain accessible until an account
    // is configured. Once configured, mutations require a real creator session.
    if (!this.db.prepare('SELECT 1 FROM studio_users LIMIT 1').get()) return null;
    const user = this.user(req);
    this._expectedUser(req, user);
    if (user.role !== 'creator') fail(403, 'Tu cuenta no tiene permiso para editar.', 'editor_forbidden');
    return user;
  }

  _expectedUser(req, user) {
    const expected = req.headers['x-studio-user'];
    if (expected !== undefined && (!user || expected !== user.id)) {
      fail(409, 'La cuenta cambió en otra ventana. Recarga Studio antes de continuar.', 'session_changed');
    }
  }

  _limit(req, key, maximum, span) {
    const address = req.socket && req.socket.remoteAddress || 'local';
    const rateKey = key + ':' + address;
    const now = this.now();
    let item = this.rate.get(rateKey);
    if (!item || now >= item.until) item = {count: 0, until: now + span};
    if (++item.count > maximum) fail(429, 'Demasiados intentos. Vuelve a intentarlo más tarde.', 'rate_limited');
    this.rate.set(rateKey, item);
    if (this.rate.size > 4096) for (const [key, entry] of this.rate) if (entry.until < now) this.rate.delete(key);
  }

  _cookie(req, res, token, maxAge = SESSION_MS / 1000) {
    const secure = !!(req.socket && req.socket.encrypted);
    res.setHeader('Set-Cookie', COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : ''));
  }

  _session(req, res, user) {
    this.db.prepare('DELETE FROM studio_sessions WHERE expires_at<=?').run(this.now());
    // Rotate this browser's previous session, including on account switches.
    const previous = cookieToken(req);
    if (previous) this.db.prepare('DELETE FROM studio_sessions WHERE token_hash=?').run(hash(previous));
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO studio_sessions VALUES(?,?,?)').run(hash(token), user.id, this.now() + SESSION_MS);
    this._cookie(req, res, token);
    return this._profile(user);
  }

  _project(projectId, revision) {
    const project = this.store.getProject(id(projectId), integer(revision, 1));
    return project;
  }

  _compatible(projectId, revision) {
    const latest = this.store.getProject(projectId);
    if (latest.revision !== revision) fail(409, 'El proyecto cambió desde este guardado. Abre su revisión original para reanudarlo.', 'checkpoint_incompatible');
  }

  _checkpoint(row, includeState = false) {
    const result = {id: row.id, version: row.version, projectId: row.project_id, projectRevision: row.project_revision,
      name: row.name, roomId: row.room_id, createdAt: new Date(row.created_at).toISOString()};
    const project = this.db.prepare('SELECT revision FROM projects WHERE id=?').get(row.project_id);
    result.compatible = !!project && project.revision === row.project_revision;
    if (includeState) result.state = JSON.parse(row.state);
    return result;
  }

  _room(roomId, user, touch = true) {
    const room = this.db.prepare('SELECT * FROM studio_rooms WHERE id=? AND closed=0').get(id(roomId));
    if (!room) fail(404, 'La sala no está disponible.', 'room_not_found');
    const member = this.db.prepare('SELECT * FROM studio_members WHERE room_id=? AND user_id=? AND active=1').get(room.id, user.id);
    if (!member) fail(403, 'Debes unirte a esta sala.', 'room_forbidden');
    if (touch) this.db.prepare('UPDATE studio_members SET seen_at=? WHERE room_id=? AND user_id=?').run(this.now(), room.id, user.id);
    return {room, member};
  }

  _event(roomId, userId, type, payload) {
    const room = this.db.prepare('SELECT next_sequence FROM studio_rooms WHERE id=?').get(roomId);
    const sequence = room.next_sequence;
    this.db.prepare('INSERT INTO studio_room_events VALUES(?,?,?,?,?,?)').run(roomId, sequence, userId, type, JSON.stringify(payload), this.now());
    this.db.prepare('UPDATE studio_rooms SET next_sequence=next_sequence+1 WHERE id=?').run(roomId);
    // A snapshot carries current state. Keep a bounded recent action window and
    // tell lagging clients to recover the snapshot instead of silently skipping.
    this.db.prepare('DELETE FROM studio_room_events WHERE room_id=? AND sequence<?').run(roomId, sequence - 1000);
    return sequence;
  }

  _roomResult(room, member, after = 0) {
    this.db.prepare('DELETE FROM studio_locks WHERE expires_at<=?').run(this.now());
    this.db.prepare(`DELETE FROM studio_locks WHERE room_id=? AND user_id IN
      (SELECT user_id FROM studio_members WHERE room_id=? AND (active=0 OR seen_at<?))`).run(room.id, room.id, this.now() - PRESENCE_MS);
    const members = this.db.prepare(`SELECT m.*,u.username,u.display_name,u.avatar,u.image FROM studio_members m
      JOIN studio_users u ON u.id=m.user_id WHERE m.room_id=? AND m.active=1 ORDER BY m.role,m.user_id`).all(room.id);
    const latestSequence = room.next_sequence - 1;
    const oldest = this.db.prepare('SELECT MIN(sequence) AS first FROM studio_room_events WHERE room_id=?').get(room.id).first;
    const needsSnapshot = after === 0 || oldest !== null && after < oldest - 1;
    const eventCursor = needsSnapshot ? room.state_sequence : after;
    if (needsSnapshot && oldest !== null && eventCursor < oldest - 1) {
      fail(409, 'El anfitrión debe actualizar el estado antes de recuperar esta sala.', 'room_snapshot_stale');
    }
    const events = this.db.prepare('SELECT * FROM studio_room_events WHERE room_id=? AND sequence>? ORDER BY sequence LIMIT 1000').all(room.id, eventCursor);
    return {id: room.id, code: room.code, name: room.name, projectId: room.project_id, projectRevision: room.project_revision,
      roomId: room.room_id, hostId: room.host_id, role: member.role, revision: room.revision, sequence: latestSequence,
      stateSequence: room.state_sequence,
      needsSnapshot, state: needsSnapshot ? JSON.parse(room.state) : undefined,
      // Every poll carries snapshot revision so clients can retrieve it when a
      // host checkpoint advances even without a missing action in their cursor.
      participants: members.map(row => ({id: row.user_id, displayName: row.display_name, username: row.username,
        avatar: JSON.parse(row.avatar), profileImage: row.image, role: row.role,
        online: row.seen_at > this.now() - PRESENCE_MS, pose: row.pose && JSON.parse(row.pose)})),
      locks: this.db.prepare('SELECT object_id AS objectId,user_id AS userId,expires_at AS expiresAt FROM studio_locks WHERE room_id=?').all(room.id),
      events: events.map(row => ({sequence: row.sequence, userId: row.user_id, type: row.type, payload: JSON.parse(row.payload), at: row.created_at})),
      permissions: {save: member.role === 'host', reset: member.role === 'host', manipulate: member.role !== 'observer'}};
  }

  async handle(req, res, pathname) {
    pathname = pathname || new URL(req.originalUrl || req.url, 'http://studio.invalid').pathname;
    if (pathname.startsWith('/api/')) pathname = pathname.slice(4);
    if (!/^\/studio(?:\/|$)/.test(pathname)) return false;
    const parts = pathname.split('/').filter(Boolean).slice(1);
    const method = req.method;
    const url = new URL(req.originalUrl || req.url, 'http://studio.invalid');
    const send = (status, value) => this.json(res, status, value, method);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) this.verifyWrite(req);
    const body = async (limit = 65536) => {
      const value = await this.readBody(req, limit, 'La solicitud de Studio supera el límite permitido.');
      object(value, limit);
      return value;
    };

    if (parts.length === 1 && parts[0] === 'me' && method === 'GET') {
      const user = this.user(req, false);
      send(200, {user: user && this._profile(user), configured: !!this.db.prepare('SELECT 1 FROM studio_users LIMIT 1').get(),
        capabilities: {accounts: true, avatars: AVATAR_BASES, recovery: false, rooms: true, roomTransport: 'http-poll',
          checkpointVersion: 1, maxStateBytes: MAX_STATE_BYTES, sharedEditing: false}});
    } else if (parts.length === 1 && parts[0] === 'register' && method === 'POST') {
      this._limit(req, 'register', 10, 3600000);
      const data = await body();
      const username = text(data.username, 3, 48).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{2,47}$/.test(username)) fail(400, 'El usuario admite letras, números, punto, guion y guion bajo.');
      if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 256) fail(400, 'Usa una contraseña de entre 12 y 256 caracteres.');
      if (this.db.prepare('SELECT 1 FROM studio_users WHERE username=?').get(username)) fail(409, 'Este usuario ya existe.', 'username_unavailable');
      const displayName = text(data.displayName || username, 1, 80);
      const salt = randomBytes(32).toString('hex');
      const passwordHash = (await derive(data.password, salt)).toString('hex');
      const userId = randomUUID();
      // Only the original local account receives creator access automatically.
      // Subsequent registrations can explore/join rooms; that owner explicitly
      // authorizes additional creators through the protected role endpoint.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const owner = this.db.prepare("SELECT value FROM studio_settings WHERE key='owner'").get();
        this.db.prepare('INSERT INTO studio_users VALUES(?,?,?,?,?,?,?,?,?,?)').run(userId, username, salt, passwordHash,
          displayName, JSON.stringify(DEFAULT_AVATAR), null, JSON.stringify({handedness: 'right', locomotion: 'smooth'}), owner ? 'viewer' : 'creator', this.now());
        if (!owner) this.db.prepare("INSERT INTO studio_settings VALUES('owner',?)").run(userId);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        if (this.db.prepare('SELECT 1 FROM studio_users WHERE username=?').get(username)) fail(409, 'Este usuario ya existe.', 'username_unavailable');
        throw error;
      }
      send(201, {user: this._session(req, res, this.db.prepare('SELECT * FROM studio_users WHERE id=?').get(userId))});
    } else if (parts.length === 1 && parts[0] === 'login' && method === 'POST') {
      this._limit(req, 'login', 30, 15 * 60000);
      const data = await body();
      const username = text(data.username, 3, 48).toLowerCase();
      if (typeof data.password !== 'string' || data.password.length > 256) fail(401, 'Usuario o contraseña incorrectos.', 'invalid_credentials');
      const row = this.db.prepare('SELECT * FROM studio_users WHERE username=?').get(username);
      const candidate = await derive(data.password, row ? row.salt : 'unknown-user-constant-cost');
      const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
      if (!row || !timingSafeEqual(candidate, expected)) fail(401, 'Usuario o contraseña incorrectos.', 'invalid_credentials');
      send(200, {user: this._session(req, res, row)});
    } else if (parts.length === 1 && parts[0] === 'logout' && method === 'POST') {
      const user = this.user(req, false);
      if (user) this._expectedUser(req, user);
      const token = cookieToken(req);
      if (token) this.db.prepare('DELETE FROM studio_sessions WHERE token_hash=?').run(hash(token));
      this._cookie(req, res, '', 0);
      send(200, {ok: true});
    } else {
      const user = this.user(req);
      this._expectedUser(req, user);
      if (parts.length === 1 && parts[0] === 'users' && method === 'GET') {
        if (!this._owner(user.id)) fail(403, 'Solo la cuenta propietaria administra los permisos.', 'owner_required');
        send(200, {users: this.db.prepare('SELECT * FROM studio_users ORDER BY created_at,rowid').all().map(row => this._profile(row))});
      } else if (parts.length === 3 && parts[0] === 'users' && parts[2] === 'role' && method === 'PUT') {
        if (!this._owner(user.id)) fail(403, 'Solo la cuenta propietaria administra los permisos.', 'owner_required');
        const targetId = id(parts[1]), data = await body();
        if (!['creator', 'viewer'].includes(data.role)) fail(400, 'Rol de cuenta no compatible.');
        if (this._owner(targetId)) fail(403, 'El permiso de la cuenta propietaria debe conservarse.', 'owner_protected');
        if (!this.db.prepare('SELECT 1 FROM studio_users WHERE id=?').get(targetId)) fail(404, 'La cuenta no existe.', 'not_found');
        this.db.prepare('UPDATE studio_users SET role=? WHERE id=?').run(data.role, targetId);
        send(200, {user: this._profile(this.db.prepare('SELECT * FROM studio_users WHERE id=?').get(targetId))});
      } else if (parts.length === 1 && parts[0] === 'profile' && method === 'PUT') {
        const data = await body();
        const displayName = data.displayName === undefined ? user.display_name : text(data.displayName, 1, 80);
        const avatarValue = data.avatar === undefined ? JSON.parse(user.avatar) : avatar(data.avatar);
        const preferenceValue = data.preferences === undefined ? JSON.parse(user.preferences) : preferences(data.preferences);
        // Images are existing binary imports, never arbitrary remote tracking URLs.
        let image = data.profileImage === undefined ? user.image : data.profileImage;
        if (image !== null) {
          if (typeof image !== 'string' || !/^\/api\/assets\/[a-f0-9]{64}$/.test(image)) fail(400, 'Selecciona una imagen importada en este servidor.');
          const asset = this.store.asset(image.slice('/api/assets/'.length));
          if (!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(asset.mime)) fail(400, 'La imagen de perfil debe ser una imagen raster compatible.');
        }
        this.db.prepare('UPDATE studio_users SET display_name=?,avatar=?,image=?,preferences=? WHERE id=?')
          .run(displayName, JSON.stringify(avatarValue), image, JSON.stringify(preferenceValue), user.id);
        send(200, {user: this._profile(this.db.prepare('SELECT * FROM studio_users WHERE id=?').get(user.id))});
      } else if (parts.length === 1 && parts[0] === 'progress' && method === 'GET') {
        const projectId = id(url.searchParams.get('projectId'));
        this.store.getProject(projectId);
        const rows = this.db.prepare('SELECT * FROM studio_progress WHERE user_id=? AND project_id=? ORDER BY mission_id').all(user.id, projectId);
        send(200, {progress: rows.map(row => ({projectId, missionId: row.mission_id, missionVersion: row.mission_version,
          value: JSON.parse(row.value), updatedAt: new Date(row.updated_at).toISOString()}))});
      } else if (parts.length === 1 && parts[0] === 'progress' && method === 'PUT') {
        const data = await body();
        const projectId = id(data.projectId), missionId = id(data.missionId), missionVersion = integer(data.missionVersion, 1);
        this.store.getProject(projectId);
        const value = object(data.value, 32768);
        const previous = this.db.prepare('SELECT mission_version FROM studio_progress WHERE user_id=? AND project_id=? AND mission_id=?')
          .get(user.id, projectId, missionId);
        if (previous && previous.mission_version !== missionVersion && data.replaceVersion !== true) fail(409, 'La versión de esta misión cambió. Confirma el reinicio de su progreso.', 'progress_incompatible');
        const now = this.now();
        this.db.prepare(`INSERT INTO studio_progress VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,project_id,mission_id)
          DO UPDATE SET mission_version=excluded.mission_version,value=excluded.value,updated_at=excluded.updated_at`)
          .run(user.id, projectId, missionId, missionVersion, value, now);
        send(200, {progress: {projectId, missionId, missionVersion, value: JSON.parse(value), updatedAt: new Date(now).toISOString()}});
      } else if (parts.length === 1 && parts[0] === 'checkpoints' && method === 'GET') {
        const rows = this.db.prepare('SELECT * FROM studio_checkpoints WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
        send(200, {checkpoints: rows.map(row => this._checkpoint(row))});
      } else if (parts.length === 1 && parts[0] === 'checkpoints' && method === 'POST') {
        const data = await body(MAX_STATE_BYTES + 16384);
        this._project(data.projectId, data.projectRevision);
        this._compatible(data.projectId, data.projectRevision);
        if (data.version !== 1) fail(409, 'El formato de sesión no es compatible.', 'checkpoint_incompatible');
        const state = object(data.state);
        const checkpointId = randomUUID();
        this.db.prepare('INSERT INTO studio_checkpoints VALUES(?,?,?,?,?,?,?,?,?)').run(checkpointId, user.id,
          data.projectId, data.projectRevision, 1, text(data.name, 1, 120), id(data.roomId), state, this.now());
        // Bounded retention per account avoids indefinitely growing snapshots.
        this.db.prepare(`DELETE FROM studio_checkpoints WHERE user_id=? AND id NOT IN
          (SELECT id FROM studio_checkpoints WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)`).run(user.id, user.id);
        send(201, {checkpoint: this._checkpoint(this.db.prepare('SELECT * FROM studio_checkpoints WHERE id=?').get(checkpointId), true)});
      } else if (parts.length === 2 && parts[0] === 'checkpoints' && ['GET', 'DELETE'].includes(method)) {
        const row = this.db.prepare('SELECT * FROM studio_checkpoints WHERE id=? AND user_id=?').get(id(parts[1]), user.id);
        if (!row) fail(404, 'La sesión guardada no existe.', 'not_found');
        if (method === 'DELETE') {
          this.db.prepare('DELETE FROM studio_checkpoints WHERE id=? AND user_id=?').run(row.id, user.id);
          send(200, {ok: true});
        } else {
          this._compatible(row.project_id, row.project_revision);
          send(200, {checkpoint: this._checkpoint(row, true)});
        }
      } else if (parts.length === 1 && parts[0] === 'rooms' && method === 'POST') {
        this._limit(req, 'room-create-' + user.id, 30, 3600000);
        const data = await body(MAX_STATE_BYTES + 16384);
        this._project(data.projectId, data.projectRevision);
        this._compatible(data.projectId, data.projectRevision);
        const state = object(data.state || {});
        const roomId = randomUUID(), code = randomBytes(6).toString('hex').toUpperCase();
        const name = text(data.name || 'Sala compartida', 1, 100);
        this.db.prepare('INSERT INTO studio_rooms(id,code,host_id,project_id,project_revision,room_id,name,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(roomId, code, user.id, data.projectId, data.projectRevision, id(data.roomId), name, state, this.now());
        this.db.prepare('INSERT INTO studio_members(room_id,user_id,role,seen_at) VALUES(?,?,?,?)').run(roomId, user.id, 'host', this.now());
        const context = this._room(roomId, user);
        send(201, {room: this._roomResult(context.room, context.member)});
      } else if (parts.length === 2 && parts[0] === 'rooms' && parts[1] === 'join' && method === 'POST') {
        this._limit(req, 'join', 60, 60000);
        const data = await body();
        const code = text(data.code, 12, 12).toUpperCase();
        const room = this.db.prepare('SELECT * FROM studio_rooms WHERE code=? AND closed=0').get(code);
        if (!room) fail(404, 'Código de sala incorrecto o sala cerrada.', 'room_not_found');
        const previous = this.db.prepare('SELECT * FROM studio_members WHERE room_id=? AND user_id=?').get(room.id, user.id);
        const count = this.db.prepare('SELECT COUNT(*) AS count FROM studio_members WHERE room_id=? AND active=1 AND seen_at>?').get(room.id, this.now() - PRESENCE_MS).count;
        if (count >= 16 && (!previous || !previous.active || previous.seen_at <= this.now() - PRESENCE_MS)) fail(409, 'Esta sala alcanzó el límite de 16 participantes.', 'room_full');
        const role = room.host_id === user.id ? 'host' : data.role === 'observer' ? 'observer' : 'participant';
        this.db.prepare(`INSERT INTO studio_members(room_id,user_id,role,active,pose,seen_at) VALUES(?,?,?,1,NULL,?)
          ON CONFLICT(room_id,user_id) DO UPDATE SET role=excluded.role,active=1,seen_at=excluded.seen_at`)
          .run(room.id, user.id, role, this.now());
        if (role === 'observer') this.db.prepare('DELETE FROM studio_locks WHERE room_id=? AND user_id=?').run(room.id, user.id);
        this._event(room.id, user.id, 'joined', {role});
        const context = this._room(room.id, user);
        send(200, {room: this._roomResult(context.room, context.member)});
      } else if (parts.length >= 2 && parts[0] === 'rooms') {
        const context = this._room(parts[1], user), room = context.room, member = context.member;
        if (parts.length === 2 && method === 'GET') {
          const cursor = url.searchParams.get('after') || '0';
          if (!/^\d{1,16}$/.test(cursor)) fail(400, 'Cursor inválido.');
          const after = integer(Number(cursor));
          if (after > room.next_sequence - 1) fail(409, 'El cursor de la sala se reinició. Recupera su estado.', 'room_cursor_invalid');
          send(200, {room: this._roomResult(room, member, after)});
        } else if (parts.length === 3 && parts[2] === 'pose' && method === 'POST') {
          const data = await body(4096);
          this.db.prepare('UPDATE studio_members SET pose=?,seen_at=? WHERE room_id=? AND user_id=?').run(JSON.stringify(pose(data)), this.now(), room.id, user.id);
          send(200, {ok: true});
        } else if (parts.length === 3 && parts[2] === 'state' && method === 'PUT') {
          if (member.role !== 'host') fail(403, 'Solo el anfitrión puede guardar el estado compartido.', 'host_required');
          const data = await body(MAX_STATE_BYTES + 16384);
          if (integer(data.expectedRevision) !== room.revision) fail(409, 'El estado compartido cambió; vuelve a consultarlo.', 'room_revision_conflict');
          const appliedSequence = integer(data.appliedSequence, room.state_sequence, room.next_sequence - 1);
          const state = object(data.state);
          this.db.prepare('UPDATE studio_rooms SET state=?,state_sequence=?,revision=revision+1 WHERE id=? AND revision=?').run(state, appliedSequence, room.id, room.revision);
          const sequence = this._event(room.id, user.id, 'state', {revision: room.revision + 1});
          send(200, {revision: room.revision + 1, sequence});
        } else if (parts.length === 3 && parts[2] === 'action' && method === 'POST') {
          if (member.role === 'observer') fail(403, 'Los observadores no manipulan objetos.', 'observer_readonly');
          this._limit(req, 'room-action-' + user.id, 240, 10000);
          const data = await body(16384);
          if (!['control', 'grab', 'release', 'pose-object', 'simulation'].includes(data.type)) fail(400, 'Acción de sala no compatible.');
          const payload = {type: data.type};
          if (data.type === 'simulation') {
            if (member.role !== 'host') fail(403, 'Solo el anfitrión puede iniciar, pausar o reiniciar.', 'host_required');
            if (!['start', 'pause', 'resume', 'reset'].includes(data.action)) fail(400, 'Acción de simulación inválida.');
            payload.action = data.action;
            if (data.action === 'reset') this.db.prepare('DELETE FROM studio_locks WHERE room_id=?').run(room.id);
          } else {
            payload.objectId = id(data.objectId);
            const lock = this.db.prepare('SELECT * FROM studio_locks WHERE room_id=? AND object_id=? AND expires_at>?').get(room.id, payload.objectId, this.now());
            const hostRelease = data.type === 'release' && member.role === 'host';
            if (lock && lock.user_id !== user.id && !hostRelease) fail(409, 'Otra persona está manipulando este objeto.', 'object_locked');
            if (data.type === 'grab') {
              this.db.prepare(`INSERT INTO studio_locks VALUES(?,?,?,?) ON CONFLICT(room_id,object_id)
                DO UPDATE SET user_id=excluded.user_id,expires_at=excluded.expires_at`).run(room.id, payload.objectId, user.id, this.now() + LOCK_MS);
            } else if (data.type === 'release') {
              if (!lock || lock.user_id !== user.id && !hostRelease) fail(409, 'El objeto ya no está reservado por esta cuenta.', 'lock_expired');
              this.db.prepare('DELETE FROM studio_locks WHERE room_id=? AND object_id=?').run(room.id, payload.objectId);
              payload.ownerId = lock.user_id;
              if (hostRelease && data.reason !== undefined) payload.reason = text(data.reason, 1, 200);
              if (data.pose) payload.pose = pose(data.pose);
            } else if (data.type === 'pose-object') {
              if (!lock || lock.user_id !== user.id) fail(409, 'Reserva el objeto antes de moverlo.', 'lock_required');
              payload.pose = pose(data.pose);
              this.db.prepare('UPDATE studio_locks SET expires_at=? WHERE room_id=? AND object_id=? AND user_id=?').run(this.now() + LOCK_MS, room.id, payload.objectId, user.id);
            } else {
              payload.action = text(data.action, 1, 64);
              if (data.scope !== undefined) {
                if (!['module', 'segment', 'line'].includes(data.scope)) fail(400, 'Ámbito de control inválido.');
                payload.scope = data.scope;
              }
              if (data.value !== undefined) {
                if (!['number', 'boolean', 'string'].includes(typeof data.value) || typeof data.value === 'string' && data.value.length > 200 || typeof data.value === 'number' && !Number.isFinite(data.value)) fail(400, 'Valor de control inválido.');
                payload.value = data.value;
              }
            }
          }
          const sequence = this._event(room.id, user.id, 'action', payload);
          send(200, {sequence, accepted: true});
        } else if (parts.length === 3 && parts[2] === 'leave' && method === 'POST') {
          this.db.prepare('UPDATE studio_members SET active=0 WHERE room_id=? AND user_id=?').run(room.id, user.id);
          this.db.prepare('DELETE FROM studio_locks WHERE room_id=? AND user_id=?').run(room.id, user.id);
          this._event(room.id, user.id, 'left', {});
          // The host can reconnect with the invitation code. The durable room
          // stays available; guests see host online=false and pause authority.
          send(200, {ok: true});
        } else fail(404, 'Ruta de Studio no encontrada.', 'not_found');
      } else fail(404, 'Ruta de Studio no encontrada.', 'not_found');
    }
    return true;
  }
}

module.exports = {StudioService, DEFAULT_AVATAR, AVATAR_BASES, COOKIE, LOCK_MS, PRESENCE_MS, MAX_STATE_BYTES};
