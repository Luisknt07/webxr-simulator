// Loaded before the application bundle so startup errors cannot hide behind its spinner.
(function () {
  var state = {message: 'Cargando la experiencia…', error: null, ready: false};

  function render() {
    var overlay = document.getElementById('loading');
    if (!overlay) return;
    var message = document.getElementById('loading-message');
    if (message) message.textContent = state.message;
    if (state.error) {
      overlay.classList.add('loading-failed');
      var title = document.getElementById('loading-title');
      if (title) title.textContent = 'No se pudo iniciar';
      var details = document.getElementById('loading-error');
      if (details) { details.textContent = state.error; details.hidden = false; }
      var retry = document.getElementById('loading-retry');
      if (retry) retry.hidden = false;
    }
  }

  window.webxrStartup = {
    phase: function (message) { if (!state.error && !state.ready) { state.message = message; render(); } },
    progress: function (loaded, total) {
      if (state.error || state.ready) return;
      state.message = 'Cargando recursos: ' + loaded + ' / ' + total;
      var bar = document.getElementById('progressbar');
      if (bar) bar.setAttribute('stroke-dashoffset', String(-Math.round(282 * loaded / Math.max(1, total))));
      render();
    },
    fail: function (error) {
      if (state.ready || state.error) return;
      state.error = error && error.message || String(error || 'Error desconocido al iniciar.');
      state.message = 'La carga se detuvo. Puedes volver a intentarlo.';
      console.error('Error al iniciar Hello WebXR:', error);
      render();
    },
    complete: function () {
      if (state.error) return;
      state.ready = true;
      var overlay = document.getElementById('loading');
      if (overlay) overlay.style.display = 'none';
    }
  };
  window.addEventListener('error', function (event) {
    if (event.error) window.webxrStartup.fail(event.error);
    else if (event.target && /(?:^|\/)bundle\.js(?:\?|$)/.test(event.target.src || '')) window.webxrStartup.fail(new Error('No se pudo descargar la aplicación.'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) { window.webxrStartup.fail(event.reason); });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = document.getElementById('loading-retry');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });
    render();
  });
}());
