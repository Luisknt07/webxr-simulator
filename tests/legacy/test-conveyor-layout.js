const assert = require('assert');
const layout = require('../../modules/logistica-industrial/functions/bandas/schema/conveyors');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const base = schema.defaultBehavior('conveyor');
const close = (a, b, epsilon = 1e-6) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
for (const axis of ['x', 'z']) for (const shape of ['straight', 'curveLeft', 'curveRight', 'tee']) {
  for (const junctionMode of ['split', 'merge']) {
    const config = Object.assign({}, base, {axis, layout: shape, junctionMode, radius: 2, length: 5});
    const ports = layout.ports(config);
    assert(ports.input.incoming && !ports.output.incoming);
    if (shape === 'tee') assert.equal(ports.branch.incoming, junctionMode === 'merge');
    for (const route of layout.pathBranches(config)) {
      const length = layout.pathLength(config, route);
      assert(length > 0 && Number.isFinite(length));
      for (const fraction of [0, 0.1, 0.3, 0.5, 0.9, 1]) {
        const point = layout.pathPoint(config, length * fraction, route);
        close(point.tx * point.tx + point.tz * point.tz, 1);
        const nearest = layout.closestPath(config, point.x - point.tz * 0.02, point.z + point.tx * 0.02, route);
        close(nearest.distance, length * fraction, 0.003);
        close(nearest.lateral, 0.02, 0.001);
      }
      const end = layout.pathPoint(config, length, route), extended = layout.pathPoint(config, length + 0.4, route);
      close(extended.x, end.x + end.tx * 0.4); close(extended.z, end.z + end.tz * 0.4);
    }
  }
}
const curve = Object.assign({}, base, {layout: 'curveLeft', radius: 2});
close(layout.pathLength(curve), Math.PI);
const turn = layout.ports(curve); close(turn.input.x, -1); close(turn.input.z, 1); close(turn.input.tx, 1);
close(turn.output.x, 1); close(turn.output.z, -1); close(turn.output.tz, -1);
const tee = Object.assign({}, base, {layout: 'tee'});
close(layout.ports(tee).branch.x, 0); close(layout.ports(tee).branch.z, -2);
assert.deepEqual(layout.connections(Object.assign({}, tee, {outputId: 'a', branchId: 'b', branchPort: 'branch'})), [
  {port: 'output', targetId: 'a', targetPort: 'input'}, {port: 'branch', targetId: 'b', targetPort: 'branch'}
]);
assert.throws(() => schema.normalizeBehaviors([Object.assign({}, base, {layout: 'curveLeft', radius: 0.2})]), /radio/);
assert.throws(() => schema.normalizeBehaviors([Object.assign({}, base, {layout: 'tee', length: 0.5})]), /dos veces/);
assert.throws(() => schema.normalizeBehaviors([Object.assign({}, base, {outputId: '../private'})]), /Referencia/);
assert.throws(() => schema.normalizeBehaviors([Object.assign({}, schema.defaultBehavior('control'), {scope: 'all-projects'})]), /inválid/);
console.log('Conveyor layout: real path lengths, curve/T ports, axis rotation, tangents, nearest-point placement, extension, explicit links and strict configuration passed.');
