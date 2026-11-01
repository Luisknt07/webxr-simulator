// Small, engine-independent projection primitives from Anatomy iso-kit.mjs.
// Upstream: https://github.com/wheresryan22/anatomy
// Revision: 1482e8469b0a9e0d8cc18ea2740a01423d29ae80
// This shared adapter does not depend on the optional authoring package.
/*! @license MIT License
Copyright (c) 2026 Ryan
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const RADIANS = Math.PI / 180;
const UNIT = Math.sqrt(1.6);
export function cameraOf({scale, azimuth = 45, elevation = 30}) {
  const a = azimuth * RADIANS, e = elevation * RADIANS;
  return {sinA: Math.sin(a), cosA: Math.cos(a), sinE: Math.sin(e), cosE: Math.cos(e), k: scale * UNIT};
}
export function iso([x, y, z], projection) {
  const {origin} = projection, {sinA, cosA, sinE, cosE, k} = cameraOf(projection);
  return [origin[0] + (x * sinA - y * cosA) * k, origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k];
}
export function depthOf([x, y, z], projection) {
  const {sinA, cosA, sinE, cosE} = cameraOf(projection);
  return (x * cosA + y * sinA) * cosE + z * sinE;
}
export default {cameraOf, iso, depthOf};
