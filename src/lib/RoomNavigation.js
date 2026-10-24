/** Prepare a destination without interrupting the current room. Latest request wins. */
export default class RoomNavigation {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.options = options;
    this.pending = null;
  }

  cancel() {
    this.pending = null;
    this.ctx.roomTransition = false;
  }

  go(room) {
    if (!Number.isInteger(room) || room < 0 || room >= this.options.count) return Promise.resolve(false);
    if (room === this.ctx.room) {
      this.cancel();
      if (this.options.onSettled) this.options.onSettled();
      return Promise.resolve(true);
    }
    if (this.pending && this.pending.room === room && this.pending.version === this.options.getVersion()) return this.pending.promise;
    const request = {room, version: this.options.getVersion()};
    this.pending = request;
    this.ctx.roomTransition = true;
    if (this.options.onLoading) this.options.onLoading(room);
    request.promise = Promise.resolve().then(async () => {
      await this.options.prepare(room);
      if (this.pending !== request || this.options.getVersion() !== request.version) return false;
      this.options.commit(room);
      return true;
    }).catch(error => {
      if (this.pending === request && this.options.getVersion() === request.version && this.options.onError) this.options.onError(error);
      return false;
    }).finally(() => {
      if (this.pending !== request) return;
      this.cancel();
      if (this.options.onSettled) this.options.onSettled();
    });
    return request.promise;
  }
}
