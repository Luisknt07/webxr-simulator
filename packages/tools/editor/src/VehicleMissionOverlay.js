import VehicleMissionPanel from '../../../../modules/logistica-industrial/functions/montacargas/runtime/VehicleMissionPanel.js';

/** Walking companion for authored, scored warehouse practice. It only reads
 * runtime guidance and yields immediately to controls, dialogs and XR. */
export default class VehicleMissionOverlay {
  constructor(options = {}) {
    this.document = options.document || null; this.now = options.now || (() => Date.now());
    this.lastUpdate = -Infinity; this.blocked = true; this.disposed = false;
  }
  hide() { if (this.panel) this.panel.setVisible(false); this.blocked = true; return false; }
  update(ctx = {}) {
    if (this.disposed) return false;
    const editor = ctx.editor, demo = ctx.demo;
    const simulation = editor && editor.simulation || ctx.simulation || demo && demo.simulation;
    const driving = editor && editor.vehicleDriving || ctx.vehicleDriving || demo && demo.driving;
    const suppliedDocument = this.document || ctx.document || driving && driving.document;
    const dom = suppliedDocument && suppliedDocument.createElement ? suppliedDocument : typeof document === 'undefined' ? null : document;
    const session = simulation && [simulation.roomId, simulation.runSequence].join(':');
    if (simulation !== this.simulation || session !== this.session) {
      this.simulation = simulation; this.session = session; this.recordId = null; this.lastUpdate = -Infinity;
      if (this.panel) { this.panel.setVisible(false); this.panel.update(null); }
    }
    // Remember the truck that was just used, so dismounting returns to that
    // truck's mission if a room contains more than one authored practice.
    if (driving && driving.id) this.recordId = driving.id;
    const studio = ctx.studio;
    if (!simulation || !simulation.running || !dom || !dom.body || dom.hidden || ctx.vrMode || ctx.drivingVehicle || driving && driving.id ||
        editor && (editor.active || editor.loadingProject || editor.busy || editor.simulationPaused) || simulation.paused || demo && demo.paused ||
        ctx.studioMenuOpen || ctx.voicePanelOpen || ctx.publicDialogOpen || ctx.roomTransition || ctx.xrEntryPending || ctx.xrExitPending ||
        studio && studio.drawer && !studio.drawer.hidden) return this.hide();
    const training = simulation.vehicleTraining;
    if (!training || typeof training.tasks !== 'function' || typeof training.guidance !== 'function' || !simulation.records) return this.hide();
    const now = this.now();
    if (!this.blocked && now - this.lastUpdate < 200) return !!this.panel && !this.panel.element.hidden;
    this.lastUpdate = now; this.blocked = false;
    const candidates = [];
    simulation.records.forEach(record => {
      const vehicle = record && record.components && record.components.vehicle;
      if (!vehicle || !vehicle.training) return;
      const tasks = training.tasks(record);
      if (tasks.some(task => task.scoring === true)) candidates.push({record, tasks});
    });
    const selected = candidates.find(item => item.record.id === this.recordId) || candidates.find(item => item.record.components.vehicle.training.phase !== 'complete') || candidates[0];
    if (!selected) { if (this.panel) { this.panel.setVisible(false); this.panel.update(null); } this.recordId = null; return false; }
    const lesson = training.guidance(selected.record);
    if (!lesson || !(lesson.scoreMax > 0)) { if (this.panel) { this.panel.setVisible(false); this.panel.update(null); } return false; }
    if (this.panel && this.panel.document !== dom) { this.panel.dispose(); this.panel = null; }
    if (!this.panel) { this.panel = new VehicleMissionPanel(dom, {mode: 'walking', now: this.now}); this.panel.mount(dom.body); }
    this.recordId = selected.record.id; this.panel.setVisible(true); this.panel.update(lesson, selected.tasks);
    return true;
  }
  dispose() {
    if (this.panel) this.panel.dispose(); this.panel = this.simulation = this.session = this.recordId = null; this.disposed = true;
  }
}
