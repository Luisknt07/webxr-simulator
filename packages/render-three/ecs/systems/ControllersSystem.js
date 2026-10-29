import * as THREE from 'three';
import {System} from 'ecsy';
import {Area, AreaReactor, AreaInside, AreaExiting, AreaEntering, Object3D, AreaChecker, BoundingBox} from '../components/index.js';

export class ControllersSystem extends System {
  execute(delta, time) {
    const added = this.queries.checkers.added;
    const removed = this.queries.checkers.removed;

    for (let i = 0; i < added.length; i++) {
      const entity = added[i];
      const reactor = entity.getComponent(AreaReactor);
      reactor.onEntering(entity);
    }

    for (let i = 0; i < removed.length; i++) {
      const entity = removed[i];
      // Disconnect removes the checker entity before ECS processes its query.
      // ECSY retains removed components until cleanup, so retrieve that reactor
      // explicitly and let its captured controller restore native visuals.
      const reactor = entity.getComponent(AreaReactor, true);
      if (reactor && reactor.onExiting) reactor.onExiting(entity);
    }
  }
}

ControllersSystem.queries = {
  checkers: {
    components: [AreaChecker, Object3D, AreaInside],
    listen: {
      added: true,
      removed: true
    }
  }
}
