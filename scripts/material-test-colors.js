'use strict';
// Authored HTML colors enter the renderer as linear RGB. Encode a private copy
// and round to display bytes: r112 getHexString truncates 254.999999… at white.
function authoredHex(color) {
  const srgb = color.clone().convertLinearToSRGB();
  return [srgb.r, srgb.g, srgb.b].map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')).join('');
}
module.exports = {authoredHex};
