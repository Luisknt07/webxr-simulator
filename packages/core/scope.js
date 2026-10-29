import {cloneData, fail, localName, versionSatisfies} from '../contracts/index.js';

export function createScope(host, record, controller) {
  const disposers = [], pendingCleanup = new Set(), cleanupErrors = []; let closed = false;
  const cleanup = async entry => { if (entry.done) return; entry.done = true; try { await entry.dispose(entry.value); } catch (error) { cleanupErrors.push(error); } };
  const own = (value, dispose) => {
    const disposer = dispose || (value && typeof value.dispose === 'function' ? item => item.dispose() : null);
    if (typeof disposer !== 'function') fail('invalid_disposer', 'Owned resources need a disposer.');
    const entry = {value, dispose: disposer, done: false}; disposers.push(entry);
    if (closed || controller.signal.aborted) { const promise = cleanup(entry); pendingCleanup.add(promise); promise.finally(() => pendingCleanup.delete(promise)); }
    return value;
  };
  const assert = () => { if (closed || controller.signal.aborted) fail('scope_closed', `Function ${record.id} has been cancelled or removed.`); };
  const scope = Object.freeze({id: record.id, version: record.definition.version, worldId: host.worldId, signal: controller.signal,
    isCurrent: () => !closed && !controller.signal.aborted,
    register(kind, name, value) { assert(); localName(kind); localName(name); return host.register(record, kind, name, value); },
    provide(id, value) { assert(); return host.provide(record, id, value); },
    service(id) { assert(); return host.service(record, id); },
    port(id) { assert(); if (!record.definition.capabilities.includes(id) || !host.grants.has(id) || !Object.hasOwn(host.ports, id)) fail('capability_denied', `Function ${record.id} cannot access ${id}.`); return host.ports[id]; },
    own,
    onDispose(dispose) { own(undefined, dispose); return dispose; },
    async track(promise, dispose) { const value = await promise; own(value, dispose); assert(); return value; },
    guard(callback) { if (typeof callback !== 'function') fail('invalid_callback', 'A guarded callback must be a function.'); return (...args) => { if (!closed && !controller.signal.aborted && record.status === 'active') return callback(...args); }; },
    state: Object.freeze({
      get() { assert(); const entry = host.states.get(record.id); if (!entry) return null; if (entry.schemaVersion !== record.definition.stateVersion || !versionSatisfies(record.definition.version, entry.version)) fail('state_migration_required', `State for ${record.id} needs explicit migration.`); return cloneData(entry.data); },
      set(data) { assert(); const previous = host.states.get(record.id); if (previous && (previous.schemaVersion !== record.definition.stateVersion || previous.version !== record.definition.version)) fail('state_migration_required', `State for ${record.id} needs explicit migration.`); host.states.set(record.id, {id: record.id, version: record.definition.version, schemaVersion: record.definition.stateVersion, data: cloneData(data)}); }
    })
  });
  return {scope, controller, assert, async dispose() { if (closed) return; closed = true; controller.abort(); for (let i = disposers.length - 1; i >= 0; i--) await cleanup(disposers[i]); await Promise.all([...pendingCleanup]); host.unregister(record); if (cleanupErrors.length) throw new AggregateError(cleanupErrors, `Cleanup failed for ${record.id}.`); }};
}
