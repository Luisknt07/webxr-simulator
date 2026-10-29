import {cloneData, fail, plain} from '../../../../packages/contracts/index.js';
import {validateInventoryRequest, validateLocation, validateLoad, text} from './schema.js';

const empty = () => ({revision: 0, sequence: 0, locations: [], loads: [], reservations: [], events: []});
function validateState(value) {
  const state = cloneData(value);
  if (!plain(state) || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !['locations', 'loads', 'reservations', 'events'].every(key => Array.isArray(state[key])) || state.loads.length > 10000 || state.locations.length > 10000 || state.reservations.length > 10000) fail('inventory_state', 'Invalid inventory state.');
  const locations = new Map(), loads = new Map(), reservedLoads = new Set(), ids = new Set();
  for (const location of state.locations) { validateLocation(location); if (locations.has(location.id)) fail('duplicate_location', 'A location already exists.'); locations.set(location.id, location); }
  for (const load of state.loads) { validateLoad(load); if (loads.has(load.id)) fail('duplicate_load', 'A load already exists.'); if (!locations.has(load.locationId)) fail('missing_location', 'A load has no location.'); loads.set(load.id, load); }
  for (const reservation of state.reservations) {
    if (!plain(reservation)) fail('inventory_state', 'Invalid reservation.'); ['id', 'loadId', 'ownerId', 'fromLocationId', 'toLocationId'].forEach(key => text(reservation[key]));
    const load = loads.get(reservation.loadId);
    if (ids.has(reservation.id) || reservedLoads.has(reservation.loadId) || !load || load.locationId !== reservation.fromLocationId || !locations.has(reservation.toLocationId) || reservation.toLocationId === reservation.fromLocationId) fail('inventory_state', 'Inconsistent reservation.');
    ids.add(reservation.id); reservedLoads.add(reservation.loadId);
  }
  // Every committed load and every promised intake occupies capacity.
  for (const location of locations.values()) {
    const stock = state.loads.filter(load => load.locationId === location.id), promised = state.reservations.filter(reservation => reservation.toLocationId === location.id).map(reservation => loads.get(reservation.loadId));
    if (stock.length + promised.length > location.maxLoads || stock.concat(promised).reduce((sum, load) => sum + load.massKg, 0) > location.capacityKg + 1e-9) fail('inventory_capacity', `Location ${location.id} has insufficient capacity.`);
  }
  return state;
}
/** Logical inventory only. It does not materialize/copy any physical simulator load.
 * A physical application must adapt its existing custody service, not duplicate it. */
export function createInventoryService({initialState = null, persist = () => {}} = {}) {
  let state = validateState(initialState || empty());
  const snapshot = () => cloneData(state);
  const transaction = request => {
    const {operations, expectedRevision} = validateInventoryRequest(request);
    if (expectedRevision !== undefined && expectedRevision !== state.revision) fail('inventory_conflict', 'Inventory changed; refresh before retrying.');
    const next = snapshot(), results = [];
    for (const operation of operations) {
      let result = null;
      if (operation.type === 'add-location') { if (next.locations.some(location => location.id === operation.location.id)) fail('duplicate_location', 'A location already exists.'); next.locations.push(cloneData(operation.location)); result = operation.location.id; }
      if (operation.type === 'add-load') { if (next.loads.some(load => load.id === operation.load.id)) fail('duplicate_load', 'A load already exists.'); next.loads.push(cloneData(operation.load)); result = operation.load.id; }
      if (operation.type === 'reserve') {
        const load = next.loads.find(value => value.id === operation.loadId); if (!load) fail('missing_load', 'Load does not exist.');
        if (next.reservations.some(value => value.loadId === load.id)) fail('load_reserved', 'This load already has a reservation.');
        const id = operation.reservationId || 'reservation-' + (++next.sequence);
        if (next.reservations.some(value => value.id === id)) fail('duplicate_reservation', 'Reservation already exists.');
        result = {id, loadId: load.id, ownerId: operation.ownerId, fromLocationId: load.locationId, toLocationId: operation.toLocationId}; next.reservations.push(result);
      }
      if (operation.type === 'commit' || operation.type === 'release') {
        const reservation = next.reservations.find(value => value.id === operation.reservationId);
        if (!reservation || reservation.ownerId !== operation.ownerId) fail('reservation_owner', 'Only the current reservation owner can complete or release it.');
        const load = next.loads.find(value => value.id === reservation.loadId); if (!load || load.locationId !== reservation.fromLocationId) fail('inventory_state', 'The source no longer owns this load.');
        if (operation.type === 'commit') load.locationId = reservation.toLocationId;
        next.reservations = next.reservations.filter(value => value !== reservation); result = cloneData(load);
      }
      if (operation.type === 'withdraw') {
        const load = next.loads.find(value => value.id === operation.loadId); if (!load) fail('missing_load', 'Load does not exist.');
        if (next.reservations.some(value => value.loadId === load.id)) fail('load_reserved', 'Release the reservation before withdrawing.');
        next.loads = next.loads.filter(value => value !== load); result = cloneData(load);
      }
      results.push(cloneData(result)); next.events.push({revision: state.revision + 1, operation: cloneData(operation), result: cloneData(result)});
      validateState(next);
    }
    next.revision++; next.events = next.events.slice(-1000); validateState(next);
    // Persist first. A failed storage/authorization port leaves the live state untouched.
    const persisted = persist(cloneData(next)); if (persisted && typeof persisted.then === 'function') { persisted.catch(() => {}); fail('async_inventory_port', 'Use a synchronous atomic persistence adapter.'); }
    state = next; return {revision: state.revision, results: cloneData(results)};
  };
  return Object.freeze({kind: 'logical-inventory', transaction, snapshot, getLoad: id => { const load = state.loads.find(value => value.id === id); return load ? cloneData(load) : null; },
    reservations: () => cloneData(state.reservations), trace: loadId => cloneData(state.events.filter(event => event.operation.loadId === loadId || event.operation.load && event.operation.load.id === loadId || event.result && (event.result.loadId === loadId || event.result.id === loadId)))});
}
