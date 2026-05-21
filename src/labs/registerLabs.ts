import { BasicMeshLab } from "./basic-mesh/BasicMeshLab";
import { LabRegistry } from "../core/lab/LabRegistry";
import { ClearColorLab } from "./clear-color/ClearColorLab";
import { GraphBasicMeshLab } from "./graph-basic-mesh/GraphBasicMeshLab";
import { GraphDepthDebugLab } from "./graph-depth-debug/GraphDepthDebugLab";
import { GraphPostprocessLab } from "./graph-postprocess/GraphPostprocessLab";
import { PipelineBasicMeshLab } from "./pipeline-basic-mesh/PipelineBasicMeshLab";
import { ShadowMappingLab } from "./shadow-mapping/ShadowMappingLab";
import { TriangleLab } from "./triangle/TriangleLab";

export function createLabRegistry() {
  const registry = new LabRegistry();

  registry.register(new ClearColorLab());
  registry.register(new TriangleLab());
  registry.register(new BasicMeshLab());
  registry.register(PipelineBasicMeshLab);
  registry.register(GraphBasicMeshLab);
  registry.register(GraphPostprocessLab);
  registry.register(GraphDepthDebugLab);
  registry.register(new ShadowMappingLab());

  return registry;
}
