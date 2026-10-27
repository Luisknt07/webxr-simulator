// The modelling kernel is loaded only when the design window is opened.
// Recipes are bounded declarative data, never executable user code.
const engine = require('../../shared/cad-engine.js');
self.onmessage = event => {
  const {id, recipe} = event.data || {};
  try { self.postMessage({id, result: engine.compile(recipe)}); }
  catch (error) { self.postMessage({id, error: error.message || 'No se pudo construir la pieza.'}); }
};
