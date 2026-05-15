import "./styles.css";
import { BuiltinAssets } from "./core/assets/BuiltinAssets";
import { loadScenePreset } from "./core/assets/loadScene";
import type { WebGPUState } from "./core/gpu/WebGPUState";
import { LabRuntime } from "./core/lab/LabRuntime";
import type { Lab } from "./core/lab/Lab";
import { createLabRegistry } from "./labs/registerLabs";

function queryRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required element is missing: ${selector}`);
  }

  return element;
}

const canvas = queryRequiredElement<HTMLCanvasElement>("#gfx-canvas");
const statusElement = queryRequiredElement<HTMLElement>("#gpu-status");
const labSelect = queryRequiredElement<HTMLSelectElement>("#lab-select");
const labTitle = queryRequiredElement<HTMLElement>("#lab-title");
const labDescription = queryRequiredElement<HTMLElement>("#lab-description");

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

function resizeCanvas() {
  resizeCanvasToDisplaySize(canvas);
}

function setActiveLabDetails(lab: Lab) {
  labTitle.textContent = lab.name;
  labDescription.textContent = lab.description || "No description.";
}

async function start() {
  try {
    const state = await initWebGPU(canvas);
    const scenePreset = await loadScenePreset(BuiltinAssets.scenes.shadowTest);
    const registry = createLabRegistry();
    const runtime = new LabRuntime({
      ...state,
      canvas,
      onStatus: setStatus,
    });
    const adapterInfo = state.adapter.info;
    const gpuName = adapterInfo?.description || "WebGPU Ready";
    const labs = registry.list();

    for (const lab of labs) {
      const option = document.createElement("option");
      option.value = lab.id;
      option.textContent = lab.name;
      labSelect.append(option);
    }

    const switchLab = async (labId: string) => {
      const lab = registry.get(labId);
      setActiveLabDetails(lab);
      await runtime.setLab(lab);
      setStatus(`${gpuName} · ${scenePreset.name} · ${lab.name}`, "ready");
    };

    labSelect.addEventListener("change", () => {
      void switchLab(labSelect.value).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message, "error");
        console.error(error);
      });
    });

    window.addEventListener("resize", () => {
      resizeCanvas();
      runtime.resize();
    });

    resizeCanvas();
    const defaultLab = registry.getDefault();
    labSelect.value = defaultLab.id;
    labSelect.disabled = false;
    await switchLab(defaultLab.id);
    runtime.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    console.error(error);
  }
}

void start();
