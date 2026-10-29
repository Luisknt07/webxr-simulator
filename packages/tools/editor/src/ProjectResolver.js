// Resolve the initial scene from server storage, even in a fresh browser.
// Explicit project links stay pinned; a local draft is never replaced by a
// different server project merely because that project was saved more recently.
export default async function resolveProject(client, options = {}) {
  const {explicitId, rememberedId, hasLocalBackup = false} = options;
  if (explicitId !== undefined) {
    return {project: await client.getProject(explicitId), source: 'url'};
  }
  if (rememberedId) {
    try {
      return {project: await client.getProject(rememberedId), source: 'remembered'};
    } catch (error) {
      // Only a removed project makes its remembered browser pointer stale.
      // Connection and server failures must remain visible to the caller.
      if (error.status !== 404) throw error;
    }
  }
  if (hasLocalBackup) return {project: null, source: 'none'};

  // The API orders projects by their latest save. This is the shared entry
  // point for another tab/browser that has no remembered project or draft.
  const projects = await client.listProjects();
  const candidates = projects.filter(project => project.id !== rememberedId);
  if (!candidates.length) return {project: null, source: 'none'};
  for (let index = 0; index < Math.min(2, candidates.length); index++) {
    try {
      return {project: await client.getProject(candidates[index].id), source: 'recent'};
    } catch (error) {
      // Allow one deletion race between list and get, rather than silently
      // walking through unrelated projects when loading fails.
      if (error.status !== 404 || index !== 0 || candidates.length < 2) throw error;
    }
  }
  return {project: null, source: 'none'};
}
