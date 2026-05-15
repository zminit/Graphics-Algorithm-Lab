import { Camera } from "./Camera";
import { add3, clamp, scale3, sub3, type Vec3 } from "../math/Vec3";

type PointerState = {
  id: number;
  x: number;
  y: number;
  button: number;
};

export class OrbitControls {
  private pointer?: PointerState;
  private yaw = 0;
  private pitch = 0;
  private distance = 5;
  private target: Vec3 = [0, 0, 0];
  private readonly cleanupCallbacks: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
  ) {
    this.syncFromCamera();
    this.bindEvents();
  }

  dispose() {
    for (const cleanup of this.cleanupCallbacks) {
      cleanup();
    }
    this.cleanupCallbacks.length = 0;
  }

  setView(position: Vec3, target: Vec3) {
    this.camera.lookAt(position, target);
    this.syncFromCamera();
  }

  update() {
    const cosPitch = Math.cos(this.pitch);
    const offset: Vec3 = [
      this.distance * cosPitch * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch),
      this.distance * cosPitch * Math.cos(this.yaw),
    ];

    this.camera.lookAt(add3(this.target, offset), this.target);
  }

  private syncFromCamera() {
    this.target = [...this.camera.target];
    const offset = sub3(this.camera.position, this.camera.target);
    this.distance = Math.max(0.2, Math.hypot(offset[0], offset[1], offset[2]));
    this.yaw = Math.atan2(offset[0], offset[2]);
    this.pitch = Math.asin(clamp(offset[1] / this.distance, -0.98, 0.98));
  }

  private bindEvents() {
    this.addEvent(this.canvas, "pointerdown", (event) => {
      this.pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        button: event.button,
      };
      this.canvas.setPointerCapture(event.pointerId);
    });

    this.addEvent(this.canvas, "pointermove", (event) => {
      if (!this.pointer || this.pointer.id !== event.pointerId) {
        return;
      }

      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;

      if (event.shiftKey || this.pointer.button === 1) {
        this.pan(dx, dy);
      } else {
        this.yaw -= dx * 0.006;
        this.pitch = clamp(this.pitch - dy * 0.006, -1.45, 1.45);
      }
    });

    this.addEvent(this.canvas, "pointerup", (event) => {
      if (this.pointer?.id === event.pointerId) {
        this.pointer = undefined;
      }
    });

    this.addEvent(this.canvas, "pointercancel", () => {
      this.pointer = undefined;
    });

    this.addEvent(this.canvas, "wheel", (event) => {
      event.preventDefault();
      const scale = Math.exp(event.deltaY * 0.001);
      this.distance = clamp(this.distance * scale, 0.35, 80);
    });
  }

  private pan(dx: number, dy: number) {
    const forward = sub3(this.target, this.camera.position);
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)] satisfies Vec3;
    const up: Vec3 = [0, 1, 0];
    const panScale = this.distance * 0.0015;
    this.target = add3(this.target, scale3(right, -dx * panScale));
    this.target = add3(this.target, scale3(up, dy * panScale));
    this.camera.target = add3(this.camera.target, scale3(forward, 0));
  }

  private addEvent<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) {
    target.addEventListener(type, listener);
    this.cleanupCallbacks.push(() => target.removeEventListener(type, listener));
  }
}
