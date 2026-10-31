'use strict';

const {randomUUID, randomBytes, createHash, scrypt} = require('node:crypto');
const {ApiError, plain, safeTree} = require('./validation');
const fail = (status, message, code = 'invalid_request') => { throw new ApiError(status, message, code); };
const text = (value, max = 120, optional = false) => {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail(400, 'El texto no tiene un formato válido.');
  return value.trim();
};
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'El número está fuera del intervalo permitido.'); return value; };
const digest = value => createHash('sha256').update(value).digest('hex');
const derive = (password, salt) => new Promise((resolve, reject) => scrypt(password, salt, 64, {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024}, (error, key) => error ? reject(error) : resolve(key)));

/** Teaching administration. All data APIs are owner-only; passwords, session
 * tokens and complete invitation codes are excluded from persisted audit data. */
class StudioAdministration {
  constructor(service) {
    this.service = service; this.db = service.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_class_groups (
        id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES studio_users(id),created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_class_members (
        group_id TEXT NOT NULL REFERENCES studio_class_groups(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
        joined_at INTEGER NOT NULL,PRIMARY KEY(group_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS studio_registration_codes (
        code_hash TEXT PRIMARY KEY,hint TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('creator','viewer')),
        group_id TEXT REFERENCES studio_class_groups(id) ON DELETE SET NULL,max_uses INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_by TEXT NOT NULL REFERENCES studio_users(id),created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_class_assignments (
        id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES studio_class_groups(id) ON DELETE CASCADE,title TEXT NOT NULL,instructions TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,template_id TEXT NOT NULL,due_at INTEGER,created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_class_evaluations (
        assignment_id TEXT NOT NULL REFERENCES studio_class_assignments(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
        score REAL NOT NULL,feedback TEXT NOT NULL,evaluator_id TEXT NOT NULL REFERENCES studio_users(id),updated_at INTEGER NOT NULL,PRIMARY KEY(assignment_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS studio_admin_audit (
        id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,type TEXT NOT NULL,target_id TEXT,detail TEXT NOT NULL,created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_admin_audit_created ON studio_admin_audit(created_at);
    `);
  }
  now() { return this.service.now(); }
  owner(req) { const user = this.service.user(req); this.service._expectedUser(req, user); if (!this.service._owner(user.id)) fail(403, 'Sólo el superadministrador gestiona esta información.', 'owner_required'); return user; }
  audit(actor, type, target, detail = {}) {
    this.db.prepare('INSERT INTO studio_admin_audit VALUES(?,?,?,?,?,?)').run(randomUUID(), actor.id, type, target || null, JSON.stringify(detail), this.now());
    this.db.prepare('DELETE FROM studio_admin_audit WHERE id IN (SELECT id FROM studio_admin_audit ORDER BY created_at DESC,id LIMIT -1 OFFSET 10000)').run();
  }
  policy() { const row = this.db.prepare("SELECT value FROM studio_settings WHERE key='registration_invitation_only'").get(); return {invitationOnly: !!row && row.value === 'true', inactiveDays: 30, defaultMaxProjects: 2, defaultStorageBytes: 20 * 1024 * 1024}; }
  consumeRegistrationCode(value) {
    if (!value) { if (this.policy().invitationOnly && this.db.prepare('SELECT 1 FROM studio_users LIMIT 1').get()) fail(403, 'Necesitas un código de registro del docente.', 'registration_code_required'); return null; }
    const code = text(value, 80).toUpperCase().replace(/\s/g, ''), hash = digest(code);
    const row = this.db.prepare('SELECT * FROM studio_registration_codes WHERE code_hash=?').get(hash);
    if (!row || row.revoked || row.expires_at <= this.now() || row.used >= row.max_uses) fail(400, 'El código no existe, expiró o agotó sus usos.', 'registration_code_invalid');
    const result = this.db.prepare('UPDATE studio_registration_codes SET used=used+1 WHERE code_hash=? AND used<max_uses AND revoked=0 AND expires_at>?').run(hash, this.now());
    if (result.changes !== 1) fail(409, 'El código ya no está disponible.', 'registration_code_invalid');
    return {role: row.role, groupId: row.group_id, codeHash: hash};
  }
  recordRegistration(userId, invitation) { if (invitation && invitation.groupId) this.db.prepare('INSERT OR IGNORE INTO studio_class_members VALUES(?,?,?)').run(invitation.groupId, userId, this.now()); }
  profiles() { return this.db.prepare('SELECT * FROM studio_users ORDER BY created_at,rowid').all().map(row => this.service._profile(row)); }
  groups() {
    return this.db.prepare('SELECT * FROM studio_class_groups ORDER BY created_at DESC,id').all().map(row => ({id: row.id, name: row.name, description: row.description,
      createdAt: row.created_at, members: this.db.prepare('SELECT user_id AS userId,joined_at AS joinedAt FROM studio_class_members WHERE group_id=? ORDER BY joined_at,user_id').all(row.id),
      assignments: this.db.prepare('SELECT id,title,instructions,project_id AS projectId,template_id AS templateId,due_at AS dueAt FROM studio_class_assignments WHERE group_id=? ORDER BY created_at,id').all(row.id)}));
  }
  report(groupId, userId) {
    const group = groupId ? this.groups().find(value => value.id === groupId) : null;
    if (groupId && !group) fail(404, 'El grupo no existe.', 'not_found');
    const ids = group ? new Set(group.members.map(value => value.userId)) : null;
    let rows;
    if (userId !== undefined && userId !== null) {
      const selected = this.db.prepare('SELECT * FROM studio_users WHERE id=?').get(text(userId, 200));
      if (!selected || ids && !ids.has(selected.id)) fail(404, 'El usuario no existe en el alcance solicitado.', 'not_found');
      rows = [selected];
    } else rows = this.db.prepare('SELECT * FROM studio_users ORDER BY display_name,id').all().filter(row => !ids || ids.has(row.id));
    const students = rows.map(row => {
      const profile = this.service._profile(row), progress = this.db.prepare('SELECT project_id,mission_id,value,updated_at FROM studio_progress WHERE user_id=? ORDER BY updated_at DESC LIMIT 1000').all(row.id);
      const missions = progress.map(value => { const p = JSON.parse(value.value); return {projectId: value.project_id, missionId: value.mission_id, step: p.step, count: p.count, status: p.status, updatedAt: value.updated_at}; });
      const projects = this.service.access ? this.service.access.list(row).filter(project => !project.access || project.access.ownerId === row.id) : [];
      const grades = this.db.prepare('SELECT e.assignment_id AS assignmentId,e.score,e.feedback,e.updated_at AS updatedAt,a.group_id AS groupId,a.title FROM studio_class_evaluations e JOIN studio_class_assignments a ON a.id=e.assignment_id WHERE e.user_id=? ORDER BY e.updated_at DESC').all(row.id).filter(value => !groupId || value.groupId === groupId);
      const checkpoints = this.db.prepare('SELECT count(*) AS total,max(created_at) AS lastAt FROM studio_checkpoints WHERE user_id=?').get(row.id);
      return {user: profile, projects: projects.map(project => ({id: project.id, name: project.name, revision: project.revision, updatedAt: project.updatedAt, access: project.access})),
        progress: missions, completed: missions.filter(value => value.status === 'completed').length, recordedMissions: missions.length,
        completionPercent: missions.length ? Math.round(missions.filter(value => value.status === 'completed').length * 100 / missions.length) : 0,
        checkpoints, evaluations: grades, averageScore: grades.length ? grades.reduce((sum, value) => sum + value.score, 0) / grades.length : null};
    });
    return {generatedAt: this.now(), group: group && {id: group.id, name: group.name, assignments: group.assignments}, students,
      totals: {users: students.length, projects: students.reduce((sum, value) => sum + value.projects.length, 0), completedMissions: students.reduce((sum, value) => sum + value.completed, 0)},
      progressSource: 'Progreso registrado por la aplicación; la calificación del docente es independiente.'};
  }
  async handle(req, res, url, pathname) {
    const normalized = pathname.replace(/^\/api(?=\/)/, '');
    if (normalized === '/studio/classroom' && req.method === 'GET') {
      const user = this.service.user(req); this.service._expectedUser(req, user);
      const groups = this.groups().filter(group => group.members.some(member => member.userId === user.id)).map(group => ({id: group.id, name: group.name, description: group.description,
        assignments: group.assignments.map(assignment => Object.assign({}, assignment, {projectAccessible: !!assignment.projectId && !!(this.service.access && this.service.access.canRead(user, assignment.projectId)),
          evaluation: this.db.prepare('SELECT score,feedback,updated_at AS updatedAt FROM studio_class_evaluations WHERE assignment_id=? AND user_id=?').get(assignment.id, user.id) || null}))}));
      this.service.json(res, 200, {groups}, req.method); return true;
    }
    if (!normalized.startsWith('/studio/admin/')) return false;
    const actor = this.owner(req), parts = normalized.slice('/studio/admin/'.length).split('/').filter(Boolean), method = req.method;
    const send = (status, value) => this.service.json(res, status, value, method);
    const body = async () => { const data = await this.service.readBody(req, 65536, 'La solicitud administrativa es demasiado grande.'); if (!plain(data)) fail(400, 'Se esperaba un objeto JSON.'); safeTree(data); return data; };
    if (method === 'GET' && parts.length === 1 && parts[0] === 'users') { send(200, {users: this.profiles(), policy: this.policy()}); return true; }
    if (method === 'POST' && parts.length === 1 && parts[0] === 'users') {
      const data = await body(), username = text(data.username, 48).toLowerCase(), displayName = text(data.displayName || username, 80), role = data.role || 'creator';
      if (!/^[a-z0-9][a-z0-9_.-]{2,47}$/.test(username) || !['creator', 'viewer'].includes(role)) fail(400, 'Selecciona un usuario y un permiso válidos.');
      const groupId = data.groupId ? text(data.groupId, 200) : null;
      if (groupId && !this.db.prepare('SELECT 1 FROM studio_class_groups WHERE id=?').get(groupId)) fail(404, 'El grupo no existe.', 'not_found');
      const accessCode = randomBytes(15).toString('base64url'), salt = randomBytes(32).toString('hex'), passwordHash = (await derive(accessCode, salt)).toString('hex'), userId = randomUUID();
      if (req.studioWriteGuard) req.studioWriteGuard();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (this.db.prepare('SELECT 1 FROM studio_users WHERE username=?').get(username)) fail(409, 'Este usuario ya existe.', 'username_unavailable');
        this.db.prepare('INSERT INTO studio_users(id,username,salt,password_hash,display_name,avatar,image,preferences,role,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(userId, username, salt, passwordHash, displayName, JSON.stringify({version: 1, base: 'capsule', bodyColor: '#5cead5', accentColor: '#26364b', skinColor: '#d4a77e'}), null, JSON.stringify({handedness: 'right', locomotion: 'smooth'}), role, this.now());
        if (this.service.access && this.service.access.ensureUser) this.service.access.ensureUser(userId);
        if (groupId) this.recordRegistration(userId, {groupId});
        this.audit(actor, 'user-created', userId, {role, groupId}); this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      send(201, {user: this.service._profile(this.db.prepare('SELECT * FROM studio_users WHERE id=?').get(userId)), accessCode}); return true;
    }
    if (parts.length === 3 && parts[0] === 'users' && parts[2] === 'quota' && method === 'PUT') {
      const target = text(parts[1], 200), data = await body(); if (!this.db.prepare('SELECT 1 FROM studio_users WHERE id=?').get(target)) fail(404, 'El usuario no existe.', 'not_found');
      const quota = this.service.access.setQuota(target, {maxProjects: integer(data.maxProjects, 0, 10000), storageBytes: integer(data.storageBytes, 0, 1024 * 1024 * 1024 * 1024)});
      this.audit(actor, 'quota-changed', target, {maxProjects: data.maxProjects, storageBytes: data.storageBytes}); send(200, {quota, user: this.service._profile(this.db.prepare('SELECT * FROM studio_users WHERE id=?').get(target))}); return true;
    }
    if (parts.length === 1 && parts[0] === 'policy') {
      if (method === 'GET') { send(200, {policy: this.policy()}); return true; }
      if (method === 'PUT') { const data = await body(); if (typeof data.invitationOnly !== 'boolean') fail(400, 'La política requiere un valor booleano.'); this.db.prepare("INSERT INTO studio_settings VALUES('registration_invitation_only',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(data.invitationOnly)); this.audit(actor, 'registration-policy', null, {invitationOnly: data.invitationOnly}); send(200, {policy: this.policy()}); return true; }
    }
    if (parts.length === 1 && parts[0] === 'codes' && method === 'GET') {
      send(200, {codes: this.db.prepare('SELECT code_hash AS id,hint,name,role,group_id AS groupId,max_uses AS maxUses,used,expires_at AS expiresAt,revoked,created_at AS createdAt FROM studio_registration_codes ORDER BY created_at DESC LIMIT 1000').all()}); return true;
    }
    if (parts.length === 1 && parts[0] === 'codes' && method === 'POST') {
      const data = await body(), code = randomBytes(12).toString('hex').toUpperCase(), role = data.role || 'creator', groupId = data.groupId || null;
      if (!['creator', 'viewer'].includes(role)) fail(400, 'El permiso no es válido.'); if (groupId && !this.db.prepare('SELECT 1 FROM studio_class_groups WHERE id=?').get(text(groupId, 200))) fail(404, 'El grupo no existe.', 'not_found');
      const maxUses = integer(data.maxUses === undefined ? 1 : data.maxUses, 1, 1000), days = integer(data.days === undefined ? 7 : data.days, 1, 90), expiresAt = this.now() + days * 86400000;
      this.db.prepare('INSERT INTO studio_registration_codes VALUES(?,?,?,?,?,?,0,?,0,?,?)').run(digest(code), code.slice(-6), text(data.name || 'Código de práctica', 120), role, groupId, maxUses, expiresAt, actor.id, this.now());
      this.audit(actor, 'registration-code-created', groupId, {maxUses, role, expiresAt}); send(201, {code, expiresAt, maxUses}); return true;
    }
    if (parts.length === 2 && parts[0] === 'codes' && method === 'DELETE') { this.db.prepare('UPDATE studio_registration_codes SET revoked=1 WHERE code_hash=?').run(text(parts[1], 64)); this.audit(actor, 'registration-code-revoked', parts[1]); send(200, {ok: true}); return true; }
    if (parts.length === 1 && parts[0] === 'groups' && method === 'GET') { send(200, {groups: this.groups()}); return true; }
    if (parts.length === 1 && parts[0] === 'groups' && method === 'POST') { const data = await body(), groupId = randomUUID(); this.db.prepare('INSERT INTO studio_class_groups VALUES(?,?,?,?,?)').run(groupId, text(data.name, 120), text(data.description, 2000, true), actor.id, this.now()); this.audit(actor, 'group-created', groupId); send(201, {group: this.groups().find(value => value.id === groupId)}); return true; }
    if (parts.length === 3 && parts[0] === 'groups' && parts[2] === 'members' && method === 'PUT') {
      const data = await body(), groupId = text(parts[1], 200); if (!this.db.prepare('SELECT 1 FROM studio_class_groups WHERE id=?').get(groupId)) fail(404, 'El grupo no existe.', 'not_found');
      if (!Array.isArray(data.userIds) || data.userIds.length > 1000 || new Set(data.userIds).size !== data.userIds.length) fail(400, 'La lista de participantes no es válida.');
      const ids = data.userIds.map(value => text(value, 200)); ids.forEach(value => { if (!this.db.prepare('SELECT 1 FROM studio_users WHERE id=?').get(value)) fail(404, 'Un participante no existe.', 'not_found'); });
      this.db.exec('BEGIN IMMEDIATE'); try { this.db.prepare('DELETE FROM studio_class_members WHERE group_id=?').run(groupId); ids.forEach(value => this.recordRegistration(value, {groupId})); this.audit(actor, 'group-members-changed', groupId, {count: ids.length}); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      send(200, {group: this.groups().find(value => value.id === groupId)}); return true;
    }
    if (parts.length === 3 && parts[0] === 'groups' && parts[2] === 'assignments' && method === 'POST') {
      const groupId = text(parts[1], 200), data = await body(); if (!this.db.prepare('SELECT 1 FROM studio_class_groups WHERE id=?').get(groupId)) fail(404, 'El grupo no existe.', 'not_found');
      const projectId = data.projectId || null; if (projectId) this.service.store.getProject(text(projectId, 200));
      const dueAt = data.dueAt === undefined || data.dueAt === null ? null : integer(data.dueAt, this.now(), this.now() + 366 * 86400000), assignmentId = randomUUID();
      this.db.prepare('INSERT INTO studio_class_assignments VALUES(?,?,?,?,?,?,?,?)').run(assignmentId, groupId, text(data.title, 120), text(data.instructions, 4000, true), projectId, text(data.templateId, 200, true), dueAt, this.now());
      this.audit(actor, 'assignment-created', assignmentId, {groupId}); send(201, {assignment: this.groups().find(value => value.id === groupId).assignments.find(value => value.id === assignmentId)}); return true;
    }
    if (parts.length === 1 && parts[0] === 'evaluations' && method === 'PUT') {
      const data = await body(), assignmentId = text(data.assignmentId, 200), userId = text(data.userId, 200), assignment = this.db.prepare('SELECT group_id FROM studio_class_assignments WHERE id=?').get(assignmentId);
      if (!assignment || !this.db.prepare('SELECT 1 FROM studio_class_members WHERE group_id=? AND user_id=?').get(assignment.group_id, userId)) fail(404, 'La práctica o el participante no pertenecen al grupo.', 'not_found');
      if (!Number.isFinite(data.score) || data.score < 0 || data.score > 100) fail(400, 'La nota debe estar entre 0 y 100.');
      this.db.prepare('INSERT INTO studio_class_evaluations VALUES(?,?,?,?,?,?) ON CONFLICT(assignment_id,user_id) DO UPDATE SET score=excluded.score,feedback=excluded.feedback,evaluator_id=excluded.evaluator_id,updated_at=excluded.updated_at').run(assignmentId, userId, data.score, text(data.feedback, 4000, true), actor.id, this.now());
      this.audit(actor, 'evaluation-saved', userId, {assignmentId, score: data.score}); send(200, {ok: true}); return true;
    }
    if (parts.length === 1 && parts[0] === 'reports' && method === 'GET') { send(200, {report: this.report(url.searchParams.get('groupId'), url.searchParams.get('userId'))}); return true; }
    if (parts.length === 1 && parts[0] === 'activity' && method === 'GET') { send(200, {events: this.db.prepare('SELECT id,actor_id AS actorId,type,target_id AS targetId,detail,created_at AS createdAt FROM studio_admin_audit ORDER BY created_at DESC,id LIMIT 500').all().map(value => Object.assign(value, {detail: JSON.parse(value.detail)}))}); return true; }
    fail(404, 'La operación administrativa no existe.', 'not_found');
  }
}
module.exports = {StudioAdministration};
