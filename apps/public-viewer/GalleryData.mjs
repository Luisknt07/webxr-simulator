import {publicSceneEntry, filterSceneEntries, DIFFICULTY_LABELS, MODE_LABELS} from '../../projects/smarttwin/SceneLibraryMetadata.mjs';
import publicExamples from '../../projects/smarttwin/public-scenes.js';
export {filterSceneEntries, DIFFICULTY_LABELS, MODE_LABELS};
export const PUBLIC_SCENE_ID = 'vr-robot-dispatch';
const identifier = /^[a-z0-9][a-z0-9-]{0,79}$/;
const text = (value, fallback, length = 160) => typeof value === 'string' && value.trim() ? value.trim().slice(0, length) : fallback;

function galleryEntry(row) {
  const view = publicSceneEntry(row, row.included === true), open = row.id === PUBLIC_SCENE_ID;
  return {id: view.id, name: view.title, title: view.title, category: view.category, collection: view.category, description: view.description,
    objective: view.objective, tasks: view.tasks, difficulty: view.difficulty, mode: view.mode, searchable: view.searchable,
    included: row.included === true, original: row.original === true, templateId: typeof row.templateId === 'string' ? row.templateId.slice(0, 80) : '', public: open,
    thumbnailURL: view.thumbnail ? (open ? 'projects/smarttwin/previews/' : '/workspace/projects/smarttwin/previews/') + row.id + '.png' : null};
}
export const PUBLIC_SCENE = Object.freeze(galleryEntry({id: PUBLIC_SCENE_ID, roomId: 'hall',
  name: publicExamples.PUBLIC_DEMO.name, collection: 'Realidad virtual compacta', templateId: publicExamples.PUBLIC_DEMO.templateId, included: true, public: true}));

export function backendOrigin(configuration, baseURI) {
  if (configuration.backendAvailable !== true) return null;
  try {
    const page = new URL(baseURI), backend = new URL(configuration.apiOrigin || page.origin, page);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname);
    if (backend.origin !== page.origin || backend.username || backend.password || backend.protocol !== 'https:' && !(local && backend.protocol === 'http:')) return null;
    return backend.origin;
  } catch (_) {return null;}
}

export function sceneEntries(catalog, authenticated = false) {
  const rows = catalog && Array.isArray(catalog.scenes) ? catalog.scenes : [], seen = new Set(), scenes = [];
  const standardTransfer = authenticated && rows.some(row => row && row.id === publicExamples.PUBLIC_DEMO.templateId);
  for (const row of rows.slice(0, 128)) {
    if (!row || typeof row.id !== 'string' || !identifier.test(row.id) || seen.has(row.id) || !authenticated && row.id !== PUBLIC_SCENE_ID) continue;
    seen.add(row.id);
    // Signed-in users open the maintained library scene, not a second demo card.
    if (standardTransfer && row.id === PUBLIC_SCENE_ID) continue;
    // The public fallback is a real recipe too. Retain its trusted template
    // identity even if an older API returns only id/name for this one card.
    scenes.push(galleryEntry(row.id === PUBLIC_SCENE_ID ? {...row, included: true, templateId: publicExamples.PUBLIC_DEMO.templateId} : row));
  }
  if (!standardTransfer && !seen.has(PUBLIC_SCENE_ID)) scenes.unshift({...PUBLIC_SCENE});
  // Match the in-world menu's source/category order. Alphabetical sorting puts
  // “Giro” before “Transferencia” and changes the compact lessons' progression.
  return scenes.slice(0, 128);
}

/** Pages never probes APIs. A server explicitly advertises a same-origin API;
 * only a confirmed session may request its authenticated scene catalogue. */
export async function loadGallery({configuration = {}, baseURI, fetcher, signal} = {}) {
  const origin = backendOrigin(configuration, baseURI), fallback = {scenes: [{...PUBLIC_SCENE}], user: null, backend: !!origin, unavailable: false};
  if (!origin) return fallback;
  try {
    const options = {credentials: 'same-origin', cache: 'no-store', signal};
    const response = await fetcher(origin + '/api/studio/me', options);
    if (!response.ok) return {...fallback, unavailable: true};
    const profile = await response.json(), user = profile && profile.user;
    if (!user || typeof user.id !== 'string' || !user.id) return fallback;
    const account = {name: text(user.displayName, text(user.username, 'Tu cuenta'), 80)};
    const catalogResponse = await fetcher(origin + '/api/library/scenes', options);
    if (!catalogResponse.ok) return {...fallback, user: account, unavailable: true};
    return {scenes: sceneEntries(await catalogResponse.json(), true), user: account, backend: true, unavailable: false};
  } catch (error) {
    if (signal && signal.aborted) throw error;
    return {...fallback, unavailable: true};
  }
}

export function sceneURL(scene, origin, authenticated = false) {
  if (!scene || !identifier.test(scene.id)) throw new Error('El escenario no es válido.');
  if (scene.id === PUBLIC_SCENE_ID && !authenticated) return null;
  if (!origin) throw new Error('Inicia sesión para abrir este escenario.');
  const url = new URL('/editor', origin); url.searchParams.set('libraryScene', scene.id === PUBLIC_SCENE_ID ? publicExamples.PUBLIC_DEMO.templateId : scene.id); return url.href;
}
