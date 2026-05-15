import type { AssetSystem } from "../assets/AssetSystem";
import type { Camera } from "../camera/Camera";
import type { DebugSystem } from "../debug/DebugSystem";
import type { GuiSystem } from "../gui/GuiSystem";
import type { WebGPUState } from "../gpu/WebGPUState";

export type LabCategory = "template" | "rendering" | "debug";

export type TimeState = {
  now: number;
  deltaTime: number;
  elapsed: number;
  frame: number;
};

export type LabContext = WebGPUState & {
  canvas: HTMLCanvasElement;
  time: TimeState;
  camera: Camera;
  assets: AssetSystem;
  gui: GuiSystem;
  debug: DebugSystem;
};

export type Lab = {
  id: string;
  name: string;
  category: LabCategory;
  description?: string;
  setup?(ctx: LabContext): Promise<void> | void;
  update?(ctx: LabContext): void;
  render(ctx: LabContext): void;
  resize?(ctx: LabContext): void;
  dispose?(ctx: LabContext): void;
};
