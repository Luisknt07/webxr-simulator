/* Run after adding project assets: node scripts/generate-asset-catalog.js */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readBlendThumbnail, thumbnailPng } = require('./blend-thumbnail');

const assetsDirectory = path.resolve(__dirname, '../assets');
const previewsDirectory = 'editor-previews';
const extensions = {
  model: ['glb', 'gltf', 'obj', 'fbx'],
  image: ['basis', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
  audio: ['ogg', 'mp3', 'wav', 'm4a', 'aac', 'flac'],
  video: ['mp4', 'webm', 'mov'],
  text: ['json', 'js', 'txt', 'md', 'csv', 'xml', 'mtl', 'font'],
  source: ['blend', 'blend1', 'blend2']
};

function visit(directory, root, outputPath) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((entries, item) => {
    const absolute = path.join(directory, item.name);
    // The integrated inference runtime is application code, not scene assets.
    if (absolute === outputPath || absolute === path.join(root, previewsDirectory) || absolute === path.join(root, 'scene-thumbnails') || absolute === path.join(root, 'ai') || absolute === path.join(root, 'public-scenes') || item.isSymbolicLink()) return entries;
    if (item.isDirectory()) return entries.concat(visit(absolute, root, outputPath));
    if (!item.isFile()) return entries;
    const extension = path.extname(item.name).slice(1).toLowerCase();
    const kind = Object.keys(extensions).find(key => extensions[key].includes(extension)) || 'other';
    entries.push({
      path: path.relative(root, absolute).split(path.sep).join('/'),
      name: item.name,
      extension,
      size: fs.statSync(absolute).size,
      kind
    });
    return entries;
  }, []);
}

function generateCatalog(root = assetsDirectory) {
  const outputPath = path.join(root, 'editor-catalog.json');
  const entries = visit(root, root, outputPath).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const models = entries.filter(entry => entry.extension === 'glb' || entry.extension === 'gltf');
  for (const entry of entries) {
    if (entry.kind !== 'source') continue;
    const basename = entry.name.slice(0, -(entry.extension.length + 1)).toLowerCase();
    const matches = models.filter(model => {
      const modelBasename = model.name.slice(0, -(model.extension.length + 1)).toLowerCase();
      return modelBasename === basename || modelBasename === basename + '.min';
    });
    // Only one matching exported basename is reliable; similarly named variants are not.
    if (matches.length === 1) entry.previewPath = matches[0].path;
    const thumbnail = readBlendThumbnail(path.join(root, entry.path));
    if (!thumbnail) continue;
    const hash = crypto.createHash('sha1').update(entry.path).digest('hex').slice(0, 16);
    const relativePath = previewsDirectory + '/blend_' + hash + '.png';
    const png = thumbnailPng(thumbnail);
    const thumbnailPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
    // Avoid changing timestamps (and triggering watchers) for identical thumbnails.
    if (!fs.existsSync(thumbnailPath) || !fs.readFileSync(thumbnailPath).equals(png)) fs.writeFileSync(thumbnailPath, png);
    entry.thumbnailPath = relativePath;
  }
  fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2) + '\n');
  return entries;
}

if (require.main === module) {
  const entries = generateCatalog();
  console.log(`Catálogo del editor: ${entries.length} archivos en assets/editor-catalog.json`);
}

module.exports = { generateCatalog };
