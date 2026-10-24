// The native stations keep animation anchors in userData. Keep those anchors in
// step with authored transforms instead of changing or recreating their objects.
function nativeDescription(object) {
  const name = object.name || '';
  const data = object.userData || {};
  if (/^door(?:[A-D]|_frame)?$/.test(name)) {
    return 'Portal nativo: conserva el cambio de sala. La profundidad Z se anima al usarlo.';
  }
  if (/^teleport/.test(name)) {
    return 'Superficie nativa de teletransporte VR. Su material invisible es intencional.';
  }
  if (Number.isFinite(data.panoId) && Number.isFinite(data.floatY)) {
    return 'Portal panorámico nativo: conserva su destino y flotación.';
  }
  if (/^panoball\d+$/.test(name)) {
    return 'Referencia original de una esfera panorámica. Selecciona la esfera generada para mover el portal.';
  }
  if (/^xnote\d+$/.test(name)) {
    return 'Nota nativa del xilófono: conserva sonido, animación y colisiones en VR.';
  }
  if (/^xylostick/.test(name)) {
    return 'Baqueta nativa: conserva el agarre con controles VR y el clic derecho en escritorio.';
  }
  if (name === 'xylophone') return 'Xilófono nativo: conserva las notas y baquetas de su jerarquía.';
  if (name === 'paintings' || data.paintingId !== undefined) {
    return 'Pintura nativa: conserva la interacción de ampliación.';
  }
  if (name === 'graffiti') {
    return 'Muro nativo para pintar. El área de activación del aerosol acompaña su posición, rotación y escala.';
  }
  if (/^infopanel/.test(name)) return 'Panel informativo nativo: su orientación sigue al visitante durante la experiencia.';
  if (/^(newsticker|screen|hashtag|author|message)$/.test(name)) return 'Panel de noticias nativo con contenido dinámico.';
  return '';
}

export function describeNative(object) {
  for (let current = object; current; current = current.parent) {
    const description = nativeDescription(current);
    if (description) return description;
  }
  return '';
}

function hasWithin(root, object) {
  for (let current = object; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

function syncGraffitiArea(ctx, root) {
  const binding = ctx.editorGraffitiArea;
  if (!binding || !hasWithin(root, binding.wall)) return;
  const component = binding.entity.getMutableComponent(binding.componentType);
  for (let object = binding.wall; object; object = object.parent) {
    if (!object.visible) {
      component.min.set(Infinity, Infinity, Infinity);
      component.max.set(-Infinity, -Infinity, -Infinity);
      return;
    }
  }
  binding.wall.updateWorldMatrix(true, false);
  const inverse = binding.originalWorldMatrix.clone().getInverse(binding.originalWorldMatrix);
  const delta = binding.wall.matrixWorld.clone().multiply(inverse);
  // Always start from the original world box, including after undo/redo. Applying
  // deltas to an already expanded AABB would accumulate scale and rotation errors.
  const box = binding.originalBox.clone().applyMatrix4(delta);
  component.min.copy(box.min);
  component.max.copy(box.max);
}

export function prepareNativeEdit(ctx, root) {
  if (!root) return;
  if (ctx.teleport) ctx.teleport.onHoverLeave();

  // Return held native sticks before the editor captures the room hierarchy.
  const hallAsset = ctx.assets && ctx.assets.hall_model;
  const hall = hallAsset && hallAsset.scene;
  if (hall && hasWithin(root, hall)) {
    const controllers = (ctx.controllers || []).concat(ctx.desktopController || []);
    controllers.forEach(controller => {
      const stick = controller.userData && controller.userData.grabbing;
      if (!stick || !/^xylostick-(left|right)$/.test(stick.name)) return;
      hall.add(stick);
      const data = stick.userData;
      const homePosition = controller.userData.isDesktop ? data.desktopHomePosition : data.resetPosition;
      const homeRotation = controller.userData.isDesktop ? data.desktopHomeRotation : data.resetRotation;
      if (homePosition) stick.position.copy(homePosition);
      if (homeRotation) stick.rotation.copy(homeRotation);
      data.grabbedBy = null;
      data.animation = 0;
      controller.userData.grabbing = null;
      controller.userData.noteCollisions = null;
    });
  }

  root.traverse(object => {
    const data = object.userData || {};
    if (Number.isFinite(data.panoId) && Number.isFinite(data.floatY)) object.position.y = data.floatY;
    if (/^xnote\d+$/.test(object.name) && Number.isFinite(data.resetY)) {
      object.position.y = data.resetY;
      data.animation = 0;
      if (object.material) object.material.emissiveIntensity = 0;
    }
    if (/^xylostick-(left|right)$/.test(object.name) && !data.grabbedBy) {
      if (data.resetPosition) object.position.copy(data.resetPosition);
      if (data.resetRotation) object.rotation.copy(data.resetRotation);
      data.animation = 0;
    }
    if (object.isAudio && object.isPlaying) object.stop();
    if (data.sound && data.sound.children) {
      data.sound.children.forEach(sound => { if (sound.isPlaying) sound.stop(); });
    }
  });
  root.updateMatrixWorld(true);
}

export function syncNativeTransforms(ctx, root) {
  if (!root) return;
  root.traverse(object => {
    const data = object.userData || {};
    // The GLB panoball markers are distinct from the generated interactive balls.
    if (Number.isFinite(data.panoId) && Number.isFinite(data.floatY)) data.floatY = object.position.y;
    if (/^xnote\d+$/.test(object.name) && Number.isFinite(data.resetY)) {
      data.resetY = object.position.y;
      data.animation = 0;
    }
    if (/^xylostick-(left|right)$/.test(object.name) && !data.grabbedBy) {
      if (data.resetPosition) data.resetPosition.copy(object.position);
      if (data.resetRotation) data.resetRotation.copy(object.rotation);
      if (data.desktopHomePosition) data.desktopHomePosition.copy(object.position);
      if (data.desktopHomeRotation) data.desktopHomeRotation.copy(object.rotation);
      data.animation = 0;
    }
  });
  root.updateMatrixWorld(true);
  syncGraffitiArea(ctx, root);
}
