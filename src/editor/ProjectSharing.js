function element(tag, text, host) { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (host) host.appendChild(result); return result; }

/** Explicit project access; a copied URL alone never grants permission. */
export default class ProjectSharing {
  constructor(editor) { this.editor = editor; }
  async open() {
    const editor = this.editor, project = editor.currentProject;
    if (!editor.accessView.enabled || !project) return;
    if (this.host) this.host.remove();
    const host = this.host = element('div', undefined, editor.sharePanel); host.className = 'ed-project-share-access';
    element('p', 'El enlace requiere una cuenta autorizada. Los cambios compartidos se sincronizan al guardar; una edición simultánea conserva el conflicto para guardar una copia.', host);
    if (!project.access || !project.access.canShare) { element('p', 'Solo el propietario o el superadministrador puede cambiar los permisos.', host); return; }
    const result = await editor.projectClient.request('GET', '/projects/' + encodeURIComponent(project.id) + '/shares');
    if (host !== this.host || project.id !== editor.currentProject.id) return;
    (result.shares || []).forEach(share => {
      const row = element('div', undefined, host); row.className = 'ed-actions'; element('span', share.username + ' · ' + (share.permission === 'editor' ? 'Editar' : 'Visualizar'), row);
      const remove = element('button', 'Quitar acceso', row); remove.className = 'ed-button'; remove.addEventListener('click', () => editor.perform(async () => { await editor.projectClient.request('DELETE', '/projects/' + encodeURIComponent(project.id) + '/shares/' + encodeURIComponent(share.userId), {}); await this.open(); }));
    });
    const form = element('form', undefined, host); const label = element('label', 'Usuario de Studio', form); const username = element('input', undefined, label); username.required = true; username.maxLength = 64; username.autocomplete = 'off';
    const permission = element('select', undefined, form);
    [['viewer', 'Puede visualizar'], ['editor', 'Puede editar']].forEach(([value, text]) => { const option = element('option', text, permission); option.value = value; });
    const submit = element('button', 'Compartir proyecto', form); submit.type = 'submit'; submit.className = 'ed-button primary';
    form.addEventListener('submit', event => { event.preventDefault(); submit.disabled = true; editor.perform(async () => { try { await editor.projectClient.request('PUT', '/projects/' + encodeURIComponent(project.id) + '/shares', {username: username.value.trim(), permission: permission.value}); await this.open(); } finally { submit.disabled = false; } }); });
  }
}
