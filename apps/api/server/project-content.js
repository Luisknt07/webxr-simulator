'use strict';

// Derived, current-revision project folders. SQLite remains authoritative;
// filesystem failure never turns a committed save into an apparent failure.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {createContentProject, serializeContentFile} = require('../../../packages/project-format/index.js');
const HASH = /^[a-f0-9]{64}$/;
const identity = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value);

function boundedFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 500 || relative.startsWith('/') || /[\\:%?#\0]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw Error('projection_path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('projection_path');
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try {if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('projection_link');} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return target;
}

class ProjectContentProjection {
  constructor(store) {this.store = store; this.dataDir = store.dataDir; this.warnings = new Map();}
  location(projectId, ownerId) {
    if (!identity(projectId) || !identity(ownerId)) return null;
    return 'data/users/' + ownerId + '/projects/' + projectId;
  }
  folder(projectId, ownerId) {
    if (!this.location(projectId, ownerId)) throw Error('projection_identity');
    const relative = 'users/' + ownerId + '/projects/' + projectId;
    if (fs.lstatSync(this.dataDir).isSymbolicLink()) throw Error('projection_link');
    return boundedFile(this.dataDir, relative);
  }
  assetFolder(ownerId) {
    if (!identity(ownerId) || fs.lstatSync(this.dataDir).isSymbolicLink()) throw Error('projection_identity');
    return boundedFile(this.dataDir, 'users/' + ownerId + '/assets');
  }
  describe(project, ownerId) {
    const relativePath = this.location(project.id, ownerId), base = {kind:'server', canonical:'sqlite', relativePath,
      descriptorPath:relativePath ? relativePath + '/project.stproject' : null,
      contentPath:relativePath ? relativePath + '/Content' : null, mapsPath:relativePath ? relativePath + '/Content/Maps' : null,
      materialized:false, contentRevision:null};
    if (!relativePath) return {...base, warning:'legacy_ownerless'};
    try {
      const folder = this.folder(project.id, ownerId), marker = boundedFile(folder, '.projection.json');
      if (fs.existsSync(marker) && fs.statSync(marker).size < 1024 * 1024) {
        const receipt = JSON.parse(fs.readFileSync(marker, 'utf8'));
        if (receipt.id === project.id && Number.isSafeInteger(receipt.revision)) {
          base.contentRevision = receipt.revision; base.materialized = receipt.revision === project.revision;
          if (Number.isSafeInteger(receipt.externalAssets) && receipt.externalAssets) base.externalAssets = receipt.externalAssets;
        }
      }
    } catch (_) { /* Location metadata never exposes a host path or filesystem error. */ }
    const warning = this.warnings.get(project.id); if (warning) {base.warning = warning; base.materialized = false;}
    return base;
  }
  unchanged(folder, projectId) {
    if (!fs.existsSync(folder)) return true;
    if (!fs.lstatSync(folder).isDirectory()) throw Error('content_modified');
    const marker = boundedFile(folder, '.projection.json');
    if (!fs.existsSync(marker)) {
      const names = fs.readdirSync(folder);
      if (!names.length) return true;
      if (names.length !== 1 || names[0] !== 'project.json') throw Error('content_modified');
      const previous = JSON.parse(fs.readFileSync(boundedFile(folder, 'project.json'), 'utf8'));
      if (previous.id !== projectId) throw Error('content_modified');
      return true;
    }
    if (fs.statSync(marker).size > 1024 * 1024) throw Error('content_modified');
    const receipt = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (receipt.id !== projectId || !Array.isArray(receipt.files) || receipt.files.length > 4096) throw Error('content_modified');
    const expected = new Map(receipt.files.map(file => [file.path, file]));
    if (expected.size !== receipt.files.length) throw Error('content_modified');
    for (const file of receipt.files) {
      if (!HASH.test(file.sha256)) throw Error('content_modified');
      const filename = boundedFile(folder, file.path);
      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile() || hash(fs.readFileSync(filename)) !== file.sha256) throw Error('content_modified');
    }
    const walk = (directory, prefix = '') => {
      for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
        const name = prefix + entry.name;
        if (entry.isSymbolicLink()) throw Error('content_modified');
        if (entry.isDirectory()) {
          if (![...expected.keys()].some(file => file.startsWith(name + '/'))) throw Error('content_modified');
          walk(path.join(directory, entry.name), name + '/');
        } else if (name !== '.projection.json' && !expected.has(name)) throw Error('content_modified');
      }
    };
    walk(folder); return true;
  }
  removeOwned(folder, prefix) {
    const parent = path.dirname(folder);
    if (!path.basename(folder).startsWith(prefix) || !path.resolve(parent).startsWith(path.resolve(this.dataDir) + path.sep) || fs.lstatSync(folder).isSymbolicLink()) throw Error('projection_cleanup');
    fs.rmSync(folder, {recursive:true, force:true});
  }
  materialize(project, ownerId, {kind = 'studio', moduleState, assets = []} = {}) {
    if (!this.location(project.id, ownerId)) return this.describe(project, ownerId);
    let stage, previous;
    try {
      const folder = this.folder(project.id, ownerId), parent = path.dirname(folder);
      // Inspect every parent before creating anything; never follow a linked user folder.
      boundedFile(this.dataDir, 'users/' + ownerId + '/projects'); fs.mkdirSync(parent, {recursive:true});
      const bundle = createContentProject(project.document, {id:project.id, name:project.name, revision:project.revision, kind, ...(moduleState === undefined ? {} : {moduleState})});
      this.unchanged(folder, project.id);
      const marker = boundedFile(folder, '.projection.json');
      if (fs.existsSync(marker)) {
        const receipt = JSON.parse(fs.readFileSync(marker, 'utf8'));
        const descriptor = receipt.files.find(file => file.path === 'project.stproject');
        if (receipt.revision === project.revision && receipt.kind === kind && descriptor && descriptor.sha256 === hash(Buffer.from(json(bundle.descriptor), 'utf8'))) {
          this.warnings.delete(project.id); return this.describe(project, ownerId);
        }
      }
      stage = path.join(parent, '.content-' + project.id + '-' + randomUUID()); fs.mkdirSync(stage);
      const files = [], write = (relative, bytes) => {
        const filename = boundedFile(stage, relative); fs.mkdirSync(path.dirname(filename), {recursive:true}); fs.writeFileSync(filename, bytes); files.push({path:relative, sha256:hash(bytes)});
      };
      for (const file of bundle.files) write(file.path, Buffer.from(serializeContentFile(file), 'utf8'));
      write('project.stproject', Buffer.from(json(bundle.descriptor), 'utf8'));
      write('project.json', Buffer.from(json({id:project.id,name:project.name,revision:project.revision,ownerId,kind}), 'utf8'));
      let linked = 0;
      for (const asset of bundle.descriptor.assets || []) {
        if (!asset.blobPath || !HASH.test(asset.sha256 || '')) continue;
        const source = assets.find(row => row.sha256 === asset.sha256); if (!source) continue;
        if (fs.lstatSync(source.filename).isSymbolicLink() || !fs.statSync(source.filename).isFile()) throw Error('projection_asset');
        const bytes = fs.readFileSync(source.filename); if (hash(bytes) !== asset.sha256) throw Error('projection_asset');
        const filename = boundedFile(stage, asset.blobPath); fs.mkdirSync(path.dirname(filename), {recursive:true});
        if (files.some(file => file.path === asset.blobPath)) continue;
        try {fs.linkSync(source.filename, filename);} catch (_) {fs.copyFileSync(source.filename, filename, fs.constants.COPYFILE_EXCL);}
        files.push({path:asset.blobPath,sha256:asset.sha256}); linked++;
      }
      const externalAssets = new Set((bundle.descriptor.assets || []).filter(row => row.blobPath).map(row => row.blobPath)).size - linked;
      fs.writeFileSync(path.join(stage, '.projection.json'), json({id:project.id,revision:project.revision,kind,externalAssets,files}));
      // Re-check before retiring the old projection so concurrent manual edits survive.
      this.unchanged(folder, project.id);
      if (fs.existsSync(folder)) {previous = path.join(parent, '.previous-' + project.id + '-' + randomUUID()); fs.renameSync(folder, previous);}
      try {fs.renameSync(stage, folder); stage = null;} catch (error) {if (previous) {fs.renameSync(previous, folder); previous = null;} throw error;}
      if (previous) {this.removeOwned(previous, '.previous-' + project.id + '-'); previous = null;}
      this.warnings.delete(project.id); return this.describe(project, ownerId);
    } catch (error) {
      this.warnings.set(project.id, error.message === 'content_modified' ? 'content_modified' : 'projection_unavailable');
      return this.describe(project, ownerId);
    } finally {
      if (stage && fs.existsSync(stage)) try {this.removeOwned(stage, '.content-' + project.id + '-');} catch (_) { /* An unowned replacement is never deleted. */ }
    }
  }
  delete(projectId, ownerId) {
    if (!this.location(projectId, ownerId)) return;
    const folder = this.folder(projectId, ownerId); if (!fs.existsSync(folder)) return;
    this.unchanged(folder, projectId);
    const moved = path.join(path.dirname(folder), '.removed-' + projectId + '-' + randomUUID()); fs.renameSync(folder, moved); this.removeOwned(moved, '.removed-' + projectId + '-'); this.warnings.delete(projectId);
  }
}

module.exports = {ProjectContentProjection};
