import {MeshoptEncoder} from 'meshoptimizer/meshopt_encoder.js';
import {optimizeIndexRanges} from '../src/MeshIndexOptimizer.js';

self.onmessage = async event => {
  const job = event.data;
  try {
    if (!MeshoptEncoder.supported) throw new Error('Mesh optimization is unavailable.');
    await MeshoptEncoder.ready;
    const result = optimizeIndexRanges(MeshoptEncoder, job.indices, job.ranges, job.vertexCount);
    self.postMessage(Object.assign({id: job.id}, result), [result.indices.buffer]);
  } catch (error) {
    self.postMessage({id: job.id, error: error.message || 'Mesh optimization failed.'});
  }
};
