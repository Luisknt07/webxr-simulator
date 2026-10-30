'use strict';

// Training routes use room coordinates. They guide a human driver; they are
// deliberately separate from the truck's automatic local waypoints.
const MAX_LENGTH = 24000, MAX_TASKS = 8, MAX_POINTS = 24;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function text(value, label, max = 128) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f\x7f<>]/.test(value)) throw new Error('Dato de misión inválido: ' + label);
  return value;
}
function reference(value, label) {
  const result = text(value, label);
  if (/[\s"'\\]/.test(result)) throw new Error('Referencia de misión inválida: ' + label);
  return result;
}
function route(value) {
  if (!Array.isArray(value) || value.length > MAX_POINTS) throw new Error('Una ruta didáctica admite hasta 24 puntos.');
  return value.map(point => {
    if (!plain(point) || Object.keys(point).some(key => !['x', 'z'].includes(key)) || ['x', 'z'].some(key => !Number.isFinite(point[key]) || Math.abs(point[key]) > 250)) throw new Error('Punto de ruta didáctica inválido.');
    return {x: point.x, z: point.z};
  });
}
function parse(value = {}) {
  let rows = typeof value === 'string' ? value : value.trainingTasksJson || '[]';
  if (typeof rows === 'string') {
    if (rows.length > MAX_LENGTH) throw new Error('El programa de misiones es demasiado grande.');
    try { rows = JSON.parse(rows); } catch (_) { throw new Error('El programa de misiones no contiene JSON válido.'); }
  }
  if (!Array.isArray(rows) || rows.length > MAX_TASKS) throw new Error('Un programa admite hasta 8 misiones.');
  const ids = new Set();
  return rows.map(row => {
    const allowed = ['id','name','productId','sourceId','sourceLocationCode','destinationId','locationCode','destinationSlot','pickupRoute','route'];
    if (!plain(row) || Object.keys(row).some(key => !allowed.includes(key))) throw new Error('Misión didáctica inválida.');
    const item = {id: reference(row.id, 'id'), name: text(row.name, 'nombre', 180), productId: reference(row.productId, 'pallet'), sourceId: reference(row.sourceId, 'origen'), destinationId: reference(row.destinationId, 'destino'), pickupRoute: route(row.pickupRoute || []), route: route(row.route || [])};
    if (ids.has(item.id)) throw new Error('Los identificadores de misión deben ser únicos.');
    ids.add(item.id);
    for (const key of ['sourceLocationCode', 'locationCode']) if (row[key] !== undefined) item[key] = reference(row[key], key);
    if (row.destinationSlot !== undefined) {
      if (!Number.isInteger(row.destinationSlot) || row.destinationSlot < 0 || row.destinationSlot > 511) throw new Error('Posición de misión inválida.');
      item.destinationSlot = row.destinationSlot;
    }
    if (!item.locationCode && item.destinationSlot === undefined) throw new Error('Indica el código o la posición exacta del destino de cada misión.');
    return item;
  });
}
module.exports = {parse, MAX_LENGTH, MAX_TASKS, MAX_POINTS};
