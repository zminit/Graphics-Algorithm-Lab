import { defineGraphLab } from "../graph";
import type { Lab } from "../lab/Lab";
import {
  documentToGraphLabSpec,
  validateEditableExperimentDocument,
  validateEditableGraphDocument,
  type EditableExperimentDocument,
  type EditableGraphLabDocument,
  type UserLabCollection,
  type UserLabListEntry,
} from "./EditableGraphDocument";

export type UserLabStoreResult = {
  labs: Lab[];
  documents: EditableGraphLabDocument[];
  experiments: EditableExperimentDocument[];
};

export class UserLabStore {
  private saveVersion = Date.now();

  async loadAll(): Promise<UserLabStoreResult> {
    const [blueprints, experiments] = await Promise.all([
      this.listBlueprints(),
      this.listExperiments(),
    ]);
    const documents: EditableGraphLabDocument[] = [];
    const hydratedBlueprints = new Map<string, EditableGraphLabDocument>();
    const loadedExperiments: EditableExperimentDocument[] = [];
    const labs: Lab[] = [];

    for (const entry of blueprints) {
      const document = await this.loadBlueprint(entry.id);
      documents.push(document);
      hydratedBlueprints.set(document.id, document);
    }

    for (const entry of experiments) {
      const experiment = await this.loadExperiment(entry.id);
      loadedExperiments.push(experiment);
      const blueprint = hydratedBlueprints.get(experiment.blueprintId);
      if (blueprint && !validateEditableGraphDocument(blueprint).length) {
        labs.push(
          defineGraphLab(documentToGraphLabSpec(blueprint, entry.updatedAt || this.saveVersion, experiment)),
        );
      }
    }

    return { labs, documents, experiments: loadedExperiments };
  }

  async list(): Promise<UserLabListEntry[]> {
    return this.listBlueprints();
  }

  async listBlueprints(): Promise<UserLabListEntry[]> {
    const payload = await this.listCollection();
    return payload.blueprints ?? [];
  }

  async listExperiments(): Promise<UserLabListEntry[]> {
    const payload = await this.listCollection();
    return payload.experiments ?? [];
  }

  async load(id: string): Promise<EditableGraphLabDocument> {
    return this.loadBlueprint(id);
  }

  async loadBlueprint(id: string): Promise<EditableGraphLabDocument> {
    const response = await fetch(`/__user_labs/blueprints/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`Failed to load blueprint: ${id}`);
    }
    return (await response.json()) as EditableGraphLabDocument;
  }

  async loadExperiment(id: string): Promise<EditableExperimentDocument> {
    const response = await fetch(`/__user_labs/experiments/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`Failed to load experiment: ${id}`);
    }
    return (await response.json()) as EditableExperimentDocument;
  }

  async save(document: EditableGraphLabDocument) {
    await this.saveBlueprint(document);
  }

  async saveBlueprint(document: EditableGraphLabDocument) {
    document.schema = "games-platform.editable-blueprint";
    const errors = validateEditableGraphDocument(document);
    if (errors.length) {
      throw new Error(errors.join("\n"));
    }

    this.saveVersion = Date.now();
    const blueprintResponse = await fetch(`/__user_labs/blueprints/${encodeURIComponent(document.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stripShaderCode({ ...document, schema: "games-platform.editable-blueprint" }), null, 2),
    });
    if (!blueprintResponse.ok) {
      throw new Error(await readError(blueprintResponse));
    }

    for (const shader of Object.values(document.shaders)) {
      const shaderResponse = await fetch(
        `/__user_labs/blueprints/${encodeURIComponent(document.id)}/shaders/${encodeURIComponent(shader.path)}`,
        {
          method: "PUT",
          headers: { "content-type": "text/plain" },
          body: shader.code,
        },
      );
      if (!shaderResponse.ok) {
        throw new Error(await readError(shaderResponse));
      }
    }
  }

  async saveExperiment(
    experiment: EditableExperimentDocument,
    blueprintIds: string[],
    sceneMeshIds: string[],
  ) {
    const errors = validateEditableExperimentDocument(experiment, blueprintIds, sceneMeshIds);
    if (errors.length) {
      throw new Error(errors.join("\n"));
    }

    this.saveVersion = Date.now();
    const response = await fetch(`/__user_labs/experiments/${encodeURIComponent(experiment.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(experiment, null, 2),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
  }

  async hydrateShaders(document: EditableGraphLabDocument): Promise<EditableGraphLabDocument> {
    const next = structuredClone(document);
    for (const shader of Object.values(next.shaders)) {
      if (shader.code) {
        continue;
      }
      const base = `/__user_labs/blueprints/${encodeURIComponent(next.id)}`;
      const response = await fetch(`${base}/shaders/${encodeURIComponent(shader.path)}?v=${Date.now()}`);
      shader.code = response.ok ? await response.text() : "";
    }
    return next;
  }

  toLab(document: EditableGraphLabDocument, experiment?: EditableExperimentDocument): Lab {
    return defineGraphLab(documentToGraphLabSpec(document, this.saveVersion, experiment));
  }

  private async listCollection(): Promise<UserLabCollection> {
    const response = await fetch("/__user_labs");
    if (!response.ok) {
      return {};
    }
    return (await response.json()) as UserLabCollection;
  }
}

function stripShaderCode(document: EditableGraphLabDocument): EditableGraphLabDocument {
  const clone = structuredClone(document);
  for (const shader of Object.values(clone.shaders)) {
    shader.code = "";
  }
  return clone;
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
