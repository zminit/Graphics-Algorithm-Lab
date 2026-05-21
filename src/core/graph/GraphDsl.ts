import type {
  GraphBinding,
  GraphFullscreenPassSpec,
  GraphMeshPassSpec,
  GraphResourceSpec,
  GraphTextureSize,
} from "./GraphTypes";

export function texture2D(options: {
  format?: GPUTextureFormat | "screen";
  size?: GraphTextureSize;
  usage?: Array<"render" | "sample" | "copySrc" | "copyDst">;
  debug?: boolean;
  label?: string;
  clear?: [number, number, number, number];
} = {}): GraphResourceSpec {
  return {
    kind: "texture2d",
    format: options.format ?? "screen",
    size: options.size ?? "canvas",
    usage: options.usage ?? ["render", "sample", "copySrc", "copyDst"],
    debug: options.debug,
    label: options.label,
    clear: options.clear,
  };
}

export function depthTexture(options: {
  format?: GPUTextureFormat;
  size?: GraphTextureSize;
  usage?: Array<"render" | "sample" | "copySrc">;
  debug?: boolean;
  label?: string;
  depthClearValue?: number;
} = {}): GraphResourceSpec {
  return {
    kind: "depthTexture",
    format: options.format ?? "depth24plus",
    size: options.size ?? "canvas",
    usage: options.usage ?? ["render"],
    debug: options.debug,
    label: options.label,
    depthClearValue: options.depthClearValue ?? 1,
  };
}

export function sampler(options: {
  type?: "filtering" | "non-filtering" | "comparison";
  label?: string;
} = {}): GraphResourceSpec {
  return {
    kind: "sampler",
    type: options.type ?? "filtering",
    label: options.label,
  };
}

export function uniform(
  name: string,
  options: { group: number; binding: number; source: "frame" | "params" | "object" | "material" },
): GraphBinding {
  return { kind: "uniform", name, ...options };
}

export function texture(
  name: string,
  options: { group: number; binding: number; source: string; sampleType?: GPUTextureSampleType },
): GraphBinding {
  return { kind: "texture", name, sampleType: "float", ...options };
}

export function samplerBinding(
  name: string,
  options: { group: number; binding: number; source: string; type?: GPUSamplerBindingType },
): GraphBinding {
  return { kind: "sampler", name, type: "filtering", ...options };
}

export function meshPass(spec: Omit<GraphMeshPassSpec, "type">): GraphMeshPassSpec {
  return {
    type: "mesh",
    reads: [],
    bindings: defaultMeshBindings(),
    cullMode: "back",
    depthWrite: true,
    depthCompare: "less",
    clear: true,
    enabled: true,
    ...spec,
  };
}

export function fullscreenPass(spec: Omit<GraphFullscreenPassSpec, "type">): GraphFullscreenPassSpec {
  return {
    type: "fullscreen",
    reads: [],
    bindings: [],
    clear: true,
    enabled: true,
    ...spec,
  };
}

export function defaultMeshBindings(): GraphBinding[] {
  return [
    uniform("frame", { group: 0, binding: 0, source: "frame" }),
    uniform("params", { group: 0, binding: 1, source: "params" }),
    uniform("object", { group: 1, binding: 0, source: "object" }),
    uniform("material", { group: 1, binding: 1, source: "material" }),
  ];
}
