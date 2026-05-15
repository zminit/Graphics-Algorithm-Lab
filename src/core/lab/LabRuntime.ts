import { AssetSystem } from "../assets/AssetSystem";
import { Camera } from "../camera/Camera";
import { OrbitControls } from "../camera/OrbitControls";
import { GuiSystem } from "../gui/GuiSystem";
import type { WebGPUState } from "../gpu/WebGPUState";
import type { Lab, LabContext, TimeState } from "./Lab";

export type LabRuntimeOptions = WebGPUState & {
  canvas: HTMLCanvasElement;
  guiRoot: HTMLElement;
  onStatus?: (message: string, tone?: "ready" | "error" | "loading") => void;
};

export class LabRuntime {
  private activeLab?: Lab;
  private animationFrameId = 0;
  private lastTime = 0;
  private readonly camera = new Camera();
  private readonly controls: OrbitControls;
  private readonly assets = new AssetSystem();
  private readonly gui: GuiSystem;
  private readonly time: TimeState = {
    now: 0,
    deltaTime: 0,
    elapsed: 0,
    frame: 0,
  };

  constructor(private readonly options: LabRuntimeOptions) {
    this.controls = new OrbitControls(options.canvas, this.camera);
    this.gui = new GuiSystem(options.guiRoot);
    this.resizeCanvas();
  }

  async setLab(lab: Lab) {
    const ctx = this.createContext();

    this.options.onStatus?.(`Loading ${lab.name}`, "loading");
    this.activeLab?.dispose?.(ctx);
    this.gui.clear();
    this.gui.setPresetKey(`games-platform.gui.${lab.id}`);
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
    this.controls.dispose();
    this.activeLab = undefined;
  }

  resize() {
    this.resizeCanvas();
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
    this.controls.update();
    lab.update?.(ctx);
    lab.render(ctx);
  }

  private resizeCanvas() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.options.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * pixelRatio));
    const height = Math.max(1, Math.floor(rect.height * pixelRatio));

    if (this.options.canvas.width !== width || this.options.canvas.height !== height) {
      this.options.canvas.width = width;
      this.options.canvas.height = height;
    }

    this.camera.setAspect(width / height);
  }

  private createContext(): LabContext {
    return {
      adapter: this.options.adapter,
      device: this.options.device,
      context: this.options.context,
      format: this.options.format,
      canvas: this.options.canvas,
      time: this.time,
      camera: this.camera,
      assets: this.assets,
      gui: this.gui,
    };
  }
}
