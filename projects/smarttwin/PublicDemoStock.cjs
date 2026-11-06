'use strict';

/** Register authored rack stock in native warehouse custody. Placement must
 * already match a real free slot; this never teleports an unsupported load. */
function seedPublicDemoStock(THREE, simulation) {
  let count = 0;
  for (const product of simulation.products.values()) {
    const config = product.record && product.record.components.product && product.record.components.product.config;
    const source = config && simulation.records.get(config.sourceId);
    if (!source || !source.components.palletQueue || !source.components.palletQueue.rack) continue;
    const api = simulation.palletQueueRuntime;
    product.object.updateWorldMatrix(true, true);
    const center = product.bounds.clone().applyMatrix4(product.object.matrixWorld).getCenter(new THREE.Vector3());
    const placement = api.placement(source, product, [], center);
    const desiredRotation = new THREE.Quaternion();
    if (placement) placement.matrix.decompose(new THREE.Vector3(), desiredRotation, new THREE.Vector3());
    if (!placement || product.object.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3().setFromMatrixPosition(placement.matrix)) > .04 || product.object.getWorldQuaternion(new THREE.Quaternion()).angleTo(desiredRotation) > .04) {
      throw new Error('El pallet inicial no está apoyado en una ubicación libre de la estantería.');
    }
    const entry = simulation.sourceRuntime.entryForProduct(source, product);
    if (!api.receive(source, entry, true, placement)) throw new Error('No se pudo registrar el pallet de reserva en la estantería.');
    count++;
  }
  return count;
}

module.exports = seedPublicDemoStock;
