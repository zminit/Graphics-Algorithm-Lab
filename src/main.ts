import "./styles.css";
import { BuiltinAssets } from "./core/assets/BuiltinAssets";
import { loadScenePreset } from "./core/assets/loadScene";

type WebGPUState = {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
};

function queryRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required element is missing: ${selector}`);
  }

  return element;
}

const canvas = queryRequiredElement<HTMLCanvasElement>("#gfx-canvas");
const statusElement = queryRequiredElement<HTMLElement>("#gpu-status");

function setStatus(message: string, tone: "ready" | "error" | "loading" = "loading") {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

async function initWebGPU(target: HTMLCanvasElement): Promise<WebGPUState> {
  if (!navigator.gpu) {
    throw new Error("This browser does not support WebGPU.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No compatible GPU adapter was found.");
  }

  const device = await adapter.requestDevice();
  const context = target.getContext("webgpu");
  if (!context) {
    throw new Error("Could not create a WebGPU canvas context.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  return { adapter, device, context, format };
}

function resizeCanvasToDisplaySize(target: HTMLCanvasElement) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = target.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * pixelRatio));
  const height = Math.max(1, Math.floor(rect.height * pixelRatio));

  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }
}

function renderFrame(state: WebGPUState, timeMs: number) {
  resizeCanvasToDisplaySize(canvas);

  const t = timeMs * 0.001;
  const commandEncoder = state.device.createCommandEncoder();
  const view = state.context.getCurrentTexture().createView();

  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view,
        clearValue: {
          r: 0.04 + Math.sin(t * 0.7) * 0.015,
          g: 0.055,
          b: 0.075 + Math.cos(t * 0.5) * 0.015,
          a: 1,
        },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  renderPass.end();
  state.device.queue.submit([commandEncoder.finish()]);

  requestAnimationFrame((nextTime) => renderFrame(state, nextTime));
}

async function start() {
  try {
    const state = await initWebGPU(canvas);
    const scenePreset = await loadScenePreset(BuiltinAssets.scenes.shadowTest);
    const adapterInfo = state.adapter.info;
    const gpuName = adapterInfo?.description || "WebGPU Ready";
    setStatus(`${gpuName} · ${scenePreset.name} loaded`, "ready");
    requestAnimationFrame((time) => renderFrame(state, time));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    console.error(error);
  }
}

void start();
