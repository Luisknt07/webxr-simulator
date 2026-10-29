import {defineFunction} from '../../../../packages/module-sdk/index.js';
import {cloneData, fail} from '../../../../packages/contracts/index.js';
import {routesManifest} from './manifest.js';
import {validateRoute, validateVisit} from './schema.js';
import {authorizeRouteEdit} from './server.js';
import {migrateRouteState} from './migrations.js';
import {routePanel} from './ui.js';
export default defineFunction({...routesManifest, register(scope) {
  const stored = scope.state.get(); let state = stored || {routes: [], visits: []};
  // A replaced route would invalidate prior visit indices; require a fresh route id.
  const save = next => { scope.state.set(next); state = next; };
  const progress = (routeId, visitorId) => { const route = state.routes.find(item => item.id === routeId); if (!route) fail('missing_route', 'Unknown route.'); const visit = state.visits.find(item => item.routeId === routeId && item.visitorId === visitorId); const index = visit ? visit.index : 0; return {routeId, visitorId, visited: index, total: route.points.length, completed: index >= route.points.length, nextPoint: cloneData(route.points[index] || null)}; };
  scope.register('commands', 'configure', input => { const route = validateRoute(input); if (state.routes.some(item => item.id === route.id)) fail('duplicate_route', 'Use a new id for a changed route.'); save({...state, routes: state.routes.concat(route)}); return route.id; });
  scope.register('commands', 'progress', {readOnly:true, validate:input=>!!input&&['routeId','visitorId'].every(key=>typeof input[key]==='string'&&!!input[key].trim()&&input[key].length<=180), execute:input => progress(input.routeId, input.visitorId)});
  scope.register('commands', 'visit', input => {
    const value = validateVisit(input), current = progress(value.routeId, value.visitorId); if (current.completed) return current;
    const point = current.nextPoint, distance = Math.hypot(...point.position.map((coordinate, index) => coordinate - value.position[index]));
    if (distance > point.radius) return {...current, accepted: false, distance};
    const next = cloneData(state), visit = next.visits.find(item => item.routeId === value.routeId && item.visitorId === value.visitorId);
    if (visit) visit.index++; else next.visits.push({routeId: value.routeId, visitorId: value.visitorId, index: 1}); save(next); return {...progress(value.routeId, value.visitorId), accepted: true};
  });
  scope.register('components', 'route', {schemaVersion: 1, validate: input => { validateRoute(input); return true; }});
  scope.register('server-validators', 'configure', {validate: validateRoute, authorize: authorizeRouteEdit, permissions:['routes.write']}); scope.register('server-validators', 'visit', {validate: validateVisit});
  scope.register('migrations', 'state', migrateRouteState); scope.register('ui', 'route', routePanel);
}});
