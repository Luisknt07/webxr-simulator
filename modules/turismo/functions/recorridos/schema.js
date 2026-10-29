import {cloneData, fail, plain} from '../../../../packages/contracts/index.js';
export const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 180;
export const validPosition = value => Array.isArray(value) && value.length === 3 && value.every(number => Number.isFinite(number) && Math.abs(number) < 1000000);
export function validateRoute(input) {
  const value = cloneData(input);
  if (!plain(value) || !validId(value.id) || !Array.isArray(value.points) || !value.points.length || value.points.length > 1000) fail('route_data', 'Provide a route with 1–1000 points.');
  const ids = new Set();
  for (const point of value.points) { if (!plain(point) || !validId(point.id) || ids.has(point.id) || !validPosition(point.position) || !Number.isFinite(point.radius) || point.radius <= 0 || point.radius > 1000) fail('route_data', 'A route point needs a distinct id, position and radius.'); ids.add(point.id); }
  return value;
}
export function validateVisit(input) { const value = cloneData(input); if (!plain(value) || !validId(value.routeId) || !validId(value.visitorId) || !validPosition(value.position)) fail('route_data', 'Provide route, pseudonymous visitor id and position.'); return value; }
