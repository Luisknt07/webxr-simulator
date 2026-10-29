/** Applies one bounded, locally inferred texture to the generated concrete.
 * No model participates in the XR/render loop, and no project data is edited. */
export default class NativeMaterialAI {
  constructor(ctx) {
    this.ctx = ctx; this.listeners = new Set(); this.job = null; this.generation = 0; this.disposed = false;
    this.status = 'available'; this.result = null; this.reason = '';
    this.lastSignature = '';
  }
  blockedReason() {
    const ctx = this.ctx, editor = ctx.editor;
    if (ctx.xrEntryPending || ctx.vrMode || ctx.renderer && ctx.renderer.xr && ctx.renderer.xr.isPresenting) return 'vr';
    if (ctx.graphics && ctx.graphics.getStats().contextLost) return 'context-lost';
    if (typeof document !== 'undefined' && document.hidden) return 'hidden';
    if (ctx.roomTransition || editor && (editor.loadingProject || editor.busy || editor.importingFiles || editor.document && editor.document.loading)) return 'loading';
    return '';
  }
  getStats() {
    const prepared = this.ctx.preparedMaterials, active = !!(prepared && prepared.enabled && prepared.current && prepared.tickets.size), blocked = this.blockedReason();
    return {status: this.status, reason: blocked || this.reason, active, applied: !!(prepared && prepared.enhancedImage),
      canEnhance: !this.disposed && !this.job && !blocked && active && !prepared.enhancedImage,
      result: this.result, native: this.ctx.nativeTextureAI && this.ctx.nativeTextureAI.getStats()};
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.getStats()); return () => this.listeners.delete(listener); }
  notify() { const state = this.getStats(); this.listeners.forEach(listener => { try { listener(state); } catch (_) { /* Optional UI. */ } }); }
  cancel(reason = 'cancelled') {
    this.generation++; if (this.job && this.job.abort) this.job.abort.abort(); this.job = null;
    if (this.status === 'working') { this.status = 'paused'; this.reason = reason; this.notify(); }
  }
  tick() {
    if (this.disposed) return;
    const prepared = this.ctx.preparedMaterials, blocked = this.blockedReason();
    if (this.status === 'ready' && !(prepared && prepared.enhancedImage)) { this.status = 'available'; this.result = null; }
    if (!!blocked !== !!this.externalBlocked) {
      if (blocked) this.ctx.nativeTextureAI.suspend('app-unavailable'); else this.ctx.nativeTextureAI.resume('app-unavailable');
      this.externalBlocked = !!blocked;
    }
    if (this.job && (blocked || !prepared || !prepared.enabled || !prepared.tickets.size || this.job.room !== (this.ctx.editor && this.ctx.editor.roomId) || this.job.project !== (this.ctx.editor && this.ctx.editor.projectGeneration))) this.cancel(blocked || 'room-change');
    const signature = [blocked, !!(prepared && prepared.current), !!(prepared && prepared.tickets.size), !!(prepared && prepared.enhancedImage), this.status].join(':');
    if (signature !== this.lastSignature) { this.lastSignature = signature; this.notify(); }
  }
  async enhance() {
    if (!this.getStats().canEnhance) return false;
    const prepared = this.ctx.preparedMaterials, editor = this.ctx.editor, generation = ++this.generation;
    const job = {abort: new AbortController(), room: editor && editor.roomId, project: editor && editor.projectGeneration}; this.job = job;
    this.status = 'working'; this.reason = ''; this.notify();
    try {
      // A padded patch avoids teaching the tiling floor a prominent AI border.
      // The original material remains displayed throughout model preparation.
      const result = await this.ctx.nativeTextureAI.enhance(prepared.current.texture.image, {maxInputEdge: 192, tile: true, key: 'generated-concrete-v1', signal: job.abort.signal});
      if (generation !== this.generation) return false;
      if (!result) { this.status = this.blockedReason() ? 'paused' : 'fallback'; this.reason = this.blockedReason() || 'processing-failed'; return false; }
      if (this.blockedReason() || !prepared.tickets.size || (editor && (editor.roomId !== job.room || editor.projectGeneration !== job.project))) return false;
      if (!prepared.applyEnhancement(result.canvas)) return false;
      this.result = {width: result.width || result.canvas.width, height: result.height || result.canvas.height, stats: result.stats || null};
      this.status = 'ready'; return true;
    } catch (_) { if (generation === this.generation) { this.status = 'fallback'; this.reason = 'processing-failed'; } return false; }
    finally { if (generation === this.generation) { this.job = null; if (this.status === 'working') this.status = 'paused'; this.notify(); } }
  }
  restore() { this.cancel(); this.ctx.preparedMaterials.clearEnhancement(); this.result = null; this.status = 'available'; this.reason = ''; this.notify(); }
  dispose() { if (this.disposed) return; this.cancel(); this.disposed = true; this.listeners.clear(); }
}
