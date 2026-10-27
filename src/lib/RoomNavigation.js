/** Covered atomic navigation. Only the newest destination can commit/uncover.
 * External project mutations share the gate, including same-room replacement. */
export default class RoomNavigation {
  constructor(ctx, options) { this.ctx = ctx; this.options = options; this.pending = null; this.external = null; this.desiredExternal = null; this.tail = Promise.resolve(); }
  request(room, external = false) {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const request = {room, external, version: this.options.getVersion(), signal: controller && controller.signal, abort: () => {request.cancelled = true; if (controller) controller.abort();}};
    request.isCurrent = () => !request.cancelled && (external ? this.desiredExternal === request : this.pending === request && this.options.getVersion() === request.version);
    request.assertCurrent = () => {if (!request.isCurrent()) throw Object.assign(new Error('La transición fue sustituida por otra solicitud.'), {name: 'AbortError'});};
    return request;
  }
  async recover(request, error, override) { if (override) await override(error, request); if (this.options.recover) await this.options.recover(request, error); }
  async finish(request) { if (this.options.finish) await this.options.finish(request); if (!request.isCurrent()) return; this.ctx.roomTransition = false; if (this.options.onSettled) this.options.onSettled(); }
  cancel() {
    if (this.desiredExternal) {this.desiredExternal.abort(); return this.desiredExternal.promise;}
    const request = this.pending; if (!request) return Promise.resolve(false);
    request.abort(); this.pending = null;
    if (!this.options.recover && !this.options.finish) {this.ctx.roomTransition = false; return Promise.resolve(false);}
    const recovery = this.request(this.ctx.room); this.pending = recovery;
    const covered = this.options.cover && this.options.cover(recovery, 'Volviendo al escenario…');
    recovery.promise = Promise.resolve(covered).then(() => this.recover(recovery)).then(() => this.finish(recovery)).catch(error => this.failed(recovery, error)).finally(() => {if (this.pending === recovery) this.pending = null;});
    return recovery.promise;
  }
  failed(request, error, retry) { if (this.options.onError) this.options.onError(error); if (this.options.failed) this.options.failed(error, retry || (() => this.go(request.room, {force: true}))); }
  go(room, options = {}) {
    if (!Number.isInteger(room) || room < 0 || room >= this.options.count) return Promise.resolve(false);
    // The project loader may legitimately change projectGeneration under its
    // own cover and call gotoRoom without closing that outer transaction.
    if (this.external) {const owner = this.external; return Promise.resolve().then(async () => {owner.assertCurrent(); await this.options.prepare(room, owner); owner.assertCurrent(); await this.options.commit(room, owner); owner.assertCurrent(); return true;});}
    if (room === this.ctx.room && !options.force) {const cancelled = this.cancel(); if (this.options.onSettled) this.options.onSettled(); return Promise.resolve(cancelled).then(() => true);}
    if (this.pending && this.pending.room === room && this.pending.version === this.options.getVersion()) return this.pending.promise;
    if (this.pending) this.pending.abort();
    const request = this.request(room); this.pending = request; this.ctx.roomTransition = true;
    if (this.options.cover) request.covered = this.options.cover(request, options.label);
    if (this.options.onLoading) this.options.onLoading(room);
    request.promise = Promise.resolve().then(async () => {
      if (request.covered) await request.covered; request.assertCurrent(); if (this.options.suspend) await this.options.suspend(request);
      await this.options.prepare(room, request); request.assertCurrent(); await this.options.commit(room, request); request.assertCurrent();
      if (this.options.prepareCurrent) await this.options.prepareCurrent(request); request.assertCurrent(); await this.finish(request); return true;
    }).catch(async error => {
      if (this.pending !== request) return false;
      if (this.options.getVersion() !== request.version) request.version = this.options.getVersion();
      request.cancelled = false;
      try {await this.recover(request, error); await this.finish(request); if (error.name !== 'AbortError' && this.options.onError) this.options.onError(error);}
      catch (recoveryError) {this.failed(request, recoveryError);}
      return false;
    }).finally(() => {if (this.pending === request) {this.pending = null; if (!this.options.finish && !this.options.failed) this.ctx.roomTransition = false;}});
    return request.promise;
  }
  runExternal(work, options = {}) {
    if (typeof work !== 'function') return Promise.reject(new Error('La transición necesita una operación de carga.'));
    if (this.pending) {this.pending.abort(); this.pending = null;} if (this.desiredExternal) this.desiredExternal.abort();
    const request = this.request(this.ctx.room, true); this.desiredExternal = request; this.ctx.roomTransition = true;
    const covered = this.options.cover ? this.options.cover(request, options.label) : Promise.resolve();
    const execute = async () => {
      let begun = false;
      try {
        await covered; request.assertCurrent(); this.external = request;
        if (this.options.suspend) await this.options.suspend(request); begun = true;
        const result = await work(request); request.assertCurrent();
        if (this.options.prepareCurrent) await this.options.prepareCurrent(request); request.assertCurrent(); await this.finish(request); return result;
      } catch (error) {
        // Roll back a cancelled mutation before the next document loader runs.
        try {if (error.keepRoomCover) throw error; if (begun) await this.recover(request, error, options.recover); if (this.desiredExternal === request) {request.cancelled = false; if (request.signal && request.signal.aborted) request.signal = null; await this.finish(request);}}
        catch (recoveryError) {if (this.desiredExternal === request) this.failed(request, recoveryError, () => this.runExternal(work, options));}
        throw error;
      } finally {if (this.external === request) this.external = null; if (this.desiredExternal === request) this.desiredExternal = null;}
    };
    request.promise = this.tail.catch(() => {}).then(execute); this.tail = request.promise; return request.promise;
  }
}
