import type { Lab } from "./Lab";

export class LabRegistry {
  private readonly labs = new Map<string, Lab>();

  register(lab: Lab) {
    if (this.labs.has(lab.id)) {
      throw new Error(`Lab is already registered: ${lab.id}`);
    }

    this.labs.set(lab.id, lab);
  }

  get(id: string): Lab {
    const lab = this.labs.get(id);

    if (!lab) {
      throw new Error(`Unknown lab: ${id}`);
    }

    return lab;
  }

  getDefault(): Lab {
    const firstLab = this.list()[0];

    if (!firstLab) {
      throw new Error("No labs registered.");
    }

    return firstLab;
  }

  list(): Lab[] {
    return [...this.labs.values()];
  }
}
