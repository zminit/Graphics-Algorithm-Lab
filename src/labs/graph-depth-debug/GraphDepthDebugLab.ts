import { BuiltinAssets } from "../../core/assets/BuiltinAssets";
import { defineGraphLab, depthTexture, float, meshPass, texture2D } from "../../core/graph";

export const GraphDepthDebugLab = defineGraphLab({
  id: "graph-depth-debug",
  name: "Graph Depth Debug",
  description: "A Render Graph lab that registers a depth32float resource for Debug View readback.",
  scene: BuiltinAssets.scenes.shadowTest,
  params: {
    ambient: float(0.16, { min: 0, max: 1, step: 0.01 }),
    lightIntensity: float(2.2, { min: 0, max: 6, step: 0.05 }),
    normalMix: float(0.35, { min: 0, max: 1, step: 0.01 }),
  },
  resources: {
    mainColor: texture2D({ format: "screen", debug: true, label: "Depth Debug Color" }),
    mainDepth: depthTexture({
      format: "depth32float",
      usage: ["render", "copySrc"],
      debug: true,
      label: "Depth Debug Map",
    }),
  },
  passes: [
    meshPass({
      name: "Depth Debug Mesh Pass",
      shader: "/shaders/graph/basic-mesh.wgsl",
      color: "mainColor",
      depth: "mainDepth",
    }),
  ],
  output: "mainColor",
});
