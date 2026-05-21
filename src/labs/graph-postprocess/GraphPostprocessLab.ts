import { BuiltinAssets } from "../../core/assets/BuiltinAssets";
import {
  defineGraphLab,
  depthTexture,
  float,
  fullscreenPass,
  meshPass,
  sampler,
  samplerBinding,
  texture,
  texture2D,
  uniform,
} from "../../core/graph";

export const GraphPostprocessLab = defineGraphLab({
  id: "graph-postprocess",
  name: "Graph Postprocess",
  description: "A two-pass Render Graph: scene mesh pass writes a texture, fullscreen pass samples it and outputs to screen.",
  scene: BuiltinAssets.scenes.shadowTest,
  params: {
    ambient: float(0.18, { min: 0, max: 1, step: 0.01 }),
    lightIntensity: float(3.0, { min: 0, max: 6, step: 0.05 }),
    exposure: float(1.15, { min: 0.2, max: 3, step: 0.01 }),
    contrast: float(1.08, { min: 0.2, max: 2, step: 0.01 }),
    vignette: float(0.65, { min: 0, max: 2, step: 0.01 }),
  },
  resources: {
    sceneColor: texture2D({ format: "screen", debug: true, label: "Graph Scene Color" }),
    sceneDepth: depthTexture({ format: "depth24plus", label: "Graph Scene Depth" }),
    finalColor: texture2D({ format: "screen", debug: true, label: "Graph Final Color" }),
    linearSampler: sampler({ type: "filtering", label: "Linear Sampler" }),
  },
  passes: [
    meshPass({
      name: "Scene Mesh Pass",
      shader: "/shaders/graph/postprocess-scene.wgsl",
      color: "sceneColor",
      depth: "sceneDepth",
    }),
    fullscreenPass({
      name: "Tone Map Pass",
      shader: "/shaders/graph/postprocess-tonemap.wgsl",
      color: "finalColor",
      reads: ["sceneColor"],
      bindings: [
        uniform("params", { group: 0, binding: 0, source: "params" }),
        texture("sceneColor", { group: 0, binding: 1, source: "sceneColor" }),
        samplerBinding("linearSampler", { group: 0, binding: 2, source: "linearSampler" }),
      ],
    }),
  ],
  output: "finalColor",
});
