'use strict';

const fs = require('node:fs');
const {ProjectStore} = require('./storage');
const {ApiError} = require('./validation');
const {MAX_TELEMETRY_BYTES} = require('./telemetry');
const {StudioService} = require('./studio-service');

const MAX_BODY_BYTES = 128 * 1024 * 1024;

function json(res, status, data, method) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(method === 'HEAD' ? undefined : body);
}

function readBody(req, maximum, limitMessage = 'El proyecto supera el límite de 128 MiB por guardado.') {
  return new Promise((resolve, reject) => {
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maximum)) {
      req.resume();
      reject(new ApiError(413, limitMessage, 'payload_too_large'));
      return;
    }
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > maximum) {
        rejected = true;
        chunks.length = 0;
        reject(new ApiError(413, limitMessage, 'payload_too_large'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (req.studioWriteGuard) req.studioWriteGuard();
        resolve(value);
      } catch (error) { reject(error instanceof ApiError ? error : new ApiError(400, 'El cuerpo de la solicitud debe ser JSON válido.')); }
    });
    req.on('error', () => reject(new ApiError(400, 'No se pudo recibir el proyecto.')));
    req.on('aborted', () => reject(new ApiError(400, 'La solicitud se interrumpió.')));
  });
}

function projectLimitMessage(maximum) {
  return 'El proyecto supera el límite de ' + (maximum >= 1024 * 1024 ?
    Number((maximum / (1024 * 1024)).toFixed(2)) + ' MiB' : maximum + ' bytes') + ' por guardado.';
}

function verifyWrite(req, binary = false) {
  const origin = req.headers.origin;
  if (origin) {
    let allowed = false;
    try {
      const parsed = new URL(origin);
      allowed = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === req.headers.host;
    } catch (_) { /* Invalid Origin is rejected below. */ }
    if (!allowed) throw new ApiError(403, 'La solicitud debe venir del mismo sitio.', 'forbidden');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'La solicitud debe venir del mismo sitio.', 'forbidden');
  const contentType = req.headers['content-type'] || '';
  if (!(binary ? /^application\/octet-stream(?:\s*;|$)/i : /^application\/json(?:\s*;|$)/i).test(contentType)) {
    throw new ApiError(415, binary ? 'Envía el archivo como application/octet-stream.' : 'Envía el proyecto como application/json.', 'unsupported_media_type');
  }
}

function streamAsset(req, res, asset) {
  const inline = /^(?:image\/(?!svg\+xml$)[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|model\/gltf-(?:binary|json)|application\/(?:octet-stream|json)|text\/plain)$/.test(asset.mime);
  const mime = inline || asset.mime === 'image/svg+xml' ? asset.mime : 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + asset.hash + '.blob"',
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Accept-Ranges': 'bytes',
    ETag: '"' + asset.hash + '"'
  };
  if (req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  let start = 0;
  let end = asset.size - 1;
  let status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    let valid = match && (match[1] || match[2]) && asset.size > 0;
    if (valid) {
      if (!match[1]) start = Math.max(0, asset.size - Number(match[2]));
      else start = Number(match[1]);
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
      valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < asset.size && (!(!match[1] && Number(match[2]) === 0));
    }
    if (!valid) {
      res.writeHead(416, Object.assign(headers, {'Content-Range': 'bytes */' + asset.size, 'Content-Length': 0}));
      res.end();
      return;
    }
    status = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + asset.size;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || asset.size === 0) { res.end(); return; }
  const stream = fs.createReadStream(asset.filename, {start, end});
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function createApiHandler(options = {}) {
  const store = options.store || new ProjectStore(options);
  const maximum = options.maxBodyBytes || MAX_BODY_BYTES;
  const studio = new StudioService({store, json, readBody, verifyWrite, now: options.now,
    allowBootstrapRegistration: options.allowBootstrapRegistration, requireSecureCookies: options.requireSecureCookies,
    publicSceneId: options.publicSceneId, exampleCatalogPath: options.exampleCatalogPath, projectionsDir: options.projectionsDir, frameworkModulesRoot:options.frameworkModulesRoot});
  // Future maintenance only. Existing installations receive a 30-day grace
  // period during the additive migration, and tests can disable this timer.
  const maintenanceInterval = options.maintenanceIntervalMs === undefined ? 3600000 : options.maintenanceIntervalMs;
  const maintenanceTimer = maintenanceInterval > 0 ? setInterval(() => { try { studio.access.maintenance({dryRun: false}); } catch (error) { if (options.onError) options.onError(error); } }, maintenanceInterval) : null;
  if (maintenanceTimer && maintenanceTimer.unref) maintenanceTimer.unref();
  const handler = async (req, res, next) => {
    let pathname;
    try { pathname = new URL(req.originalUrl || req.url, 'http://local.invalid').pathname; }
    catch (_) { json(res, 400, {error: 'Ruta inválida.', code: 'invalid_request'}, req.method); return; }
    const full = pathname === '/api' || pathname.startsWith('/api/');
    const stripped = /^\/(?:health|projects|assets|studio|public|publication|library)(?:\/|$)/.test(pathname);
    if (!full && !stripped) {
      if (next) next();
      else json(res, 404, {error: 'Ruta no encontrada.', code: 'not_found'}, req.method);
      return;
    }
    if (full) pathname = pathname.slice(4) || '/';
    const parts = pathname.split('/').filter(Boolean);
    try {
      if (studio.requireSecureCookies && !(req.socket && req.socket.encrypted) && req.studioSecure !== true) throw new ApiError(426, 'La API requiere HTTPS.', 'https_required');
      const assetUpload = parts[0] === 'assets' && parts.length === 1 && req.method === 'POST';
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        verifyWrite(req, assetUpload);
        const initial = studio.user(req, false);
        // Body reads and streamed uploads yield to logout/role changes. Bind
        // their later commits to the account and authority that began them.
        if (initial) req.studioWriteGuard = () => {
          const current = studio.user(req);
          studio._expectedUser(req, current);
          if (current.id !== initial.id) throw new ApiError(409, 'La cuenta cambió durante la solicitud.', 'session_changed');
          if (initial.role === 'creator' && current.role !== 'creator') throw new ApiError(403, 'Tu cuenta ya no tiene permiso para editar.', 'editor_forbidden');
          return current;
        };
      }
      if (await studio.frameworkProjects.handle(req, res, pathname)) return;
      if (await studio.handle(req, res, pathname)) return;
      const actor = studio.user(req, false), access = studio.access;
      if (actor) studio._expectedUser(req, actor);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) studio.requireEditor(req);
      if (parts.length === 1 && parts[0] === 'health' && ['GET', 'HEAD'].includes(req.method)) {
        json(res, 200, {storage: 'sqlite', version: 1,
          limits: {maxAssetBytes: store.maxAssetBytes, maxProjectBytes: maximum, defaultMaxProjects: 2, defaultStorageBytes: 20971520}, capabilities: {assetUpload: true, privateProjects: true, publicSceneCatalog: true, projectSharing: true}}, req.method);
      } else if (parts[0] === 'public' && parts[1] === 'scenes' && req.method === 'GET' && parts.length <= 3) {
        json(res, 200, parts.length === 2 ? access.publicCatalog() : {project: access.publicProject(parts[2])});
      } else if (parts[0] === 'library' && parts[1] === 'scenes' && req.method === 'GET' && parts.length <= 3) {
        json(res, 200, parts.length === 2 ? access.libraryCatalog(actor) : {project: access.libraryProject(actor, parts[2])});
      } else if (parts[0] === 'publication' && parts[1] === 'scenes' && parts.length === 2 && ['GET', 'PUT'].includes(req.method)) {
        if (!access.admin(actor)) throw new ApiError(403, 'Solo el administrador publica escenas.', 'owner_required');
        if (req.method === 'GET') json(res, 200, access.publicationSettings());
        else {const value = await readBody(req, 65536); json(res, 200, access.configurePublic(actor, value.scenes, {previewAllExamples: value.previewAllExamples}));}
      } else if (assetUpload) {
        json(res, 201, {asset: await access.upload(actor, req)});
      } else if (parts[0] === 'assets' && parts.length === 2 && ['GET', 'HEAD'].includes(req.method)) {
        streamAsset(req, res, access.asset(actor, parts[1]));
      } else if (parts[0] === 'projects' && parts.length === 1 && req.method === 'GET') {
        json(res, 200, {projects: access.list(actor)});
      } else if (parts[0] === 'projects' && parts.length === 1 && req.method === 'POST') {
        json(res, 201, {project: access.save(actor, null, await readBody(req, maximum, projectLimitMessage(maximum)))});
      } else if (parts[0] === 'projects' && parts.length >= 2 && /^[a-zA-Z0-9-]{1,100}$/.test(parts[1])) {
        const id = parts[1];
        if (parts.length === 2 && req.method === 'GET') json(res, 200, {project: access.get(actor, id)});
        else if (parts.length === 2 && req.method === 'PUT') json(res, 200, {project: access.save(actor, id, await readBody(req, maximum, projectLimitMessage(maximum)))});
        else if (parts.length === 3 && parts[2] === 'shares' && req.method === 'GET') json(res, 200, {shares: access.shares(actor, id)});
        else if (parts.length === 3 && parts[2] === 'shares' && req.method === 'PUT') { const data = await readBody(req, 4096); json(res, 200, {shares: access.share(actor, id, data, data.permission)}); }
        else if (parts.length === 4 && parts[2] === 'shares' && req.method === 'DELETE') json(res, 200, {shares: access.unshare(actor, id, parts[3])});
        else if (parts.length === 2 && req.method === 'DELETE') { access.deleteProject(actor, id); json(res, 200, {ok: true}); }
        else if (parts.length === 3 && parts[2] === 'revisions' && req.method === 'GET') { access.require(actor, id); json(res, 200, {revisions: store.listRevisions(id)}); }
        else if (parts.length === 3 && parts[2] === 'runs' && req.method === 'GET') { access.require(actor, id); json(res, 200, {runs: store.listSimulationRuns(id)}); }
        else if (parts.length === 3 && parts[2] === 'runs' && req.method === 'POST') {
          access.require(actor, id, 'edit'); const data = await readBody(req, Math.min(maximum, MAX_TELEMETRY_BYTES), 'La analítica supera el límite de 16 MiB por ejecución.'); access.require(actor, id, 'edit'); access.checkQuota(access.owner(id) || actor.id, Buffer.byteLength(JSON.stringify(data)));
          json(res, 201, {run: store.saveSimulationRun(id, data)});
        } else if (parts.length === 4 && parts[2] === 'runs' && /^[a-zA-Z0-9-]{1,100}$/.test(parts[3]) && req.method === 'GET') {
          access.require(actor, id); json(res, 200, {run: store.getSimulationRun(id, parts[3])});
        }
        else if (parts.length === 4 && parts[2] === 'revisions' && /^\d+$/.test(parts[3]) && Number.isSafeInteger(Number(parts[3])) && req.method === 'GET') {
          json(res, 200, {project: access.get(actor, id, Number(parts[3]))});
        } else throw new ApiError(404, 'Ruta no encontrada.', 'not_found');
      } else throw new ApiError(404, 'Ruta no encontrada.', 'not_found');
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (!req.complete) req.resume();
      const known = error instanceof ApiError;
      if (!known && options.onError) options.onError(error);
      json(res, known ? error.status : 500, {
        error: known ? error.message : 'No se pudo completar la operación de almacenamiento.',
        code: known ? error.code : 'storage_error'
      }, req.method);
    }
  };
  handler.store = store;
  handler.studio = studio;
  handler.close = () => { if (maintenanceTimer) clearInterval(maintenanceTimer); store.close(); };
  return handler;
}

module.exports = {createApiHandler, MAX_BODY_BYTES};
