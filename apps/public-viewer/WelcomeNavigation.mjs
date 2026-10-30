const HASHES = Object.freeze({welcome: '#inicio', gallery: '#escenarios', demo: '#demostracion'});

/** History can restore the catalogue, but never grants permission to create a
 * renderer or download a demonstration. That operation needs openDemo(). */
export function screenFromHash(hash) {
  if (hash === HASHES.gallery || hash === HASHES.demo) return 'gallery';
  return 'welcome';
}

export function createWelcomeNavigation({showScreen, startDemo, stopDemo, writeHistory, focusScreen = () => {}, onFailure = () => {}}) {
  let screen = 'welcome', loading = false, pending = false, sequence = 0, closed = false, teardown = null;
  const history = (name, mode) => {if (mode !== 'none') writeHistory(HASHES[name], mode);};
  const current = token => !closed && token === sequence;
  function stop() {
    // A browser history traversal may emit both popstate and hashchange. Both
    // callers must wait for the same XR/GPU cleanup before another launch.
    if (!teardown) {
      const operation = Promise.resolve().then(stopDemo); teardown = operation;
      const clear = () => {if (teardown === operation) teardown = null;}; operation.then(clear, clear);
    }
    return teardown;
  }
  async function show(name, options = {}) {
    if (closed) return false;
    name = name === 'gallery' ? 'gallery' : 'welcome';
    const token = ++sequence; screen = name; loading = false;
    history(name, options.history || 'push'); showScreen(name, {loading: false});
    await stop();
    if (current(token)) focusScreen(name);
    return current(token);
  }
  async function openDemo() {
    if (closed || pending || screen === 'demo') return false;
    pending = true; const token = ++sequence; screen = 'demo'; loading = true;
    history('demo', 'push'); showScreen('demo', {loading: true});
    try {
      await stop(); if (!current(token)) return false;
      const handle = await startDemo();
      if (!current(token)) {if (handle && typeof handle.dispose === 'function') await handle.dispose(); return false;}
      loading = false; showScreen('demo', {loading: false}); focusScreen('demo'); return true;
    } catch (error) {
      if (current(token)) {await show('gallery', {history: 'replace'}); onFailure(error);}
      return false;
    } finally {pending = false;}
  }
  return Object.freeze({
    home: options => show('welcome', options),
    gallery: options => show('gallery', options),
    openDemo,
    restore(hash) {return show(screenFromHash(hash), {history: hash === HASHES.demo || !Object.values(HASHES).includes(hash) ? 'replace' : 'none'});},
    getStats: () => ({screen, loading, pending, closed}),
    async dispose() {if (closed) return; closed = true; sequence++; loading = false; await stop();}
  });
}
