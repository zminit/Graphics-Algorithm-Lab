import { BasicMeshLab } from "./basic-mesh/BasicMeshLab";
import { LabRegistry } from "../core/lab/LabRegistry";
import { ClearColorLab } from "./clear-color/ClearColorLab";
import { ShadowMappingLab } from "./shadow-mapping/ShadowMappingLab";
import { TriangleLab } from "./triangle/TriangleLab";

export function createLabRegistry() {
  const registry = new LabRegistry();

  registry.register(new ClearColorLab());
  registry.register(new TriangleLab());
  registry.register(new BasicMeshLab());
  registry.register(new ShadowMappingLab());

  return registry;
}
