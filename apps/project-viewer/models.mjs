/** UI values are data from installed functions. They never become HTML, code,
 * event-handler source or a command outside their owning function namespace. */
export function panelModel(value, owner, commands) {
  const text = (input, maximum) => typeof input === 'string' ? input.slice(0, maximum) : '';
  const kinds = ['form', 'table', 'progress', 'assessment'];
  const kind = value && kinds.includes(value.kind) ? value.kind : 'readonly';
  const fields = value && (value.fields || value.columns);
  const rawActions = value && (value.actions || (value.action ? [value.action] : []));
  const actions = kind === 'readonly' || !Array.isArray(rawActions) ? [] : rawActions.slice(0, 32).filter(action =>
    typeof action === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(action) && commands.some(command => command.functionId === owner && command.key === owner + ':' + action));
  return {kind, title: text(value && value.title, 160) || owner, description: text(value && value.description, 500),
    fields: Array.isArray(fields) ? fields.slice(0, 32).filter(field => typeof field === 'string').map(field => field.slice(0, 80)) : [], actions: [...new Set(actions)]};
}

export function renderPanel({document, parent, registration, commands, project, dispatch, isCurrent = () => true}) {
  const model = panelModel(registration.value, registration.functionId, commands), listeners = [];
  const add = (tag, text, destination = parent) => {const element = document.createElement(tag); if (text) element.textContent = text; destination.appendChild(element); return element;};
  const panel = add('section', ''); panel.className = 'module-panel'; panel.dataset.functionId = registration.functionId;
  add('h2', model.title, panel); add('code', registration.functionId, panel);
  if (model.description) add('p', model.description, panel);
  if (model.fields.length) {const field = add('p', '', panel); field.className = 'model-fields'; field.textContent = 'Campos: ' + model.fields.join(', ');}
  if (!model.actions.length) return () => panel.remove();
  const label = add('label', 'Datos de la acción (JSON)', panel), payload = add('textarea', '', label); payload.maxLength = 20000; payload.rows = 5;
  const component = project.entities.flatMap(entity => entity.components).find(value => value.functionId === registration.functionId);
  payload.value = JSON.stringify(component ? component.data : null, null, 2);
  const buttons = add('div', '', panel); buttons.className = 'command-actions';
  const output = add('pre', '', panel); output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
  for (const action of model.actions) {
    const button = add('button', action, buttons); button.type = 'button'; button.dataset.command = registration.functionId + ':' + action;
    const handler = async () => {
      if (!isCurrent()) return; button.disabled = true;
      try {
        if (payload.value.length > 20000) throw new Error('Los datos de la acción son demasiado extensos.');
        const result = await dispatch(registration.functionId + ':' + action, JSON.parse(payload.value || 'null'));
        if (isCurrent()) {output.textContent = JSON.stringify(result === undefined ? null : result, null, 2); output.dataset.state = 'success';}
      } catch (error) {if (isCurrent()) {output.textContent = error && error.message || 'No se pudo completar la acción.'; output.dataset.state = 'error';}}
      finally {if (isCurrent()) button.disabled = false;}
    };
    button.addEventListener('click', handler); listeners.push(() => button.removeEventListener('click', handler));
  }
  return () => {listeners.forEach(off => off()); panel.remove();};
}
