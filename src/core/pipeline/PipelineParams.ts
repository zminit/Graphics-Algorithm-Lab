import type { GuiParam } from "../gui/GuiSystem";

export type PipelineParamValue = number | boolean | string | [number, number, number];

export type PipelineParamSpec =
  | {
      type: "float";
      label?: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      type: "int";
      label?: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      type: "bool";
      label?: string;
      value: boolean;
    }
  | {
      type: "select";
      label?: string;
      value: string;
      options: string[];
    }
  | {
      type: "color";
      label?: string;
      value: [number, number, number];
    }
  | {
      type: "vec3";
      label?: string;
      value: [number, number, number];
      min?: number;
      max?: number;
      step?: number;
    };

export type PipelineParamSpecs = Record<string, PipelineParamSpec>;
export type PipelineParamState = Record<string, PipelineParamValue>;

export function float(value: number, options: Omit<Extract<PipelineParamSpec, { type: "float" }>, "type" | "value"> = {}) {
  return { type: "float", value, ...options } satisfies PipelineParamSpec;
}

export function int(value: number, options: Omit<Extract<PipelineParamSpec, { type: "int" }>, "type" | "value"> = {}) {
  return { type: "int", value, ...options } satisfies PipelineParamSpec;
}

export function bool(value: boolean, options: Omit<Extract<PipelineParamSpec, { type: "bool" }>, "type" | "value"> = {}) {
  return { type: "bool", value, ...options } satisfies PipelineParamSpec;
}

export function select(value: string, options: string[], config: { label?: string } = {}) {
  return { type: "select", value, options, ...config } satisfies PipelineParamSpec;
}

export function color(value: [number, number, number], options: { label?: string } = {}) {
  return { type: "color", value, ...options } satisfies PipelineParamSpec;
}

export function vec3(
  value: [number, number, number],
  options: Omit<Extract<PipelineParamSpec, { type: "vec3" }>, "type" | "value"> = {},
) {
  return { type: "vec3", value, ...options } satisfies PipelineParamSpec;
}

export function createParamState(specs: PipelineParamSpecs): PipelineParamState {
  const state: PipelineParamState = {};
  for (const [name, spec] of Object.entries(specs)) {
    state[name] = Array.isArray(spec.value) ? [...spec.value] : spec.value;
  }
  return state;
}

export function toGuiParam(name: string, spec: PipelineParamSpec, state: PipelineParamState): GuiParam {
  const label = spec.label ?? toLabel(name);

  if (spec.type === "float") {
    return {
      type: "float",
      label,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      get: () => state[name] as number,
      set: (value) => {
        state[name] = value;
      },
    };
  }

  if (spec.type === "int") {
    return {
      type: "int",
      label,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      get: () => state[name] as number,
      set: (value) => {
        state[name] = value;
      },
    };
  }

  if (spec.type === "bool") {
    return {
      type: "bool",
      label,
      get: () => state[name] as boolean,
      set: (value) => {
        state[name] = value;
      },
    };
  }

  if (spec.type === "select") {
    return {
      type: "enum",
      label,
      options: spec.options.map((option) => ({ label: option, value: option })),
      get: () => state[name] as string,
      set: (value) => {
        state[name] = value;
      },
    };
  }

  if (spec.type === "color") {
    return {
      type: "color",
      label,
      get: () => state[name] as [number, number, number],
      set: (value) => {
        state[name] = value;
      },
    };
  }

  return {
    type: "vec3",
    label,
    min: spec.min,
    max: spec.max,
    step: spec.step,
    get: () => state[name] as [number, number, number],
    set: (value) => {
      state[name] = value;
    },
  };
}

export function packParams(specs: PipelineParamSpecs, state: PipelineParamState): Float32Array {
  const values = new Float32Array(64);
  let offset = 0;

  for (const name of Object.keys(specs)) {
    const value = state[name];
    if (Array.isArray(value)) {
      values.set(value, offset);
      offset += 4;
    } else {
      values[offset] = typeof value === "boolean" ? (value ? 1 : 0) : typeof value === "string" ? 0 : value;
      offset += 4;
    }
  }

  return values;
}

function toLabel(name: string) {
  return name.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}
