import { LabRegistry } from "../core/lab/LabRegistry";
import { ShadowMappingLab } from "./shadow-mapping/ShadowMappingLab";
import { TriangleLab } from "./triangle/TriangleLab";

export function createLabRegistry() {
  const registry = new LabRegistry();

  registry.register(new TriangleLab());
  registry.register(new ShadowMappingLab());

  return registry;
}
