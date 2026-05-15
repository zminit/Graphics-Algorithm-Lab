import { cross3, dot3, normalize3, sub3, type Vec3 } from "./Vec3";

export type Mat4 = Float32Array;

export function createMat4(): Mat4 {
  return new Float32Array(16);
}

export function identity4(): Mat4 {
  const out = createMat4();
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function perspective4(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  const out = createMat4();
  const f = 1 / Math.tan(fovYRadians * 0.5);

  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (far * near) / (near - far);

  return out;
}

export function lookAt4(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  const out = identity4();

  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -dot3(x, eye);
  out[13] = -dot3(y, eye);
  out[14] = -dot3(z, eye);

  return out;
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = createMat4();

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }

  return out;
}

export function composeTransform(position: Vec3, rotationDegrees: Vec3, scale: Vec3): Mat4 {
  const out = identity4();
  const rx = (rotationDegrees[0] * Math.PI) / 180;
  const ry = (rotationDegrees[1] * Math.PI) / 180;
  const rz = (rotationDegrees[2] * Math.PI) / 180;
  const sx = Math.sin(rx);
  const cx = Math.cos(rx);
  const sy = Math.sin(ry);
  const cy = Math.cos(ry);
  const sz = Math.sin(rz);
  const cz = Math.cos(rz);

  const m00 = cy * cz;
  const m01 = sx * sy * cz + cx * sz;
  const m02 = -cx * sy * cz + sx * sz;
  const m10 = -cy * sz;
  const m11 = -sx * sy * sz + cx * cz;
  const m12 = cx * sy * sz + sx * cz;
  const m20 = sy;
  const m21 = -sx * cy;
  const m22 = cx * cy;

  out[0] = m00 * scale[0];
  out[1] = m01 * scale[0];
  out[2] = m02 * scale[0];
  out[4] = m10 * scale[1];
  out[5] = m11 * scale[1];
  out[6] = m12 * scale[1];
  out[8] = m20 * scale[2];
  out[9] = m21 * scale[2];
  out[10] = m22 * scale[2];
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];

  return out;
}
