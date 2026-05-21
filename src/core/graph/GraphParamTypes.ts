import type { GuiParam } from "../gui/GuiSystem";

export type GraphParamValue = number | boolean | string | [number, number, number];

export type GraphParamSpec =
  | {
      type: "float";
      value: number;
      min?: number;
      max?: number;
      step?: number;
      label?: string;
    }
  | {
      type: "int";
      value: number;
      min?: number;
      max?: number;
      step?: number;
      label?: string;
    }
  | {
      type: "bool";
      value: boolean;
      label?: string;
    }
  | {
      type: "select";
      value: string;
      options: string[];
      label?: string;
    }
  | {
      type: "color";
      value: [number, number, number];
      label?: string;
    }
  | {
      type: "vec3";
      value: [number, number, number];
      min?: number;
      max?: number;
      step?: number;
      label?: string;
    };

export type GraphParamSpecs = Record<string, GraphParamSpec>;
export type GraphParamState = Record<string, GraphParamValue>;

export function float(value: number, options: Omit<Extract<GraphParamSpec, { type: "float" }>, "type" | "value"> = {}) {
  return { type: "float", value, ...options } satisfies GraphParamSpec;
}

export function int(value: number, options: Omit<Extract<GraphParamSpec, { type: "int" }>, "type" | "value"> = {}) {
  return { type: "int", value, ...options } satisfies GraphParamSpec;
}

export function bool(value: boolean, options: Omit<Extract<GraphParamSpec, { type: "bool" }>, "type" | "value"> = {}) {
  return { type: "bool", value, ...options } satisfies GraphParamSpec;
}

export function select(value: string, options: string[], config: { label?: string } = {}) {
  return { type: "select", value, options, ...config } satisfies GraphParamSpec;
}

export function color(value: [number, number, number], options: { label?: string } = {}) {
  return { type: "color", value, ...options } satisfies GraphParamSpec;
}

export function vec3(
  value: [number, number, number],
  options: Omit<Extract<GraphParamSpec, { type: "vec3" }>, "type" | "value"> = {},
) {
  return { type: "vec3", value, ...options } satisfies GraphParamSpec;
}

export function createParamState(specs: GraphParamSpecs): GraphParamState {
  const state: GraphParamState = {};
  for (const [name, spec] of Object.entries(specs)) {
    state[name] = spec.value;
  }
  return state;
}

export function toGuiParam(name: string, spec: GraphParamSpec, state: GraphParamState): GuiParam {
  const label = spec.label ?? toLabel(name);

  if (spec.type === "float" || spec.type === "int") {
    return {
      type: spec.type,
      label,
      get: () => Number(state[name] ?? spec.value),
      set: (value: number) => {
        state[name] = spec.type === "int" ? Math.round(value) : value;
      },
      min: spec.min,
      max: spec.max,
      step: spec.step ?? (spec.type === "int" ? 1 : 0.01),
    };
  }

  if (spec.type === "bool") {
    return {
      type: "bool",
      label,
      get: () => Boolean(state[name] ?? spec.value),
      set: (value: boolean) => {
        state[name] = value;
      },
    };
  }

  if (spec.type === "select") {
    return {
      type: "enum",
      label,
      get: () => String(state[name] ?? spec.value),
      set: (value: string) => {
        state[name] = value;
      },
      options: spec.options.map((option) => ({ label: option, value: option })),
    };
  }

  if (spec.type === "color") {
    return {
      type: "color",
      label,
      get: () => state[name] as [number, number, number],
      set: (value: [number, number, number]) => {
        state[name] = value;
      },
    };
  }

  return {
    type: "vec3",
    label,
    get: () => state[name] as [number, number, number],
    set: (value: [number, number, number]) => {
      state[name] = value;
    },
    min: spec.min,
    max: spec.max,
    step: spec.step,
  };
}

export function packParams(specs: GraphParamSpecs, state: GraphParamState): Float32Array {
  const packed = new Float32Array(64);
  let cursor = 0;

  for (const [name, spec] of Object.entries(specs)) {
    if (cursor >= packed.length) {
      break;
    }
    const value = state[name] ?? spec.value;
    if (typeof value === "number") {
      packed[cursor] = value;
      cursor += 4;
      continue;
    }
    if (typeof value === "boolean") {
      packed[cursor] = value ? 1 : 0;
      cursor += 4;
      continue;
    }
    if (Array.isArray(value)) {
      packed[cursor] = value[0] ?? 0;
      packed[cursor + 1] = value[1] ?? 0;
      packed[cursor + 2] = value[2] ?? 0;
      cursor += 4;
      continue;
    }
    const selectIndex = spec.type === "select" ? spec.options.indexOf(value) : -1;
    packed[cursor] = Math.max(0, selectIndex);
    cursor += 4;
  }

  return packed;
}

function toLabel(name: string) {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
