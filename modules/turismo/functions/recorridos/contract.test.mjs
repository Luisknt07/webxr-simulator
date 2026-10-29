import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRoute, validateVisit} from './schema.js';
test('route stops are unique and visits use a bounded finite 3D position', () => {
  const route = {id: 'route-1', points: [{id: 'entrance', position: [0, 0, 0], radius: 1}]}; assert.deepEqual(validateRoute(route), route); assert.throws(() => validateRoute({...route, points: [...route.points, ...route.points]})); assert.throws(() => validateVisit({routeId: route.id, visitorId: 'guest', position: [0, Infinity, 0]}));
});
