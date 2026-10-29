// Simulation records share the local project server and never connect to a PLC.
export default class TelemetryClient {
  constructor(base = '/api') { this.base = base; }

  async request(method, path, body) {
    let response;
    try {
      response = await fetch(this.base + path, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? {Accept: 'application/json'} : {Accept: 'application/json', 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (_) { throw new Error('No se pudo conectar con el almacenamiento de analítica. Comprueba que el servidor siga ejecutándose.'); }
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error('El servidor no ofrece almacenamiento de analítica. Inicia el sitio con npm.cmd start.'); }
    if (!response.ok) {
      const error = new Error(typeof result.error === 'string' ? result.error : 'No se pudo guardar la analítica.');
      error.status = response.status;
      error.code = result.code;
      throw error;
    }
    return result;
  }

  async list(projectId) { return (await this.request('GET', '/projects/' + encodeURIComponent(projectId) + '/runs')).runs; }
  async get(projectId, runId) {
    return (await this.request('GET', '/projects/' + encodeURIComponent(projectId) + '/runs/' + encodeURIComponent(runId))).run;
  }
  async save(projectId, payload) { return (await this.request('POST', '/projects/' + encodeURIComponent(projectId) + '/runs', payload)).run; }
}
