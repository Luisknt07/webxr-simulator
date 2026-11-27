/* Public deployment configuration only. Never put credentials or private
 * project documents here. An authenticated backend can be hosted separately. */
window.SMARTTWIN_PUBLIC_VIEWER_CONFIG = Object.freeze(Object.assign({
  sceneURL: 'projects/smarttwin/scenes/vr-robot-dispatch.json?v=wheel-routes-20261127',
  backendAvailable: false,
  apiOrigin: '',
  workspaceURL: ''
}, window.SMARTTWIN_PUBLIC_VIEWER_CONFIG || {}));
