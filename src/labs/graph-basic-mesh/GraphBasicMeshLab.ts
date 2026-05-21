import { BuiltinAssets } from "../../core/assets/BuiltinAssets";
import { defineGraphLab, depthTexture, float, meshPass, texture2D } from "../../core/graph";

export const GraphBasicMeshLab = defineGraphLab({
  id: "graph-basic-mesh",
  name: "Graph Basic Mesh",
  description: "A Render Graph lab with one mesh pass, visible resource nodes, and hand-written WGSL.",
  scene: BuiltinAssets.scenes.shadowTest,
  params: {
    ambient: float(0.22, { min: 0, max: 1, step: 0.01 }),
    lightIntensity: float(2.6, { min: 0, max: 6, step: 0.05 }),
    normalMix: float(0, { min: 0, max: 1, step: 0.01 }),
  },
  resources: {
    mainColor: texture2D({ format: "screen", debug: true, label: "Graph Main Color" }),
    mainDepth: depthTexture({ format: "depth24plus", label: "Graph Main Depth" }),
  },
  passes: [
    meshPass({
      name: "Scene Mesh Pass",
      shader: "/shaders/graph/basic-mesh.wgsl",
      color: "mainColor",
      depth: "mainDepth",
    }),
  ],
  output: "mainColor",
});
