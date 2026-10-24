'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {ApiError, invalid, plain, safeTree, nameValue, pathValue, validateDocument} = require('./validation');
const {validateRun, runMeta} = require('./telemetry');
const {MAX_ASSET_BYTES} = require('../shared/asset-limits');

const HASH = /^[a-f0-9]{64}$/;
const MAX_CONFIGURED_ASSET_BYTES = 2048 * 1024 * 1024;
const MIME = /^[a-zA-Z0-9!#$&^_.+\/-]{1,200}$/;
const EXTENSIONS = {
  model: ['glb', 'gltf', 'obj', 'fbx'],
  image: ['basis', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
  audio: ['ogg', 'mp3', 'wav', 'm4a', 'aac', 'flac'],
  video: ['mp4', 'webm', 'mov'],
  text: ['json', 'js', 'txt', 'md', 'csv', 'xml', 'mtl', 'font'],
  source: ['blend', 'blend1', 'blend2']
};

function projectMeta(row) {
  return {id: row.id, name: row.name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at};
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? Number((bytes / (1024 * 1024)).toFixed(2)) + ' MiB' : bytes + ' bytes';
}

function configuredAssetLimit(options) {
  let maximum = options.maxAssetBytes;
  if (maximum === undefined && process.env.HELLO_WEBXR_MAX_ASSET_MIB !== undefined) {
    const configured = process.env.HELLO_WEBXR_MAX_ASSET_MIB;
    if (!/^[1-9]\d*$/.test(configured)) throw new Error('HELLO_WEBXR_MAX_ASSET_MIB debe ser un entero entre 1 y 2048.');
    maximum = Number(configured) * 1024 * 1024;
  }
  if (maximum === undefined) maximum = MAX_ASSET_BYTES;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_CONFIGURED_ASSET_BYTES) {
    throw new Error('El límite de archivos debe ser un entero positivo de hasta 2048 MiB.');
  }
  return maximum;
}

function assetMime(value) {
  const mime = value === undefined || value === '' ? 'application/octet-stream' : value;
  if (typeof mime !== 'string' || !MIME.test(mime)) invalid('El tipo del archivo no es válido.');
  return mime.toLowerCase();
}

class ProjectStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(__dirname, '..', 'data'));
    this.uploadDir = path.join(this.dataDir, 'uploads');
    this.databasePath = path.join(this.dataDir, 'projects.sqlite');
    this.maxAssetBytes = configuredAssetLimit(options);
    fs.mkdirSync(this.uploadDir, {recursive: true});
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revisions (
        project_id TEXT NOT NULL REFERENCES projects(id),
        revision INTEGER NOT NULL,
        name TEXT NOT NULL,
        document TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, revision)
      );
      CREATE TABLE IF NOT EXISTS assets (
        hash TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS simulation_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        project_revision INTEGER NOT NULL,
        room_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration REAL NOT NULL CHECK(duration > 0),
        sample_count INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(project_id, project_revision) REFERENCES revisions(project_id, revision)
      );
      CREATE INDEX IF NOT EXISTS simulation_runs_project ON simulation_runs(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS simulation_samples (
        run_id TEXT NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        time REAL NOT NULL CHECK(time >= 0),
        object_id TEXT NOT NULL,
        variables TEXT NOT NULL,
        PRIMARY KEY(run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS simulation_events (
        run_id TEXT NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        time REAL NOT NULL CHECK(time >= 0),
        object_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        PRIMARY KEY(run_id, sequence)
      );
      PRAGMA user_version = 2;
    `);
    this.sql = {
      list: this.db.prepare('SELECT id, name, revision, created_at, updated_at FROM projects ORDER BY updated_at DESC, id'),
      project: this.db.prepare('SELECT id, name, revision, created_at, updated_at FROM projects WHERE id = ?'),
      revision: this.db.prepare('SELECT name, document, created_at FROM revisions WHERE project_id = ? AND revision = ?'),
      history: this.db.prepare('SELECT revision, name, created_at FROM revisions WHERE project_id = ? ORDER BY revision DESC'),
      create: this.db.prepare('INSERT INTO projects(id,name,revision,created_at,updated_at) VALUES(?,?,1,?,?)'),
      update: this.db.prepare('UPDATE projects SET name = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?'),
      insertRevision: this.db.prepare('INSERT INTO revisions(project_id,revision,name,document,created_at) VALUES(?,?,?,?,?)'),
      asset: this.db.prepare('SELECT hash, mime, size, created_at FROM assets WHERE hash = ?'),
      insertAsset: this.db.prepare('INSERT OR IGNORE INTO assets(hash,mime,size,created_at) VALUES(?,?,?,?)'),
      listRuns: this.db.prepare('SELECT * FROM simulation_runs WHERE project_id = ? ORDER BY created_at DESC, id'),
      getRun: this.db.prepare('SELECT * FROM simulation_runs WHERE project_id = ? AND id = ?'),
      insertRun: this.db.prepare('INSERT INTO simulation_runs(id,project_id,project_revision,room_id,started_at,ended_at,duration,sample_count,event_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'),
      insertSample: this.db.prepare('INSERT INTO simulation_samples(run_id,sequence,time,object_id,variables) VALUES(?,?,?,?,?)'),
      insertEvent: this.db.prepare('INSERT INTO simulation_events(run_id,sequence,time,object_id,type,message) VALUES(?,?,?,?,?,?)'),
      runSamples: this.db.prepare('SELECT time, object_id, variables FROM simulation_samples WHERE run_id = ? ORDER BY sequence'),
      runEvents: this.db.prepare('SELECT time, object_id, type, message FROM simulation_events WHERE run_id = ? ORDER BY sequence')
    };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  listProjects() { return this.sql.list.all().map(projectMeta); }

  _requireProject(id) {
    const row = this.sql.project.get(id);
    if (!row) throw new ApiError(404, 'No se encontró el proyecto.', 'not_found');
    return row;
  }

  getProject(id, revision) {
    const row = this._requireProject(id);
    const current = revision === undefined ? row.revision : revision;
    const snapshot = this.sql.revision.get(id, current);
    if (!snapshot) throw new ApiError(404, 'No se encontró esa versión del proyecto.', 'not_found');
    const result = Object.assign(projectMeta(row), {document: JSON.parse(snapshot.document)});
    if (revision !== undefined) {
      result.name = snapshot.name;
      result.historicalRevision = revision;
      result.historicalCreatedAt = snapshot.created_at;
    }
    return result;
  }

  listRevisions(id) {
    this._requireProject(id);
    return this.sql.history.all(id).map(row => ({revision: row.revision, name: row.name, createdAt: row.created_at}));
  }

  listSimulationRuns(id) {
    this._requireProject(id);
    return this.sql.listRuns.all(id).map(runMeta);
  }

  getSimulationRun(id, runId) {
    this._requireProject(id);
    const row = this.sql.getRun.get(id, runId);
    if (!row) throw new ApiError(404, 'No se encontró la ejecución.', 'not_found');
    return Object.assign(runMeta(row), {
      samples: this.sql.runSamples.all(runId).map(sample => ({time: sample.time, objectId: sample.object_id, variables: JSON.parse(sample.variables)})),
      events: this.sql.runEvents.all(runId).map(event => ({time: event.time, objectId: event.object_id, type: event.type, message: event.message}))
    });
  }

  saveSimulationRun(id, payload) {
    const data = validateRun(payload);
    const runId = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this._requireProject(id);
      const snapshot = this.sql.revision.get(id, data.projectRevision);
      if (!snapshot) invalid('Guarda el proyecto antes de registrar una ejecución de esa revisión.');
      const document = JSON.parse(snapshot.document);
      if (!Object.prototype.hasOwnProperty.call(document.rooms, data.roomId)) invalid('La sala no existe en la revisión registrada.');
      this.sql.insertRun.run(runId, id, data.projectRevision, data.roomId, data.startedAt, data.endedAt,
        data.duration, data.samples.length, data.events.length, new Date().toISOString());
      data.samples.forEach((sample, index) => this.sql.insertSample.run(runId, index, sample.time, sample.objectId, JSON.stringify(sample.variables)));
      data.events.forEach((event, index) => this.sql.insertEvent.run(runId, index, event.time, event.objectId, event.type, event.message));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getSimulationRun(id, runId);
  }

  asset(hash) {
    if (!HASH.test(hash)) throw new ApiError(404, 'No se encontró el archivo.', 'not_found');
    const row = this.sql.asset.get(hash);
    const filename = path.join(this.uploadDir, hash + '.blob');
    if (!row || !fs.existsSync(filename) || fs.statSync(filename).size !== row.size) {
      throw new ApiError(404, 'No se encontró el archivo.', 'not_found');
    }
    return {hash: row.hash, mime: row.mime, size: row.size, filename};
  }

  assetLimitError(size) {
    return new ApiError(413, 'Un archivo importado supera el límite de ' + formatBytes(this.maxAssetBytes) +
      ' por archivo.' + (Number.isSafeInteger(size) ? ' Tamaño recibido: ' + formatBytes(size) + ' (' + size + ' bytes).' : ''), 'payload_too_large');
  }

  _commitAsset(temporary, hash, mime, size) {
    const filename = path.join(this.uploadDir, hash + '.blob');
    if (fs.existsSync(filename)) {
      if (fs.statSync(filename).size !== size) throw new Error('El archivo almacenado no coincide con su contenido.');
    } else fs.renameSync(temporary, filename);
    this.sql.insertAsset.run(hash, mime, size, new Date().toISOString());
    const asset = this.asset(hash);
    return {url: '/api/assets/' + asset.hash, sha256: asset.hash, mime: asset.mime, size: asset.size};
  }

  // Binary uploads are streamed to disk and hashed incrementally. No full-sized
  // buffer or base64 string is retained while receiving a large model.
  async receiveAsset(req) {
    const mime = assetMime(req.headers['x-asset-mime']);
    const contentLength = req.headers['content-length'];
    let expected;
    if (contentLength !== undefined) {
      if (typeof contentLength !== 'string' || !/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
        throw new ApiError(400, 'El tamaño del archivo no es válido.');
      }
      expected = Number(contentLength);
      if (expected > this.maxAssetBytes) throw this.assetLimitError(expected);
    }
    const temporary = path.join(this.uploadDir, 'upload.' + randomUUID() + '.tmp');
    let handle;
    let bytes = 0;
    const hash = createHash('sha256');
    // Keep an early disconnect from becoming an unhandled error while opening
    // the spool. The async iterator also observes and rejects request errors.
    const observeError = () => {};
    req.on('error', observeError);
    try {
      handle = await fs.promises.open(temporary, 'wx');
      for await (const chunk of req.iterator({destroyOnReturn: false})) {
        bytes += chunk.length;
        if (bytes > this.maxAssetBytes) throw this.assetLimitError(bytes);
        hash.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(chunk, written, chunk.length - written);
          if (!result.bytesWritten) throw new Error('No se pudo escribir el archivo.');
          written += result.bytesWritten;
        }
      }
      if (req.aborted || !req.complete || expected !== undefined && bytes !== expected) {
        throw new ApiError(400, 'La carga del archivo se interrumpió.');
      }
      await handle.close();
      handle = null;
      return this._commitAsset(temporary, hash.digest('hex'), mime, bytes);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (req.aborted || req.destroyed && !req.complete) throw new ApiError(400, 'La carga del archivo se interrumpió.');
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (req.destroyed) req.removeListener('error', observeError);
      else req.once('close', () => req.removeListener('error', observeError));
      if (!req.complete && !req.destroyed) req.resume();
    }
  }

  _saveImport(record) {
    const assetPath = pathValue(record.path);
    let asset;
    if (record.dataUrl !== undefined) {
      if (typeof record.dataUrl !== 'string' || record.dataUrl.length > Math.ceil(this.maxAssetBytes / 3) * 4 + 300) {
        throw this.assetLimitError();
      }
      const match = /^data:([a-zA-Z0-9!#$&^_.+\/-]*)(?:;[a-zA-Z0-9!#$&^_.+\/=\-]+)*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(record.dataUrl);
      if (!match || match[2].length % 4 === 1) invalid('Un archivo importado no contiene datos base64 válidos.');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > this.maxAssetBytes) throw this.assetLimitError(bytes.length);
      if (bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) invalid('Un archivo importado no contiene datos base64 válidos.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const mime = assetMime(match[1]);
      const filename = path.join(this.uploadDir, hash + '.blob');
      if (!fs.existsSync(filename)) {
        const temporary = path.join(this.uploadDir, hash + '.' + randomUUID() + '.tmp');
        try {
          fs.writeFileSync(temporary, bytes, {flag: 'wx'});
          fs.renameSync(temporary, filename);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      }
      this.sql.insertAsset.run(hash, mime, bytes.length, new Date().toISOString());
      asset = this.asset(hash);
    } else {
      if (typeof record.sha256 !== 'string' || !HASH.test(record.sha256) || record.url !== '/api/assets/' + record.sha256) {
        invalid('La referencia del archivo guardado no es válida.');
      }
      asset = this.asset(record.sha256);
      if (record.mime !== asset.mime || record.size !== asset.size) invalid('Los metadatos del archivo guardado no coinciden.');
    }
    const name = assetPath.split('/').pop();
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return {
      id: record.id, importId: record.id, batchId: record.batchId || 'restored', path: assetPath,
      name, extension, kind: Object.keys(EXTENSIONS).find(kind => EXTENSIONS[kind].includes(extension)) || 'other',
      url: '/api/assets/' + asset.hash, sha256: asset.hash, mime: asset.mime, size: asset.size
    };
  }

  saveProject(id, payload) {
    if (!plain(payload)) invalid('Los datos del proyecto no son válidos.');
    safeTree(payload);
    const name = nameValue(payload.name);
    if (id && (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 1)) {
      invalid('Falta la versión del proyecto que intentas guardar.');
    }
    const timestamp = new Date().toISOString();
    const projectId = id || randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = id ? this._requireProject(id) : null;
      if (row && row.revision !== payload.expectedRevision) {
        throw new ApiError(409, 'El proyecto cambió en otra ventana. Abre la versión actual o guarda una copia para conservar tus cambios.', 'revision_conflict');
      }
      const document = validateDocument(payload.document, record => this._saveImport(record));
      const revision = row ? row.revision + 1 : 1;
      if (row) this.sql.update.run(name, revision, timestamp, id, row.revision);
      else this.sql.create.run(projectId, name, timestamp, timestamp);
      this.sql.insertRevision.run(projectId, revision, name, JSON.stringify(document), timestamp);
      this.db.exec('COMMIT');
      // Return this committed write even if another server process saves again immediately.
      return {id: projectId, name, revision, createdAt: row ? row.created_at : timestamp, updatedAt: timestamp, document};
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

module.exports = {ProjectStore, MAX_ASSET_BYTES};
