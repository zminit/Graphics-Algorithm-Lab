import type { WebGPUState } from "../gpu/WebGPUState";
import type { Lab, LabContext, TimeState } from "./Lab";

export type LabRuntimeOptions = WebGPUState & {
  canvas: HTMLCanvasElement;
  onStatus?: (message: string, tone?: "ready" | "error" | "loading") => void;
};

export class LabRuntime {
  private activeLab?: Lab;
  private animationFrameId = 0;
  private lastTime = 0;
  private readonly time: TimeState = {
    now: 0,
    deltaTime: 0,
    elapsed: 0,
    frame: 0,
  };

  constructor(private readonly options: LabRuntimeOptions) {}

  async setLab(lab: Lab) {
    const ctx = this.createContext();

    this.options.onStatus?.(`Loading ${lab.name}`, "loading");
    this.activeLab?.dispose?.(ctx);
    this.activeLab = lab;
    this.time.now = 0;
    this.time.deltaTime = 0;
    this.time.elapsed = 0;
    this.time.frame = 0;
    this.lastTime = 0;

    await lab.setup?.(ctx);
    lab.resize?.(ctx);
    this.options.onStatus?.(`${lab.name} ready`, "ready");
  }

  start() {
    if (this.animationFrameId) {
      return;
    }

    const frame = (now: number) => {
      this.animationFrameId = requestAnimationFrame(frame);
      this.tick(now);
    };

    this.animationFrameId = requestAnimationFrame(frame);
  }

  stop() {
    if (!this.animationFrameId) {
      return;
    }

    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = 0;
  }

  dispose() {
    this.stop();
    this.activeLab?.dispose?.(this.createContext());
    this.activeLab = undefined;
  }

  resize() {
    this.activeLab?.resize?.(this.createContext());
  }

  private tick(now: number) {
    const lab = this.activeLab;
    if (!lab) {
      return;
    }

    this.time.deltaTime = this.lastTime > 0 ? (now - this.lastTime) * 0.001 : 0;
    this.time.now = now * 0.001;
    this.time.elapsed += this.time.deltaTime;
    this.time.frame += 1;
    this.lastTime = now;

    const ctx = this.createContext();
    lab.update?.(ctx);
    lab.render(ctx);
  }

  private createContext(): LabContext {
    return {
      adapter: this.options.adapter,
      device: this.options.device,
      context: this.options.context,
      format: this.options.format,
      canvas: this.options.canvas,
      time: this.time,
    };
  }
}
