import { defineGraphLab } from "../graph";
import type { Lab } from "../lab/Lab";
import {
  documentToGraphLabSpec,
  validateEditableGraphDocument,
  type EditableGraphLabDocument,
  type UserLabListEntry,
} from "./EditableGraphDocument";

export type UserLabStoreResult = {
  labs: Lab[];
  documents: EditableGraphLabDocument[];
};

export class UserLabStore {
  private saveVersion = Date.now();

  async loadAll(): Promise<UserLabStoreResult> {
    const list = await this.list();
    const documents: EditableGraphLabDocument[] = [];
    const labs: Lab[] = [];

    for (const entry of list) {
      const document = await this.load(entry.id);
      documents.push(document);
      const errors = validateEditableGraphDocument(document);
      if (!errors.length) {
        labs.push(defineGraphLab(documentToGraphLabSpec(document, entry.updatedAt || this.saveVersion)));
      }
    }

    return { labs, documents };
  }

  async list(): Promise<UserLabListEntry[]> {
    const response = await fetch("/__user_labs");
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { labs?: UserLabListEntry[] };
    return payload.labs ?? [];
  }

  async load(id: string): Promise<EditableGraphLabDocument> {
    const response = await fetch(`/__user_labs/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`Failed to load user lab: ${id}`);
    }
    return (await response.json()) as EditableGraphLabDocument;
  }

  async save(document: EditableGraphLabDocument) {
    const errors = validateEditableGraphDocument(document);
    if (errors.length) {
      throw new Error(errors.join("\n"));
    }

    this.saveVersion = Date.now();
    const labResponse = await fetch(`/__user_labs/${encodeURIComponent(document.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stripShaderCode(document), null, 2),
    });
    if (!labResponse.ok) {
      throw new Error(await readError(labResponse));
    }

    for (const shader of Object.values(document.shaders)) {
      const shaderResponse = await fetch(`/__user_labs/${encodeURIComponent(document.id)}/shaders/${encodeURIComponent(shader.path)}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: shader.code,
      });
      if (!shaderResponse.ok) {
        throw new Error(await readError(shaderResponse));
      }
    }
  }

  async hydrateShaders(document: EditableGraphLabDocument): Promise<EditableGraphLabDocument> {
    const next = structuredClone(document);
    for (const shader of Object.values(next.shaders)) {
      if (shader.code) {
        continue;
      }
      const response = await fetch(`/__user_labs/${encodeURIComponent(next.id)}/shaders/${encodeURIComponent(shader.path)}?v=${Date.now()}`);
      shader.code = response.ok ? await response.text() : "";
    }
    return next;
  }

  toLab(document: EditableGraphLabDocument): Lab {
    return defineGraphLab(documentToGraphLabSpec(document, this.saveVersion));
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
