const __layout = require("../../tooling/layout.cjs");
'use strict';

// Reuse the existing real Three.js/RayControl harness, but dispatch every
// account/keyboard/login action through rays instead of calling authenticate.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vr-login-rays.js"), 'test-immersive-studio-menu.js')), 'utf8');
const boundary = source.indexOf('async function run()');
assert(boundary > 0);
const {harness, aim} = new Function('require', '__dirname', source.slice(0, boundary) + '\nreturn {harness, aim};')(require, __dirname);
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

async function run() {
  async function scenario(keyboardSubmit) {
  const f = harness(), menu = f.menu;
  menu.setVR(true); menu.tick(.016); menu.open('home'); menu.tick(.016);
  let hand = 0;
  async function click(key) {
    menu.tick(.016);
    const region = menu.regions.find(value => value.key === key);
    assert(region, 'Visible hit region: ' + key);
    assert(region.x >= 0 && region.y >= 0 && region.x + region.width <= 1024 && region.y + region.height <= 960, 'Region remains on the panel: ' + key);
    const target = f.controls[hand++ % 2];
    aim(f, target.controller, menu.panel, (region.x + region.width / 2) / 1024, 1 - (region.y + region.height / 2) / 960);
    f.ctx.raycontrol.execute(f.ctx, .016, hand);
    const current = target.data.currentIntersection;
    assert(current && current.state === menu.state, 'Controller ray reaches account panel: ' + key);
    assert.equal(menu.regionAt(current.intersection).key, key);
    f.ctx.raycontrol.onSelectStart({target: target.controller});
    f.ctx.raycontrol.onSelectEnd({target: target.controller});
    await settle(); menu.tick(.016);
  }
  async function typeLetters(value) {
    const rows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm-_'];
    for (const character of value) {
      const row = rows.findIndex(text => text.includes(character)); assert(row >= 0, character);
      await click('key:' + row + ':' + rows[row].indexOf(character));
    }
  }
  await click('account'); assert.equal(menu.page, 'account');
  await click('field:username'); await typeLetters('demo');
  await click('key:done'); assert.equal(menu.keyboardField, 'password');
  await typeLetters('fixture2026');
  assert.equal(menu.fields.username, 'demo'); assert.equal(menu.fields.password, 'fixture2026');
  assert(!menu.canvas.text.some(value => value.includes('fixture2026')));
  await click(keyboardSubmit ? 'key:done' : 'authenticate');
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].kind, 'login');
  assert.equal(f.writes[0].username, 'demo'); assert.equal(f.writes[0].password, 'fixture2026');
  assert.equal(f.client.user.id, 'demo'); assert.equal(menu.page, 'home'); assert.equal(menu.fields.password, '');
  assert(f.calls.some(value => value && value.authenticated && value.authenticated.immersive));
  assert.equal(f.applications.length, 0, 'Signing in never replaces the current world.');
  menu.dispose();
  }
  await scenario(false); await scenario(true);
  console.log('VR login rays: both hands reach username/password, native keyboard and submit; one authentication, masked/cleared credentials and current world preserved.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
