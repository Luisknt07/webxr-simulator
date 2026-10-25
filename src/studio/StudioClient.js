// Account cookies stay HttpOnly on the server. No password or session token is
// retained in localStorage, scene exports, saved projects or shared-room state.
export default class StudioClient {
  constructor(base = '/api/studio') {
    this.base = base;
    this.user = null;
    this.capabilities = null;
  }

  async request(method, path, body) {
    let response;
    try {
      const expected = this.user && !['/me', '/login', '/register'].includes(path) ? {'X-Studio-User': this.user.id} : {};
      response = await fetch(this.base + path, {method, credentials: 'same-origin', cache: 'no-store',
        keepalive: path === '/progress' && method === 'PUT',
        headers: Object.assign({Accept: 'application/json'}, body === undefined ? {} : {'Content-Type': 'application/json'}, expected),
        body: body === undefined ? undefined : JSON.stringify(body)});
    } catch (_) { throw new Error('No se pudo conectar con Studio. Comprueba que el servidor siga ejecutándose.'); }
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error('Este servidor no ofrece cuentas de Studio. Inicia la aplicación con npm.cmd start.'); }
    if (!response.ok) {
      const detail = result && result.error;
      const error = new Error(typeof detail === 'string' ? detail : detail && detail.message || 'No se pudo completar la operación.');
      error.status = response.status;
      error.code = result && result.code;
      if ((error.code === 'session_changed' || error.status === 401 && this.user) && this.onSessionChange) this.onSessionChange(error);
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(result, 'user')) this.user = result.user;
    return result;
  }

  async me() {
    const result = await this.request('GET', '/me');
    this.capabilities = result.capabilities;
    this.configured = result.configured;
    return result;
  }
  async register(username, password, displayName) { return (await this.request('POST', '/register', {username, password, displayName})).user; }
  async login(username, password) { return (await this.request('POST', '/login', {username, password})).user; }
  async logout() { await this.request('POST', '/logout', {}); this.user = null; }
  async updateProfile(profile) { return (await this.request('PUT', '/profile', profile)).user; }
  async listUsers() { return (await this.request('GET', '/users')).users; }
  async setUserRole(id, role) {
    const previous = this.user;
    const result = await this.request('PUT', '/users/' + encodeURIComponent(id) + '/role', {role});
    // This response describes the managed account, not the signed-in owner.
    this.user = previous;
    return result.user;
  }
  async getProgress(projectId) { return (await this.request('GET', '/progress?projectId=' + encodeURIComponent(projectId))).progress; }
  async saveProgress(projectId, missionId, missionVersion, value, replaceVersion = false) {
    return (await this.request('PUT', '/progress', {projectId, missionId, missionVersion, value, replaceVersion})).progress;
  }
  async listCheckpoints() { return (await this.request('GET', '/checkpoints')).checkpoints; }
  async saveCheckpoint(checkpoint) { return (await this.request('POST', '/checkpoints', checkpoint)).checkpoint; }
  async getCheckpoint(id) { return (await this.request('GET', '/checkpoints/' + encodeURIComponent(id))).checkpoint; }
  async deleteCheckpoint(id) { return this.request('DELETE', '/checkpoints/' + encodeURIComponent(id), {}); }
  async createRoom(options) { return (await this.request('POST', '/rooms', options)).room; }
  async joinRoom(code, role = 'participant') { return (await this.request('POST', '/rooms/join', {code, role})).room; }
  async getRoom(id, after = 0) { return (await this.request('GET', '/rooms/' + encodeURIComponent(id) + '?after=' + after)).room; }
  async roomPose(id, pose) { return this.request('POST', '/rooms/' + encodeURIComponent(id) + '/pose', pose); }
  async roomAction(id, action) { return this.request('POST', '/rooms/' + encodeURIComponent(id) + '/action', action); }
  async saveRoom(id, state, expectedRevision, appliedSequence = 0) {
    return this.request('PUT', '/rooms/' + encodeURIComponent(id) + '/state', {state, expectedRevision, appliedSequence});
  }
  async leaveRoom(id) { return this.request('POST', '/rooms/' + encodeURIComponent(id) + '/leave', {}); }
}

// Ordered HTTP polling works on the existing HTTPS server and through ordinary
// reverse proxies. It is a shared simulation transport, not collaborative editing.
export class StudioRoomConnection {
  constructor(client, options = {}) {
    this.client = client;
    this.onRoom = options.onRoom || (() => {});
    this.onEvents = options.onEvents || (() => {});
    this.onError = options.onError || (() => {});
    this.getPose = options.getPose;
    this.interval = options.interval || 150;
    this.room = null;
    this.sequence = 0;
    this.active = false;
    this.pending = Promise.resolve();
    this.generation = 0;
  }

  connect(room) {
    this.stop();
    this.active = true;
    this.room = room;
    this.sequence = room.stateSequence;
    // Replay only actions newer than the checkpoint. A late join must not skip
    // actions accepted after the host's last confirmed snapshot.
    const initial = Promise.resolve(this.onRoom(room)).then(() => room.events.length ? this.onEvents(room.events, room) : undefined)
      .then(() => { this.sequence = room.sequence; });
    initial.catch(() => {});
    const generation = this.generation;
    const tick = async () => {
      if (!this.active || generation !== this.generation) return;
      try {
        await initial;
        let update = await this.client.getRoom(room.id, this.sequence);
        if (!this.active || generation !== this.generation) return;
        if (update.revision !== this.room.revision && !update.state) update = await this.client.getRoom(room.id, 0);
        if (!this.active || generation !== this.generation) return;
        const events = update.events.filter(event => event.sequence > (update.needsSnapshot ? update.stateSequence : this.sequence));
        // Apply before acknowledging the cursor. A failed application retries
        // the same events; consumers should make event handling idempotent.
        if (update.needsSnapshot) await this.onRoom(update);
        if (events.length) await this.onEvents(events, update);
        this.room = update;
        if (!update.needsSnapshot) await this.onRoom(update);
        this.sequence = update.sequence;
        if (this.getPose) {
          const pose = this.getPose();
          if (pose) await this.client.roomPose(room.id, pose);
        }
        this.failures = 0;
      } catch (error) {
        this.failures = Math.min(5, (this.failures || 0) + 1);
        if (this.active && generation === this.generation) this.onError(error);
        if (error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'session_changed') this.stop();
        // A reset cursor must recover the durable checkpoint on next poll.
        if (error.code === 'room_cursor_invalid') this.sequence = 0;
      }
      if (this.active && generation === this.generation) this.timer = setTimeout(tick, this.failures ? Math.min(3000, this.interval * Math.pow(2, this.failures)) : this.interval);
    };
    this.timer = setTimeout(tick, 0);
    return this;
  }

  action(action) {
    if (!this.active || !this.room) return Promise.reject(new Error('No hay una sala conectada.'));
    const roomId = this.room.id;
    const generation = this.generation;
    const request = this.pending.catch(() => {}).then(() => {
      if (!this.active || generation !== this.generation) throw new Error('La conexión de sala cambió.');
      return this.client.roomAction(roomId, action);
    });
    this.pending = request;
    return request;
  }

  async save(state) {
    if (!this.active || !this.room) throw new Error('No hay una sala conectada.');
    const result = await this.client.saveRoom(this.room.id, state, this.room.revision, this.sequence);
    this.room.revision = result.revision;
    return result;
  }

  stop() {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
  }

  async leave() {
    const room = this.room;
    this.stop();
    this.room = null;
    if (room) await this.client.leaveRoom(room.id);
  }
}
