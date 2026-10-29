/* Public deployment configuration only. Never put credentials or private
 * project documents here. An authenticated backend can be hosted separately. */
window.SMARTTWIN_PUBLIC_VIEWER_CONFIG = Object.freeze(Object.assign({
  sceneURL: 'projects/smarttwin/scenes/vr-robot-dispatch.json',
  apiOrigin: '',
  workspaceURL: ''
}, window.SMARTTWIN_PUBLIC_VIEWER_CONFIG || {}));
