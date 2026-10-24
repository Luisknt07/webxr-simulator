// Saved projects are shared by the server, including across different browsers.
// Local drafts and a running WebXR session must never be replaced in the background.
const UPDATE_KEY = 'hello-webxr-project-updated';

function revisionOf(project) {
  return project && Number.isInteger(project.revision) ? project.revision : 0;
}

function canRefresh(state, discover = false) {
  return state && (state.project || (discover && state.allowDiscover)) && !state.dirty && !state.busy && !state.loading &&
    !state.transaction && !state.pinned && state.active !== false && !state.vrMode;
}

export default class ProjectSync {
  constructor(options) {
    this.client = options.client;
    this.getState = options.getState;
    this.onRefresh = options.onRefresh || (() => {});
    this.onRemoteChange = options.onRemoteChange || (() => {});
    this.onError = options.onError || (() => {});
    this.window = options.window === undefined ? (typeof window === 'undefined' ? null : window) : options.window;
    this.document = options.document === undefined ? (this.window && this.window.document) : options.document;
    this.intervalMs = options.intervalMs === undefined ? 5000 : options.intervalMs;
    // Use the supplied browser's timers. A headless consumer can omit them entirely.
    this.setInterval = options.setInterval || (this.window && typeof this.window.setInterval === 'function' && this.window.setInterval.bind(this.window));
    this.clearInterval = options.clearInterval || (this.window && typeof this.window.clearInterval === 'function' && this.window.clearInterval.bind(this.window));
    this.running = false;
    this.generation = 0;
    this.pending = null;
    this.remoteKey = null;
    this.errorNotified = false;
    this.onFocus = () => { this.check(); };
    this.onVisibility = () => {
      if (!this.document || this.document.visibilityState !== 'hidden') this.check();
    };
    this.onStorage = event => {
      if (!event || event.key !== UPDATE_KEY || !event.newValue) return;
      let update;
      try { update = JSON.parse(event.newValue); } catch (error) { return; }
      const state = this.getState();
      if (!update || !update.id || !revisionOf(update)) return;
      if ((state.project && update.id === state.project.id && revisionOf(update) > revisionOf(state.project)) ||
        (!state.project && state.allowDiscover)) this.check();
    };
  }

  start() {
    if (this.running) return this.pending || Promise.resolve(false);
    this.running = true;
    this.generation++;
    if (this.window && this.window.addEventListener) {
      this.window.addEventListener('focus', this.onFocus);
      this.window.addEventListener('storage', this.onStorage);
    }
    if (this.document && this.document.addEventListener) this.document.addEventListener('visibilitychange', this.onVisibility);
    if (this.intervalMs > 0 && this.setInterval && this.clearInterval) {
      this.timer = this.setInterval(() => { this.check(); }, this.intervalMs);
      if (this.timer && this.timer.unref) this.timer.unref();
    }
    return this.check();
  }

  stop() {
    this.running = false;
    this.generation++;
    if (this.timer !== undefined && this.clearInterval) this.clearInterval(this.timer);
    this.timer = undefined;
    if (this.window && this.window.removeEventListener) {
      this.window.removeEventListener('focus', this.onFocus);
      this.window.removeEventListener('storage', this.onStorage);
    }
    if (this.document && this.document.removeEventListener) this.document.removeEventListener('visibilitychange', this.onVisibility);
  }

  publish(project) {
    if (!project || !project.id || !revisionOf(project) || !this.window) return;
    try {
      if (this.window.localStorage) this.window.localStorage.setItem(UPDATE_KEY, JSON.stringify({
        id: project.id, revision: project.revision, timestamp: Date.now(), nonce: Math.random().toString(36).slice(2)
      }));
    } catch (error) {
      // Private browsing or a full storage quota must not turn a successful save into an error.
    }
  }

  notifyRemote(project) {
    const key = project ? project.id + ':' + project.revision : null;
    if (key === this.remoteKey) return;
    this.remoteKey = key;
    this.onRemoteChange(project || null);
  }

  check() {
    if (!this.running) return Promise.resolve(false);
    if (this.pending) return this.pending;
    const generation = this.generation;
    const operation = this.checkLatest(generation).catch(error => {
      if (this.running && generation === this.generation && !this.errorNotified) {
        this.errorNotified = true;
        this.onError(error);
      }
      return false;
    });
    this.pending = operation.then(result => {
      if (this.pending === pending) this.pending = null;
      return result;
    });
    const pending = this.pending;
    return pending;
  }

  async checkLatest(generation) {
    let state = this.getState();
    const discover = !state.project && !!state.allowDiscover;
    if (!state.project && !discover) {
      this.notifyRemote(null);
      return false;
    }
    const currentId = state.project ? state.project.id : null;
    const projects = await this.client.listProjects();
    if (!this.running || generation !== this.generation) return false;
    state = this.getState();
    if (discover ? (state.project || !state.allowDiscover) : (!state.project || state.project.id !== currentId)) return false;
    // The API lists newest projects first. Discovery is explicitly limited to a
    // pristine, unbound editor; a tab already bound to a project never switches IDs.
    const metadata = discover ? projects.find(project => project && project.id && revisionOf(project) > 0) : projects.find(project => project.id === currentId);
    if (!metadata || revisionOf(metadata) <= revisionOf(state.project)) {
      this.notifyRemote(null);
      this.errorNotified = false;
      return false;
    }
    this.notifyRemote(metadata);
    if (!canRefresh(state, discover)) {
      this.errorNotified = false;
      return false;
    }
    const id = metadata.id;
    const expected = {id: currentId, revision: state.project ? state.project.revision : null};
    const project = await this.client.getProject(id);
    if (!this.running || generation !== this.generation) return false;
    state = this.getState();
    // Fetching a scene can be slow: the user may have edited, saved, changed projects,
    // entered VR or opened a historical revision while that request was in flight.
    if (!canRefresh(state, discover)) return false;
    if (discover ? !!state.project : (!state.project || state.project.id !== id || state.project.revision !== expected.revision)) return false;
    if (!project || project.id !== id || revisionOf(project) <= revisionOf(state.project)) return false;
    // The editor checks this expectation again inside its transactional scene loader.
    const applied = await this.onRefresh(project, expected);
    if (!this.running || generation !== this.generation) return false;
    state = this.getState();
    if (state.project && state.project.id === id && revisionOf(state.project) >= revisionOf(project)) this.notifyRemote(null);
    this.errorNotified = false;
    return applied !== false;
  }
}
