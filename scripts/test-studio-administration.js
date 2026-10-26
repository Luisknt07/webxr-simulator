'use strict';

// The complete administration contract runs against an isolated SQLite file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {ProjectStore} = require('../server/storage');
const {createApiHandler} = require('../server/api');

const empty = () => ({format: 'hello-webxr-editor', version: 1, imports: [], rooms: {hall: {overrides: [], additions: []}}});
const password = 'Private administration fixture 123!';

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-studio-administration-'));
  let now = Date.now();
  const errors = [], store = new ProjectStore({dataDir: temporary});
  const api = createApiHandler({store, now: () => now, maintenanceIntervalMs: 0, onError: error => errors.push(error)});
  const server = http.createServer(api);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (route, method = 'GET', data, cookie, headers = {}) => {
    const response = await fetch(base + route, {method,
      headers: Object.assign(data === undefined ? {} : {'Content-Type': 'application/json'}, cookie ? {Cookie: cookie} : {}, headers),
      body: data === undefined ? undefined : JSON.stringify(data)});
    return {status: response.status, value: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0]};
  };
  const admin = (route, method, data, cookie, headers) => request('/api/studio/admin' + route, method, data, cookie, headers);
  const register = (username, code) => request('/api/studio/register', 'POST', {username, password, code});
  try {
    assert.equal((await admin('/users')).status, 401);
    const bootstrap = await register('admin_teacher'); assert.equal(bootstrap.status, 201);
    let ownerCookie = bootstrap.cookie; const owner = bootstrap.value.user;
    const pupilResult = await register('student_one'), outsiderResult = await register('student_other');
    assert.equal(pupilResult.status, 201); assert.equal(outsiderResult.status, 201);
    const pupil = pupilResult.value.user, pupilCookie = pupilResult.cookie, outsider = outsiderResult.value.user;
    assert.equal(owner.superadmin, true); assert.equal(pupil.superadmin, false);
    for (const route of ['/users', '/groups', '/codes', '/reports', '/activity', '/policy']) assert.equal((await admin(route, 'GET', undefined, pupilCookie)).status, 403);
    assert.equal((await admin('/groups', 'POST', {name: 'Forbidden'}, pupilCookie)).status, 403);
    assert.equal((await admin('/users', 'GET', undefined, ownerCookie, {'X-Studio-User': pupil.id})).value.code, 'session_changed');

    const groupResult = await admin('/groups', 'POST', {name: 'Automatización industrial', description: 'Laboratorio privado'}, ownerCookie);
    assert.equal(groupResult.status, 201); const group = groupResult.value.group;
    const memberships = await admin('/groups/' + group.id + '/members', 'PUT', {userIds: [pupil.id]}, ownerCookie);
    assert.deepEqual(memberships.value.group.members.map(value => value.userId), [pupil.id]);
    assert.equal((await admin('/groups/' + group.id + '/members', 'PUT', {userIds: [pupil.id, pupil.id]}, ownerCookie)).status, 400);
    assert.equal((await admin('/groups/' + group.id + '/members', 'PUT', {userIds: ['not-a-user']}, ownerCookie)).status, 404);

    const quotaResult = await admin('/users/' + pupil.id + '/quota', 'PUT', {maxProjects: 4, storageBytes: 40 * 1024 * 1024}, ownerCookie);
    assert.equal(quotaResult.status, 200); assert.equal(quotaResult.value.user.id, pupil.id); assert.equal(quotaResult.value.quota.maxProjects, 4); assert.equal(quotaResult.value.quota.storageBytes, 40 * 1024 * 1024);
    assert.equal((await admin('/users/' + pupil.id + '/quota', 'PUT', {maxProjects: -1, storageBytes: 100}, ownerCookie)).status, 400);
    assert.equal((await admin('/users/' + pupil.id + '/quota', 'PUT', {maxProjects: 100, storageBytes: 100000000}, pupilCookie)).status, 403);
    assert.equal((await request('/api/studio/me', 'GET', undefined, ownerCookie)).value.user.id, owner.id, 'managing another profile never changes the browser session');

    const created = await admin('/users', 'POST', {username: 'coded_student', displayName: 'Código docente', role: 'creator', groupId: group.id}, ownerCookie);
    assert.equal(created.status, 201); assert(created.value.accessCode.length >= 12); assert.equal(created.value.user.quota.maxProjects, 2);
    const login = await request('/api/studio/login', 'POST', {username: 'coded_student', password: created.value.accessCode}); assert.equal(login.status, 200);
    assert.equal(login.value.user.id, created.value.user.id); assert.equal(login.value.user.superadmin, false);
    assert.notEqual(store.db.prepare('SELECT password_hash FROM studio_users WHERE id=?').get(created.value.user.id).password_hash, created.value.accessCode);
    assert.equal((await admin('/users', 'POST', {username: 'coded_student'}, ownerCookie)).status, 409);
    const profiles = await admin('/users', 'GET', undefined, ownerCookie);
    assert(!/password_hash|"salt"|"accessCode"|"token_hash"/.test(JSON.stringify(profiles.value)));

    assert.equal((await admin('/policy', 'PUT', {invitationOnly: true}, ownerCookie)).value.policy.invitationOnly, true);
    assert.equal((await register('needs_invitation')).value.code, 'registration_code_required');
    const codeResult = await admin('/codes', 'POST', {name: 'Práctica restringida', role: 'viewer', groupId: group.id, maxUses: 1, days: 1}, ownerCookie);
    assert.equal(codeResult.status, 201); const code = codeResult.value.code;
    const invited = await register('invited_observer', code.toLowerCase()); assert.equal(invited.status, 201); assert.equal(invited.value.user.role, 'viewer');
    assert.equal((await request('/api/projects', 'POST', {name: 'Denied creator', document: empty()}, invited.cookie)).status, 403);
    const invitedClassroom = await request('/api/studio/classroom', 'GET', undefined, invited.cookie); assert(invitedClassroom.value.groups.some(value => value.id === group.id));
    assert.equal((await register('used_invitation', code)).value.code, 'registration_code_invalid');
    const codeRows = (await admin('/codes', 'GET', undefined, ownerCookie)).value.codes;
    assert.equal(codeRows[0].used, 1); assert.equal(codeRows[0].id, createHash('sha256').update(code).digest('hex'));
    assert(!JSON.stringify(codeRows).includes(code), 'registration codes are returned only at creation');
    const expiring = await admin('/codes', 'POST', {name: 'Expires', days: 1}, ownerCookie); assert.equal(expiring.status, 201);
    now += 86400001;
    assert.equal((await register('expired_invitation', expiring.value.code)).value.code, 'registration_code_invalid');
    const revoked = await admin('/codes', 'POST', {name: 'Revoked'}, ownerCookie); assert.equal(revoked.status, 201);
    const revokedId = createHash('sha256').update(revoked.value.code).digest('hex');
    assert.equal((await admin('/codes/' + revokedId, 'DELETE', {}, ownerCookie)).status, 200);
    assert.equal((await register('revoked_invitation', revoked.value.code)).value.code, 'registration_code_invalid');
    assert.equal((await admin('/policy', 'PUT', {invitationOnly: false}, ownerCookie)).status, 200);

    const projectResult = await request('/api/projects', 'POST', {name: 'Private student line', document: empty()}, pupilCookie);
    assert.equal(projectResult.status, 201); const project = projectResult.value.project;
    assert.equal((await request('/api/projects/' + project.id, 'GET', undefined, outsiderResult.cookie)).status, 403);
    const assignmentResult = await admin('/groups/' + group.id + '/assignments', 'POST', {title: 'Clasificar tres productos', instructions: 'Diseña y ejecuta la línea.', projectId: project.id, templateId: 'inspection-sorting', dueAt: now + 86400000}, ownerCookie);
    assert.equal(assignmentResult.status, 201); const assignment = assignmentResult.value.assignment;
    const pupilClassroom = (await request('/api/studio/classroom', 'GET', undefined, pupilCookie)).value.groups;
    assert.equal(pupilClassroom.length, 1); assert.equal(pupilClassroom[0].assignments[0].projectAccessible, true);
    assert.equal((await request('/api/studio/classroom', 'GET', undefined, outsiderResult.cookie)).value.groups.length, 0);
    const limitedClassroom = (await request('/api/studio/classroom', 'GET', undefined, invited.cookie)).value.groups;
    assert.equal(limitedClassroom[0].assignments[0].projectAccessible, false, 'a classroom assignment does not implicitly share a private project');
    assert.equal((await request('/api/projects/' + project.id, 'GET', undefined, invited.cookie)).status, 403);

    assert.equal((await request('/api/studio/progress', 'PUT', {projectId: project.id, missionId: 'classify-products', missionVersion: 1, value: {step: 3, count: 0, status: 'completed'}}, pupilCookie)).status, 200);
    assert.equal((await request('/api/studio/checkpoints', 'POST', {projectId: project.id, projectRevision: 1, version: 1, name: 'Resultado', roomId: 'hall', state: {units: 24}}, pupilCookie)).status, 201);
    assert.equal((await admin('/evaluations', 'PUT', {assignmentId: assignment.id, userId: pupil.id, score: 92.5, feedback: 'Flujo correcto y bien documentado.'}, ownerCookie)).status, 200);
    assert.equal((await admin('/evaluations', 'PUT', {assignmentId: assignment.id, userId: outsider.id, score: 100}, ownerCookie)).status, 404);
    assert.equal((await admin('/evaluations', 'PUT', {assignmentId: assignment.id, userId: pupil.id, score: 101}, ownerCookie)).status, 400);
    const report = (await admin('/reports?groupId=' + group.id, 'GET', undefined, ownerCookie)).value.report;
    const student = report.students.find(value => value.user.id === pupil.id);
    assert.equal(student.completed, 1); assert.equal(student.completionPercent, 100); assert.equal(student.averageScore, 92.5);
    assert.equal(student.checkpoints.total, 1); assert.equal(student.projects[0].id, project.id);
    assert(!report.students.some(value => value.user.id === outsider.id));
    const originalProfile = api.studio._profile.bind(api.studio), profiledIds = [];
    api.studio._profile = row => { profiledIds.push(row.id); return originalProfile(row); };
    try {
      const selectedReport = await admin('/reports?userId=' + pupil.id, 'GET', undefined, ownerCookie);
      assert.equal(selectedReport.status, 200); assert.deepEqual(selectedReport.value.report.students.map(value => value.user.id), [pupil.id]); assert.deepEqual(profiledIds, [pupil.id], 'A selected-user report computes only that account, before profile/project/progress work.');
      assert.equal((await admin('/reports?userId=' + pupil.id, 'GET', undefined, pupilCookie)).status, 403);
      assert.equal((await admin('/reports?userId=missing-user', 'GET', undefined, ownerCookie)).status, 404);
      assert.equal((await admin('/reports?userId=' + encodeURIComponent(pupil.id + "' OR 1=1"), 'GET', undefined, ownerCookie)).status, 404);
      assert.equal((await admin('/reports?groupId=' + group.id + '&userId=' + outsider.id, 'GET', undefined, ownerCookie)).status, 404);
      const withinGroup = await admin('/reports?groupId=' + group.id + '&userId=' + pupil.id, 'GET', undefined, ownerCookie); assert.equal(withinGroup.status, 200); assert.equal(withinGroup.value.report.group.id, group.id); assert.equal(withinGroup.value.report.totals.users, 1);
    } finally { api.studio._profile = originalProfile; }
    assert.equal((await request('/api/studio/classroom', 'GET', undefined, pupilCookie)).value.groups[0].assignments[0].evaluation.score, 92.5);
    assert.equal((await request('/api/studio/classroom', 'GET', undefined, invited.cookie)).value.groups[0].assignments[0].evaluation, null, 'a student sees only their own evaluation');
    const activity = (await admin('/activity', 'GET', undefined, ownerCookie)).value.events;
    assert(activity.some(value => value.type === 'evaluation-saved'));
    assert(!JSON.stringify(activity).includes(code)); assert(!JSON.stringify(activity).includes(created.value.accessCode));

    const teacherProject = await request('/api/projects', 'POST', {name: 'Shared teaching resource', document: empty()}, ownerCookie);
    assert.equal(teacherProject.status, 201);
    const auxiliaryUser = created.value.user, auxiliaryCookie = login.cookie;
    assert.equal((await request('/api/projects/' + teacherProject.value.project.id + '/shares', 'PUT', {userId: auxiliaryUser.id, permission: 'viewer'}, ownerCookie)).status, 200);
    assert.equal((await request('/api/studio/checkpoints', 'POST', {projectId: teacherProject.value.project.id, projectRevision: 1, version: 1, name: 'Auxiliary saved run', roomId: 'hall', state: {units: 8}}, auxiliaryCookie)).status, 201);
    const auxiliaryRoom = await request('/api/studio/rooms', 'POST', {projectId: teacherProject.value.project.id, projectRevision: 1, roomId: 'hall', name: 'Inactive hosted room', state: {units: 8}}, auxiliaryCookie); assert.equal(auxiliaryRoom.status, 201);
    assert.equal((await request('/api/projects/' + teacherProject.value.project.id + '/shares', 'PUT', {userId: outsider.id, permission: 'viewer'}, ownerCookie)).status, 200);
    const activeRoom = await request('/api/studio/rooms', 'POST', {projectId: teacherProject.value.project.id, projectRevision: 1, roomId: 'hall', name: 'Still used by teacher', state: {units: 9}}, outsiderResult.cookie); assert.equal(activeRoom.status, 201);
    assert.equal((await request('/api/studio/rooms/join', 'POST', {code: activeRoom.value.room.code}, ownerCookie)).status, 200);

    // Inactivity cleanup drops student files without breaking teaching FKs or grades.
    now += 31 * 86400000;
    store.db.prepare('UPDATE studio_members SET seen_at=? WHERE room_id=? AND user_id=?').run(now, activeRoom.value.room.id, owner.id);
    const dry = api.studio.access.maintenance({dryRun: true}); assert(dry.eligible.some(value => value.userId === pupil.id));
    assert(store.getProject(project.id));
    const clean = api.studio.access.maintenance({dryRun: false}); assert(clean.deleted.includes(pupil.id)); assert(clean.deleted.includes(auxiliaryUser.id), 'auxiliary data is cleaned even without a project or asset');
    assert(clean.skipped.some(value => value.userId === outsider.id && value.reason === 'active-shared-room'));
    assert(store.db.prepare('SELECT 1 FROM studio_rooms WHERE id=?').get(activeRoom.value.room.id), 'a room used by another active participant is protected');
    assert.equal(store.db.prepare('SELECT project_id FROM studio_class_assignments WHERE id=?').get(assignment.id).project_id, null);
    assert.equal(store.db.prepare('SELECT score FROM studio_class_evaluations WHERE assignment_id=? AND user_id=?').get(assignment.id, pupil.id).score, 92.5);
    assert(store.db.prepare('SELECT 1 FROM studio_users WHERE id=?').get(pupil.id));
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM studio_checkpoints WHERE user_id=?').get(pupil.id).n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM studio_rooms WHERE host_id=?').get(auxiliaryUser.id).n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM studio_checkpoints WHERE user_id=?').get(auxiliaryUser.id).n, 0);
    assert.equal(store.getProject(teacherProject.value.project.id).revision, 1, 'cleaning a guest never removes the host project');
    ownerCookie = (await request('/api/studio/login', 'POST', {username: 'admin_teacher', password})).cookie;
    const afterPurge = (await admin('/reports?groupId=' + group.id, 'GET', undefined, ownerCookie)).value.report.students.find(value => value.user.id === pupil.id);
    assert.equal(afterPurge.projects.length, 0); assert.equal(afterPurge.averageScore, 92.5);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(errors, []);
    console.log('Studio administration: owner permissions, private users and quotas, one-time access credentials, expiring/limited/revoked invitations, classrooms, assignments, evaluations, reports and inactive cleanup FK preservation passed.');
  } finally {
    await new Promise(resolve => server.close(resolve)); api.close();
    const target = path.resolve(temporary); assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('hello-studio-administration-'));
    fs.rmSync(target, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
