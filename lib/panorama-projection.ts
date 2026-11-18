/** Original equirectangular-to-perspective projection. No WebGL or scene meshes. */
export interface PanoramaPose { yaw: number; pitch: number; fov: number }
export interface PanoramaPixels { width: number; height: number; data: Uint8ClampedArray }
export const DEFAULT_PANORAMA_POSE: PanoramaPose = { yaw: 0, pitch: 0, fov: 75 };
const PI2 = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export function normalizePanoramaPose(pose: PanoramaPose): PanoramaPose {
  return {
    yaw: Number.isFinite(pose.yaw) ? ((pose.yaw + Math.PI) % PI2 + PI2) % PI2 - Math.PI : 0,
    pitch: Number.isFinite(pose.pitch) ? clamp(pose.pitch, -Math.PI * .47, Math.PI * .47) : 0,
    fov: Number.isFinite(pose.fov) ? clamp(pose.fov, 35, 110) : 75,
  };
}
export function perspectiveToEquirectangular(x: number, y: number, aspect: number, pose: PanoramaPose) {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('全景视口比例无效');
  const view = normalizePanoramaPose(pose), tangent = Math.tan(view.fov * Math.PI / 360);
  const rx = x * tangent, ry = y * tangent / aspect, length = Math.hypot(rx, ry, 1);
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const tiltedZ = cp - sp * ry;
  const wx = cy * rx + sy * tiltedZ, wy = cp * ry + sp, wz = -sy * rx + cy * tiltedZ;
  const u = .5 + Math.atan2(wx, wz) / PI2;
  return { u: ((u % 1) + 1) % 1, v: clamp(.5 - Math.asin(clamp(wy / length, -1, 1)) / Math.PI, 0, 1) };
}

/** Cache camera rays between drag frames: orientation changes never allocate a ray per pixel. */
export function createPanoramaRays(width: number, height: number, fov: number): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1400000) throw new Error('全景视口超出渲染限额');
  const tangent = Math.tan(normalizePanoramaPose({ yaw: 0, pitch: 0, fov }).fov * Math.PI / 360);
  const aspect = width / height, rays = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const ry = (1 - 2 * (y + .5) / height) * tangent / aspect;
    for (let x = 0; x < width; x++) {
      const rx = (2 * (x + .5) / width - 1) * tangent, inverseLength = 1 / Math.hypot(rx, ry, 1), index = (y * width + x) * 3;
      rays[index] = rx * inverseLength; rays[index + 1] = ry * inverseLength; rays[index + 2] = inverseLength;
    }
  }
  return rays;
}

/** Horizontal samples wrap at the 360-degree seam. Vertical samples clamp at the poles. */
export function renderPanoramaPixels(source: PanoramaPixels, rays: Float32Array, pose: PanoramaPose, bilinear = true): Uint8ClampedArray {
  const { width, height, data } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 1 || width * height > 16000000 || data.length !== width * height * 4) throw new Error('全景图片数据无效或过大');
  if (rays.length % 3 || rays.length > 1400000 * 3) throw new Error('全景投影数据无效');
  const view = normalizePanoramaPose(pose), cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const target = new Uint8ClampedArray(rays.length / 3 * 4);
  for (let index = 0, destination = 0; index < rays.length; index += 3, destination += 4) {
    const rx = rays[index], ry = rays[index + 1], rz = rays[index + 2];
    const tiltedZ = cp * rz - sp * ry;
    const wx = cy * rx + sy * tiltedZ, wy = cp * ry + sp * rz, wz = -sy * rx + cy * tiltedZ;
    const u = .5 + Math.atan2(wx, wz) / PI2, v = .5 - Math.asin(clamp(wy, -1, 1)) / Math.PI;
    if (!bilinear) {
      const x = ((Math.floor(u * width) % width) + width) % width, y = clamp(Math.floor(v * height), 0, height - 1), sourceIndex = (y * width + x) * 4;
      target[destination] = data[sourceIndex]; target[destination + 1] = data[sourceIndex + 1]; target[destination + 2] = data[sourceIndex + 2]; target[destination + 3] = data[sourceIndex + 3];
      continue;
    }
    const sx = u * width - .5, syPixel = clamp(v * height - .5, 0, height - 1), x0 = Math.floor(sx), y0 = Math.floor(syPixel);
    const left = ((x0 % width) + width) % width, right = (left + 1) % width, bottom = Math.min(y0 + 1, height - 1), fx = sx - x0, fy = syPixel - y0;
    const a = (y0 * width + left) * 4, b = (y0 * width + right) * 4, c = (bottom * width + left) * 4, d = (bottom * width + right) * 4;
    for (let channel = 0; channel < 4; channel++) {
      const top = data[a + channel] + (data[b + channel] - data[a + channel]) * fx;
      const lower = data[c + channel] + (data[d + channel] - data[c + channel]) * fx;
      target[destination + channel] = top + (lower - top) * fy;
    }
  }
  return target;
}
