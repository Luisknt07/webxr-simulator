import * as THREE from 'three';
import {System} from 'ecsy';
import {Area, AreaInside, AreaExiting, AreaEntering, Object3D, AreaChecker, BoundingBox} from '../components/index.js';

export class AreaCheckerSystem extends System {
  execute(delta, time) {
    const areas = this.queries.areas.results;
    const checkers = this.queries.checkers.results;

    for (let j = 0; j < checkers.length; j++) {
      const checker = checkers[j];
      const object = checker.getComponent(Object3D).value;
      // One controller may be inside any number of independent paint surfaces.
      // A later, nonintersecting area must not cancel an earlier intersection.
      const inside = (!checker.editorIsActive || checker.editorIsActive()) && areas.some(area => {
        if (area.editorSurface) {
          if (area.editorBehaviorType) {
            const data = area.editorSurface.userData;
            const behaviors = data.editorBehaviors || data.editorDefaultBehaviors || [];
            if (!behaviors.some(config => config.type === area.editorBehaviorType && config.enabled !== false)) return false;
          }
          let attached = false;
          for (let surface = area.editorSurface; surface; surface = surface.parent) {
            if (!surface.visible) return false;
            if (surface === area.editorScene) attached = true;
          }
          if (!attached) return false;
        }
        return object.boundingBox.intersectsBox(area.getComponent(BoundingBox));
      });
      if (inside && !checker.hasComponent(AreaInside)) checker.addComponent(AreaInside);
      else if (!inside && checker.hasComponent(AreaInside)) checker.removeComponent(AreaInside);
    }
  }
}

AreaCheckerSystem.queries = {
  areas: {
    components: [Area, BoundingBox],
  },
  checkers: {
    components: [AreaChecker, Object3D]
  }
}
