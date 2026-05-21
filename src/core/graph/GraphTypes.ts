import type { PipelineParamSpecs } from "../pipeline/PipelineParams";

export type GraphTextureSize = "canvas" | [number, number];
export type GraphResourceUsage = "render" | "sample" | "copySrc" | "copyDst";

export type GraphResourceSpec =
  | {
      kind: "texture2d";
      format: GPUTextureFormat | "screen";
      size?: GraphTextureSize;
      usage?: GraphResourceUsage[];
      debug?: boolean;
      label?: string;
      clear?: [number, number, number, number];
    }
  | {
      kind: "depthTexture";
      format?: GPUTextureFormat;
      size?: GraphTextureSize;
      usage?: GraphResourceUsage[];
      debug?: boolean;
      label?: string;
      depthClearValue?: number;
    }
  | {
      kind: "sampler";
      type?: "filtering" | "non-filtering" | "comparison";
      label?: string;
    };

export type GraphBindingSource = "frame" | "params" | "object" | "material" | string;

export type GraphBinding =
  | {
      kind: "uniform";
      name: string;
      group: number;
      binding: number;
      source: "frame" | "params" | "object" | "material";
    }
  | {
      kind: "texture";
      name: string;
      group: number;
      binding: number;
      source: string;
      sampleType?: GPUTextureSampleType;
    }
  | {
      kind: "sampler";
      name: string;
      group: number;
      binding: number;
      source: string;
      type?: GPUSamplerBindingType;
    };

export type GraphPassBase = {
  name: string;
  shader: string;
  reads?: string[];
  bindings?: GraphBinding[];
  enabled?: boolean;
};

export type GraphMeshPassSpec = GraphPassBase & {
  type: "mesh";
  color: string;
  depth?: string;
  cullMode?: GPUCullMode;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  clear?: boolean;
};

export type GraphFullscreenPassSpec = GraphPassBase & {
  type: "fullscreen";
  color: string;
  depth?: string;
  clear?: boolean;
};

export type GraphPassSpec = GraphMeshPassSpec | GraphFullscreenPassSpec;

export type GraphLabSpec = {
  id: string;
  name: string;
  description?: string;
  scene: string;
  params?: PipelineParamSpecs;
  resources: Record<string, GraphResourceSpec>;
  passes: GraphPassSpec[];
  output: string;
};

export type GraphNodeInfo = {
  id: string;
  kind: "resource" | "pass" | "output";
  title: string;
  subtitle: string;
  enabled?: boolean;
  details: Array<[string, string]>;
};

export type GraphEdgeInfo = {
  from: string;
  to: string;
  label: string;
};

export type GraphViewModel = {
  nodes: GraphNodeInfo[];
  edges: GraphEdgeInfo[];
};
