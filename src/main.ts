import "./styles.css";
import { BuiltinAssets } from "./core/assets/BuiltinAssets";
import { loadScenePreset } from "./core/assets/loadScene";
import { BlueprintWorkspace } from "./core/blueprint/BlueprintWorkspace";
import { LabComposer } from "./core/blueprint/LabComposer";
import { UserLabStore } from "./core/blueprint/UserLabStore";
import type { WebGPUState } from "./core/gpu/WebGPUState";
import { LabRuntime } from "./core/lab/LabRuntime";
import type { Lab } from "./core/lab/Lab";
import { RuntimeLogger } from "./core/log/RuntimeLogger";
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
const themeSelect = queryRequiredElement<HTMLSelectElement>("#theme-select");
const labTitle = queryRequiredElement<HTMLElement>("#lab-title");
const labDescription = queryRequiredElement<HTMLElement>("#lab-description");
const guiRoot = queryRequiredElement<HTMLElement>("#gui-root");
const debugRoot = queryRequiredElement<HTMLElement>("#debug-root");
const workspace = queryRequiredElement<HTMLElement>(".workspace");
const panelResizer = queryRequiredElement<HTMLElement>("#panel-resizer");
const blueprintToggle = queryRequiredElement<HTMLButtonElement>("#blueprint-toggle");
const composerToggle = queryRequiredElement<HTMLButtonElement>("#composer-toggle");
const helpToggle = queryRequiredElement<HTMLButtonElement>("#help-toggle");
const helpOverlay = queryRequiredElement<HTMLElement>("#help-overlay");
const helpClose = queryRequiredElement<HTMLButtonElement>("#help-close");
const logPanel = queryRequiredElement<HTMLElement>("#log-panel");
const logToggle = queryRequiredElement<HTMLButtonElement>("#log-toggle");
const logCount = queryRequiredElement<HTMLElement>("#log-count");
const logSummary = queryRequiredElement<HTMLElement>("#log-summary");
const logList = queryRequiredElement<HTMLElement>("#log-list");
const logBody = queryRequiredElement<HTMLElement>("#log-body");
const logClear = queryRequiredElement<HTMLButtonElement>("#log-clear");

const logger = new RuntimeLogger(logPanel, logToggle, logCount, logSummary, logList, logBody, logClear);
const themeStorageKey = "games-platform.theme";

function setStatus(message: string, tone: "ready" | "error" | "loading" = "loading") {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
  logger.add(tone === "error" ? "error" : "info", message);
}

function setupTheme() {
  const savedTheme = localStorage.getItem(themeStorageKey);
  const initialTheme = savedTheme === "light" ? "light" : "dark";
  applyTheme(initialTheme);
  themeSelect.value = initialTheme;
  themeSelect.addEventListener("change", () => {
    const nextTheme = themeSelect.value === "light" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem(themeStorageKey, nextTheme);
  });
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent("lab-theme-change", { detail: { theme } }));
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
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
  });

  return { adapter, device, context, format };
}

function setActiveLabDetails(lab: Lab) {
  labTitle.textContent = lab.name;
  labDescription.textContent = lab.description || "No description.";
}

function setupPanelResize(onResize: () => void) {
  const storageKey = "games-platform.side-panel-width";
  const minWidth = 300;
  const maxWidth = 640;
  const savedWidth = Number(localStorage.getItem(storageKey));
  let currentWidth = Number.isFinite(savedWidth) ? savedWidth : 360;

  if (Number.isFinite(savedWidth)) {
    setPanelWidth(savedWidth);
  }

  const applyFromClientX = (clientX: number) => {
    const rect = workspace.getBoundingClientRect();
    const nextWidth = rect.right - clientX;
    setPanelWidth(nextWidth);
    onResize();
  };

  panelResizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    panelResizer.setPointerCapture(event.pointerId);
    workspace.dataset.resizing = "true";
    applyFromClientX(event.clientX);
  });

  panelResizer.addEventListener("pointermove", (event) => {
    if (!panelResizer.hasPointerCapture(event.pointerId)) {
      return;
    }

    applyFromClientX(event.clientX);
  });

  panelResizer.addEventListener("pointerup", (event) => {
    if (!panelResizer.hasPointerCapture(event.pointerId)) {
      return;
    }

    panelResizer.releasePointerCapture(event.pointerId);
    workspace.dataset.resizing = "false";
    localStorage.setItem(storageKey, String(currentWidth));
  });

  panelResizer.addEventListener("pointercancel", (event) => {
    if (panelResizer.hasPointerCapture(event.pointerId)) {
      panelResizer.releasePointerCapture(event.pointerId);
    }
    workspace.dataset.resizing = "false";
  });

  panelResizer.addEventListener("keydown", (event) => {
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--side-panel-width"));
    if (event.key === "ArrowLeft") {
      setPanelWidth(current + 24);
      onResize();
      event.preventDefault();
    }
    if (event.key === "ArrowRight") {
      setPanelWidth(current - 24);
      onResize();
      event.preventDefault();
    }
  });

  function setPanelWidth(width: number) {
    const viewportMax = Math.max(minWidth, Math.min(maxWidth, window.innerWidth - 360));
    const clamped = Math.max(minWidth, Math.min(viewportMax, width));
    currentWidth = Math.round(clamped);
    document.documentElement.style.setProperty("--side-panel-width", `${currentWidth}px`);
  }
}

function setupHelpDialog() {
  let restoreFocusTo: HTMLElement | null = null;

  const openHelp = () => {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    helpOverlay.hidden = false;
    helpToggle.setAttribute("aria-expanded", "true");
    helpClose.focus();
  };

  const closeHelp = () => {
    helpOverlay.hidden = true;
    helpToggle.setAttribute("aria-expanded", "false");
    restoreFocusTo?.focus();
  };

  helpToggle.addEventListener("click", () => {
    if (helpOverlay.hidden) {
      openHelp();
    } else {
      closeHelp();
    }
  });

  helpClose.addEventListener("click", closeHelp);

  helpOverlay.addEventListener("click", (event) => {
    if (event.target === helpOverlay) {
      closeHelp();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !helpOverlay.hidden) {
      closeHelp();
    }
  });
}

async function start() {
  try {
    const state = await initWebGPU(canvas);
    const scenePreset = await loadScenePreset(BuiltinAssets.scenes.shadowTest);
    const registry = createLabRegistry();
    const userLabStore = new UserLabStore();
    const runtime = new LabRuntime({
      ...state,
      canvas,
      guiRoot,
      debugRoot,
      onStatus: setStatus,
      onLog: (level, message) => logger.add(level, message),
    });
    state.device.addEventListener("uncapturederror", (event) => {
      runtime.pauseForError(event.error.message);
      console.error(event.error);
    });
    const adapterInfo = state.adapter.info;
    const gpuName = adapterInfo?.description || "WebGPU Ready";
    const switchLab = async (labId: string) => {
      const lab = registry.get(labId);
      setActiveLabDetails(lab);
      await runtime.setLab(lab);
      setStatus(`${gpuName} · ${scenePreset.name} · ${lab.name}`, "ready");
    };

    const refreshLabSelect = async (preferredLabId?: string) => {
      const userLabs = await userLabStore.loadAll();
      const builtInIds = new Set(createLabRegistry().list().map((lab) => lab.id));
      for (const lab of registry.list()) {
        if (!builtInIds.has(lab.id)) {
          registry.unregister(lab.id);
        }
      }
      for (const lab of userLabs.labs) {
        registry.replace(lab);
      }
      labSelect.replaceChildren();
      for (const lab of registry.list()) {
        const option = document.createElement("option");
        option.value = lab.id;
        option.textContent = lab.name;
        labSelect.append(option);
      }
      if (preferredLabId && registry.list().some((lab) => lab.id === preferredLabId)) {
        labSelect.value = preferredLabId;
      }
    };

    const blueprintWorkspace = new BlueprintWorkspace({
      store: userLabStore,
      onBlueprintsChanged: async (preferredLabId = labSelect.value) => {
        await refreshLabSelect(preferredLabId);
        if (preferredLabId && labSelect.value === preferredLabId) {
          await switchLab(preferredLabId);
        }
      },
      onLog: (level, message) => logger.add(level, message),
    });
    const labComposer = new LabComposer({
      registry,
      store: userLabStore,
      onLabsChanged: refreshLabSelect,
      onRunLab: async (labId) => {
        labSelect.value = labId;
        await switchLab(labId);
      },
      onLog: (level, message) => logger.add(level, message),
    });

    blueprintToggle.addEventListener("click", () => {
      void blueprintWorkspace.open();
    });
    composerToggle.addEventListener("click", () => {
      void labComposer.open();
    });

    labSelect.addEventListener("change", () => {
      void switchLab(labSelect.value).catch((error: unknown) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        runtime.pauseForError(message);
        console.error(error);
      });
    });

    window.addEventListener("resize", () => {
      runtime.resize();
    });
    setupPanelResize(() => runtime.resize());

    await refreshLabSelect();
    const defaultLab = registry.get("triangle");
    labSelect.value = defaultLab.id;
    labSelect.disabled = false;
    await switchLab(defaultLab.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    console.error(error);
  }
}

setupHelpDialog();
setupTheme();
void start();
