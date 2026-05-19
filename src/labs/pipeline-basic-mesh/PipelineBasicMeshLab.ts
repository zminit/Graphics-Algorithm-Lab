import { BuiltinAssets } from "../../core/assets/BuiltinAssets";
import { definePipelineLab, float, meshPass, uniform } from "../../core/pipeline";

export const PipelineBasicMeshLab = definePipelineLab({
  id: "pipeline-basic-mesh",
  name: "Pipeline Basic Mesh",
  description: "The first declarative Pipeline Lab: one mesh pass, default bindings, hand-written WGSL.",
  scene: BuiltinAssets.scenes.shadowTest,
  params: {
    ambient: float(0.2, { min: 0, max: 1, step: 0.01 }),
    lightIntensity: float(3.2, { min: 0, max: 8, step: 0.05 }),
    normalMix: float(0, { min: 0, max: 1, step: 0.01 }),
  },
  passes: [
    meshPass({
      name: "Pipeline Lit Mesh",
      shader: "/shaders/pipeline/basic-mesh.wgsl",
      bindings: [
        uniform("frame", { group: 0, binding: 0, source: "frame" }),
        uniform("params", { group: 0, binding: 1, source: "params" }),
        uniform("object", { group: 1, binding: 0, source: "object" }),
        uniform("material", { group: 1, binding: 1, source: "material" }),
      ],
      color: "screen",
      depth: "auto",
    }),
  ],
});
