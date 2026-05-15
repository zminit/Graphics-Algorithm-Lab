import { lookAt4, multiply4, perspective4, type Mat4 } from "../math/Mat4";
import type { Vec3 } from "../math/Vec3";

export class Camera {
  position: Vec3 = [0, 1, 4];
  target: Vec3 = [0, 0, 0];
  up: Vec3 = [0, 1, 0];
  fovYDegrees = 45;
  near = 0.1;
  far = 100;
  aspect = 1;

  viewMatrix: Mat4 = lookAt4(this.position, this.target, this.up);
  projectionMatrix: Mat4 = perspective4(this.fovYRadians, this.aspect, this.near, this.far);
  viewProjectionMatrix: Mat4 = multiply4(this.projectionMatrix, this.viewMatrix);

  get fovYRadians() {
    return (this.fovYDegrees * Math.PI) / 180;
  }

  setPerspective(fovYDegrees: number, near: number, far: number) {
    this.fovYDegrees = fovYDegrees;
    this.near = near;
    this.far = far;
    this.updateMatrices();
  }

  lookAt(position: Vec3, target: Vec3) {
    this.position = [...position];
    this.target = [...target];
    this.updateMatrices();
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.updateMatrices();
  }

  updateMatrices() {
    this.viewMatrix = lookAt4(this.position, this.target, this.up);
    this.projectionMatrix = perspective4(this.fovYRadians, this.aspect, this.near, this.far);
    this.viewProjectionMatrix = multiply4(this.projectionMatrix, this.viewMatrix);
  }
}
