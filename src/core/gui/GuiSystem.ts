type BaseParam<T> = {
  label: string;
  get: () => T;
  set: (value: T) => void;
  onChange?: (value: T) => void;
};

export type FloatParam = BaseParam<number> & {
  type: "float";
  min?: number;
  max?: number;
  step?: number;
};

export type IntParam = BaseParam<number> & {
  type: "int";
  min?: number;
  max?: number;
  step?: number;
};

export type BoolParam = BaseParam<boolean> & {
  type: "bool";
};

export type EnumParam = BaseParam<string> & {
  type: "enum";
  options: Array<{ label: string; value: string }>;
};

export type ColorParam = BaseParam<[number, number, number]> & {
  type: "color";
};

export type Vec3Param = BaseParam<[number, number, number]> & {
  type: "vec3";
  min?: number;
  max?: number;
  step?: number;
};

export type GuiParam = FloatParam | IntParam | BoolParam | EnumParam | ColorParam | Vec3Param;

type ParamRecord = {
  param: GuiParam;
  initialValue: unknown;
};

export class GuiSystem {
  private readonly params = new Map<string, ParamRecord>();
  private readonly mounts: HTMLElement[] = [];
  private presetKey = "games-platform.gui.default";

  constructor(private readonly root: HTMLElement) {}

  clear() {
    this.params.clear();
    this.mounts.length = 0;
    this.root.replaceChildren();
  }

  setPresetKey(key: string) {
    this.presetKey = key;
  }

  add(id: string, param: GuiParam) {
    if (this.params.has(id)) {
      throw new Error(`GUI parameter already exists: ${id}`);
    }

    this.params.set(id, {
      param,
      initialValue: cloneValue(param.get()),
    });
    this.render();
  }

  mount(element: HTMLElement) {
    this.mounts.push(element);
    this.render();
  }

  reset() {
    for (const { param, initialValue } of this.params.values()) {
      this.assignGuiParam(param, cloneValue(initialValue));
    }
    this.render();
  }

  savePreset(storageKey: string) {
    const values: Record<string, unknown> = {};
    for (const [id, { param }] of this.params) {
      values[id] = param.get();
    }
    localStorage.setItem(storageKey, JSON.stringify(values));
  }

  loadPreset(storageKey: string) {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return;
    }

    const values = JSON.parse(raw) as Record<string, unknown>;
    for (const [id, value] of Object.entries(values)) {
      const record = this.params.get(id);
      if (record) {
        this.assignGuiParam(record.param, value);
      }
    }
    this.render();
  }

  private render() {
    const fragment = document.createDocumentFragment();
    const header = document.createElement("div");
    header.className = "gui-header";
    header.innerHTML = "<p class=\"panel-label\">Parameters</p>";

    const actions = document.createElement("div");
    actions.className = "gui-actions";
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset";
    resetButton.addEventListener("click", () => this.reset());
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", () => this.savePreset(this.presetKey));
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => this.loadPreset(this.presetKey));
    actions.append(resetButton, saveButton, loadButton);
    header.append(actions);
    fragment.append(header);

    if (this.params.size === 0) {
      const empty = document.createElement("p");
      empty.className = "gui-empty";
      empty.textContent = "No parameters registered.";
      fragment.append(empty);
    }

    for (const [id, { param }] of this.params) {
      fragment.append(this.createControl(id, param));
    }

    for (const mount of this.mounts) {
      fragment.append(mount);
    }

    this.root.replaceChildren(fragment);
  }

  private createControl(id: string, param: GuiParam): HTMLElement {
    if (param.type === "bool") {
      return this.createBoolControl(id, param);
    }
    if (param.type === "enum") {
      return this.createEnumControl(id, param);
    }
    if (param.type === "color") {
      return this.createColorControl(id, param);
    }
    if (param.type === "vec3") {
      return this.createVec3Control(id, param);
    }
    return this.createNumberControl(id, param);
  }

  private createNumberControl(id: string, param: FloatParam | IntParam): HTMLElement {
    const row = createRow(id, param.label);
    const input = document.createElement("input");
    const value = document.createElement("span");
    input.type = "range";
    input.min = String(param.min ?? 0);
    input.max = String(param.max ?? 1);
    input.step = String(param.step ?? (param.type === "int" ? 1 : 0.01));
    input.value = String(param.get());
    value.className = "gui-value";
    value.textContent = formatNumber(param.get());
    input.addEventListener("input", () => {
      const next = param.type === "int" ? Math.round(input.valueAsNumber) : input.valueAsNumber;
      this.assign(param, next);
      value.textContent = formatNumber(param.get());
    });
    row.control.append(input, value);
    return row.element;
  }

  private createBoolControl(id: string, param: BoolParam): HTMLElement {
    const row = createRow(id, param.label);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = param.get();
    input.addEventListener("change", () => this.assign(param, input.checked));
    row.control.append(input);
    return row.element;
  }

  private createEnumControl(id: string, param: EnumParam): HTMLElement {
    const row = createRow(id, param.label);
    const select = document.createElement("select");
    for (const option of param.options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = param.get();
    select.addEventListener("change", () => this.assign(param, select.value));
    row.control.append(select);
    return row.element;
  }

  private createColorControl(id: string, param: ColorParam): HTMLElement {
    const row = createRow(id, param.label);
    const input = document.createElement("input");
    input.type = "color";
    input.value = rgbToHex(param.get());
    input.addEventListener("input", () => this.assign(param, hexToRgb(input.value)));
    row.control.append(input);
    return row.element;
  }

  private createVec3Control(id: string, param: Vec3Param): HTMLElement {
    const row = createRow(id, param.label);
    const values = param.get();
    for (let axis = 0; axis < 3; axis += 1) {
      const input = document.createElement("input");
      input.type = "number";
      input.min = param.min === undefined ? "" : String(param.min);
      input.max = param.max === undefined ? "" : String(param.max);
      input.step = String(param.step ?? 0.1);
      input.value = String(values[axis]);
      input.ariaLabel = `${param.label} ${["x", "y", "z"][axis]}`;
      input.addEventListener("change", () => {
        const next = [...param.get()] as [number, number, number];
        next[axis] = input.valueAsNumber;
        this.assign(param, next);
      });
      row.control.append(input);
    }
    row.element.classList.add("gui-row-vec3");
    return row.element;
  }

  private assign<T>(param: BaseParam<T>, value: T) {
    const typedValue = value as T;
    param.set(typedValue);
    param.onChange?.(typedValue);
  }

  private assignGuiParam(param: GuiParam, value: unknown) {
    if (param.type === "bool") {
      this.assign(param, Boolean(value));
      return;
    }

    if (param.type === "enum") {
      this.assign(param, String(value));
      return;
    }

    if (param.type === "color" || param.type === "vec3") {
      if (Array.isArray(value) && value.length === 3) {
        this.assign(param, [Number(value[0]), Number(value[1]), Number(value[2])]);
      }
      return;
    }

    this.assign(param, Number(value));
  }
}

function createRow(id: string, labelText: string) {
  const element = document.createElement("label");
  const label = document.createElement("span");
  const control = document.createElement("div");
  element.className = "gui-row";
  element.htmlFor = `gui-${id}`;
  label.textContent = labelText;
  control.className = "gui-control";
  element.append(label, control);
  return { element, control };
}

function cloneValue(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function rgbToHex(color: [number, number, number]): string {
  const [r, g, b] = color.map((component) => Math.round(Math.max(0, Math.min(1, component)) * 255));
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}
