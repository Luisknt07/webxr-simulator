const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const guide = require('../../packages/project-model/shared/guided-scene-plan');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-guided-scene-diagram.js"), '../src/editor/GuidedSceneBuilder.js')), 'utf8');
const diagram = new Function('guidePlan', source.slice(source.indexOf('const escape =')).replace('export function guidedPlanDiagram', 'function guidedPlanDiagram') + '\nreturn guidedPlanDiagram;')(guide);
const number = '([-\\d.eE+]+)', rect = new RegExp('<g data-node="([^"]+)" data-kind="([^"]+)"><title>[^<]*</title><rect x="' + number + '" y="' + number + '" width="' + number + '" height="' + number + '"', 'g');
const pathPattern = new RegExp('<path data-from="([^"]+)" data-to="([^"]+)" d="M' + number + ',' + number + 'L' + number + ',' + number + '"[^>]*marker-end="url\\(#guided-flow-arrow\\)"', 'g');
const border = (node, x, y) => x >= node.x - 1e-7 && x <= node.x + node.w + 1e-7 && y >= node.y - 1e-7 && y <= node.y + node.h + 1e-7 && Math.min(Math.abs(x - node.x), Math.abs(x - node.x - node.w), Math.abs(y - node.y), Math.abs(y - node.y - node.h)) < 1e-7;
for (const shape of Object.keys(guide.SHAPES)) for (const conveyorCount of [1, 3, 4, 6, 12]) for (const processor of ['', 'process', 'combiner', 'separator']) {
  const plan = guide.normalizePlan({shape, conveyorCount, processor}), svg = diagram(plan), nodes = new Map(), edges = [];
  for (const match of svg.matchAll(rect)) nodes.set(match[1], {id: match[1], kind: match[2], x: Number(match[3]), y: Number(match[4]), w: Number(match[5]), h: Number(match[6])});
  for (const match of svg.matchAll(pathPattern)) edges.push({from: match[1], to: match[2], x1: Number(match[3]), y1: Number(match[4]), x2: Number(match[5]), y2: Number(match[6])});
  assert.equal(Array.from(nodes.values()).filter(node => ['conveyor', 'transfer', 'junction'].includes(node.kind)).length, plan.conveyorCount, shape + ' shows exactly its requested real modules.');
  assert.equal(nodes.has('processor'), Boolean(processor)); assert.equal(edges.length, nodes.size - 1, 'Every node is part of a connected directed flow.');
  const [width, height] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  for (const a of nodes.values()) {
    assert(a.x >= 0 && a.y >= 100 && a.x + a.w <= width && a.y + a.h <= height - 50, 'Diagram nodes stay inside the view and outside its labels.');
    for (const b of nodes.values()) if (a !== b) assert(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'Modules never overlap, including twelve-module proposals.');
  }
  for (const edge of edges) { assert(nodes.has(edge.from) && nodes.has(edge.to)); assert(border(nodes.get(edge.from), edge.x1, edge.y1)); assert(border(nodes.get(edge.to), edge.x2, edge.y2), 'Every arrow reaches its real receiver border.'); assert(Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1) > 10, 'Connections are visible directed paths, never isolated stubs.'); }
  const reachable = id => { const visited = new Set(), queue = [id]; while (queue.length) { const current = queue.shift(); if (visited.has(current)) continue; visited.add(current); edges.filter(edge => edge.from === current).forEach(edge => queue.push(edge.to)); } return visited; };
  assert(reachable('source-a').has('queue-a')); if (shape === 't') { assert(reachable('source-a').has('queue-b')); assert.equal(edges.filter(edge => edge.from === 'transport-2').length, 2); }
  if (shape === 'y') { assert(reachable('source-b').has('queue-a')); assert.equal(edges.filter(edge => edge.to === 'transport-2').length, 2); }
  if (shape === 'l') { const corner = nodes.get('transport-' + (Math.ceil((plan.conveyorCount - 1) / 2) + 1)), last = nodes.get('transport-' + plan.conveyorCount); assert.equal(corner.x, last.x); assert(last.y < corner.y, 'The L turns perpendicular after the transfer module.'); assert(svg.includes('L rectangular con transferencia')); }
}
const escaped = diagram({title: '<script>alert("x")</script>&', shape: 'l', processor: 'process'}); assert(!escaped.includes('<script>')); assert(escaped.includes('&lt;script&gt;')); assert(escaped.includes('&amp;')); assert(diagram({shape: 'l', turn: 'curve'}).includes('L con curva continua'));
console.log('Guided diagrams: straight/L/T/Y, 1–12 modules, explicit processors, complete directed border connections, branch topology, non-overlap and XML escaping passed.');
