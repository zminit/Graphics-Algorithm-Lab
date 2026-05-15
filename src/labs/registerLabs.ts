import { LabRegistry } from "../core/lab/LabRegistry";
import { ClearColorLab } from "./clear-color/ClearColorLab";
import { TriangleLab } from "./triangle/TriangleLab";

export function createLabRegistry() {
  const registry = new LabRegistry();

  registry.register(new ClearColorLab());
  registry.register(new TriangleLab());

  return registry;
}
