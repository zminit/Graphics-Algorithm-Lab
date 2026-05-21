import { BuiltinAssets } from "../assets/BuiltinAssets";
import { loadScenePreset } from "../assets/loadScene";
import type { ScenePreset } from "../assets/ScenePreset";
import type { GraphMaterialInstance } from "../graph";
import type { LabRegistry } from "../lab/LabRegistry";
import {
  createDefaultExperimentDocument,
  createDefaultGraphDocument,
  type EditableExperimentDocument,
  type EditableGraphLabDocument,
} from "./EditableGraphDocument";
import { UserLabStore } from "./UserLabStore";

export type LabComposerOptions = {
  registry: LabRegistry;
  store: UserLabStore;
  onLabsChanged: (preferredLabId?: string) => Promise<void> | void;
  onRunLab: (labId: string) => Promise<void> | void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
};

const scenes = [
  { id: "shadow-test", name: "Shadow Test", path: BuiltinAssets.scenes.shadowTest },
  { id: "pbr-test", name: "PBR Test", path: BuiltinAssets.scenes.pbrTest },
  { id: "postprocess-test", name: "Postprocess Test", path: BuiltinAssets.scenes.postprocessTest },
  { id: "raytracing-cornell", name: "Cornell Box", path: BuiltinAssets.scenes.raytracingCornell },
];

const textureOptions = [
  { label: "White", value: BuiltinAssets.textures.white },
  { label: "Gray", value: BuiltinAssets.textures.gray },
  { label: "Checkerboard", value: BuiltinAssets.textures.checkerboard },
  { label: "UV Grid", value: BuiltinAssets.textures.uvGrid },
  { label: "Flat Normal", value: BuiltinAssets.textures.flatNormal },
  { label: "Blue Noise", value: BuiltinAssets.textures.blueNoise },
];

export class LabComposer {
  private readonly overlay: HTMLElement;
  private readonly sceneSelect: HTMLSelectElement;
  private readonly blueprintSelect: HTMLSelectElement;
  private readonly experimentSelect: HTMLSelectElement;
  private readonly nameInput: HTMLInputElement;
  private readonly materialList: HTMLElement;
  private readonly objectList: HTMLElement;
  private readonly status: HTMLElement;
  private scene?: ScenePreset;
  private blueprints: EditableGraphLabDocument[] = [];
  private experiment: EditableExperimentDocument = createDefaultExperimentDocument(
    "my-experiment",
    "my-graph-lab",
    BuiltinAssets.scenes.shadowTest,
    [],
  );

  constructor(private readonly options: LabComposerOptions) {
    this.overlay = document.createElement("div");
    this.overlay.className = "composer-overlay";
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <section class="composer-window" role="dialog" aria-modal="true" aria-label="Lab Composer">
        <header class="composer-toolbar">
          <strong>Lab Composer</strong>
          <select class="composer-experiment-select" aria-label="Experiment"></select>
          <button type="button" data-action="new">New</button>
          <button type="button" data-action="save">Save</button>
          <button type="button" data-action="run">Run</button>
          <button type="button" data-action="close">Close</button>
        </header>
        <div class="composer-body">
          <aside class="composer-panel">
            <p class="panel-label">Experiment</p>
            <label><span>Name</span><input class="composer-name" type="text" /></label>
            <label><span>Scene</span><select class="composer-scene-select"></select></label>
            <label><span>Blueprint</span><select class="composer-blueprint-select"></select></label>
            <p class="composer-status">Ready.</p>
          </aside>
          <section class="composer-panel">
            <div class="composer-panel-header">
              <p class="panel-label">Material Instances</p>
              <button type="button" data-action="add-material">Add</button>
            </div>
            <div class="composer-materials"></div>
          </section>
          <section class="composer-panel">
            <p class="panel-label">Scene Objects</p>
            <div class="composer-objects"></div>
          </section>
        </div>
      </section>
    `;
    document.body.append(this.overlay);
    this.sceneSelect = this.query(".composer-scene-select");
    this.blueprintSelect = this.query(".composer-blueprint-select");
    this.experimentSelect = this.query(".composer-experiment-select");
    this.nameInput = this.query(".composer-name");
    this.materialList = this.query(".composer-materials");
    this.objectList = this.query(".composer-objects");
    this.status = this.query(".composer-status");
    this.bindEvents();
    this.populateSceneSelect();
  }

  async open() {
    this.overlay.hidden = false;
    await this.refresh();
  }

  private bindEvents() {
    this.overlay.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (action === "close") this.overlay.hidden = true;
      if (action === "new") void this.createNew();
      if (action === "save") void this.save();
      if (action === "run") void this.run();
      if (action === "add-material") this.addMaterial();
      if (action === "delete-material") this.deleteMaterial(target.dataset.materialId ?? "");
    });
    this.experimentSelect.addEventListener("change", () => void this.loadSelectedExperiment());
    this.sceneSelect.addEventListener("change", () => void this.setScene(this.sceneSelect.value));
    this.blueprintSelect.addEventListener("change", () => {
      this.experiment.blueprintId = this.blueprintSelect.value;
    });
    this.nameInput.addEventListener("change", () => {
      this.experiment.name = this.nameInput.value.trim() || this.experiment.name;
    });
  }

  private async refresh() {
    const result = await this.options.store.loadAll();
    this.blueprints = result.documents;
    if (!this.blueprints.length) {
      const blueprint = createDefaultGraphDocument(createDefaultBlueprintId());
      await this.options.store.saveBlueprint(blueprint);
      this.blueprints = [blueprint];
      await this.options.onLabsChanged();
    }
    this.populateBlueprintSelect();
    this.populateExperimentSelect(result.experiments);
    if (!this.experiment.blueprintId || !this.blueprints.some((doc) => doc.id === this.experiment.blueprintId)) {
      this.experiment.blueprintId = this.blueprints[0]?.id ?? createDefaultBlueprintId();
    }
    await this.setScene(this.experiment.scene || BuiltinAssets.scenes.shadowTest);
    this.render();
  }

  private async createNew() {
    const suffix = Math.round(Date.now() / 1000);
    await this.setScene(this.sceneSelect.value || BuiltinAssets.scenes.shadowTest);
    this.experiment = createDefaultExperimentDocument(
      `my-experiment-${suffix}`,
      this.blueprintSelect.value || this.blueprints[0]?.id || createDefaultBlueprintId(),
      this.sceneSelect.value || BuiltinAssets.scenes.shadowTest,
      this.scene?.meshes.map((mesh) => mesh.id) ?? [],
    );
    this.experiment.name = `My Experiment ${suffix}`;
    this.render();
    this.setStatus("Created a new experiment draft.");
  }

  private async loadSelectedExperiment() {
    if (!this.experimentSelect.value) return;
    this.experiment = await this.options.store.loadExperiment(this.experimentSelect.value);
    await this.setScene(this.experiment.scene);
    this.render();
    this.setStatus(`Loaded ${this.experiment.name}.`);
  }

  private async setScene(scenePath: string) {
    this.scene = await loadScenePreset(scenePath);
    this.experiment.scene = scenePath;
    this.ensureAssignments();
    this.render();
  }

  private async save(): Promise<boolean> {
    try {
      this.nameInput.dispatchEvent(new Event("change"));
      this.experiment.blueprintId = this.blueprintSelect.value;
      this.experiment.scene = this.sceneSelect.value;
      this.ensureAssignments();
      await this.options.store.saveExperiment(
        this.experiment,
        this.blueprints.map((blueprint) => blueprint.id),
        this.scene?.meshes.map((mesh) => mesh.id) ?? [],
      );
      const blueprint = this.blueprints.find((doc) => doc.id === this.experiment.blueprintId);
      if (blueprint) {
        this.options.registry.replace(this.options.store.toLab(blueprint, this.experiment));
      }
      await this.options.onLabsChanged(this.experiment.id);
      await this.refresh();
      this.setStatus(`Saved ${this.experiment.id}.`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(message, "error");
      return false;
    }
  }

  private async run() {
    if (await this.save()) {
      await this.options.onRunLab(this.experiment.id);
    }
  }

  private addMaterial() {
    const id = uniqueId("material", this.experiment.materialInstances.map((material) => material.id));
    this.experiment.materialInstances.push({
      id,
      name: `Material ${this.experiment.materialInstances.length + 1}`,
      baseColor: [0.8, 0.8, 0.8, 1],
      metallic: 0,
      roughness: 0.5,
      textures: {
        baseColorTexture: BuiltinAssets.textures.white,
        normalTexture: BuiltinAssets.textures.flatNormal,
      },
    });
    this.render();
  }

  private deleteMaterial(materialId: string) {
    if (this.experiment.materialInstances.length <= 1) {
      this.setStatus("At least one material is required.", "error");
      return;
    }
    const fallback = this.experiment.materialInstances.find((material) => material.id !== materialId);
    this.experiment.materialInstances = this.experiment.materialInstances.filter((material) => material.id !== materialId);
    for (const assignment of this.experiment.assignments) {
      if (assignment.materialId === materialId) {
        assignment.materialId = fallback?.id ?? this.experiment.materialInstances[0].id;
      }
    }
    this.render();
  }

  private render() {
    this.nameInput.value = this.experiment.name;
    this.sceneSelect.value = this.experiment.scene;
    this.blueprintSelect.value = this.experiment.blueprintId;
    this.renderMaterials();
    this.renderObjects();
  }

  private renderMaterials() {
    const fragment = document.createDocumentFragment();
    for (const material of this.experiment.materialInstances) {
      const section = document.createElement("section");
      section.className = "composer-card";
      section.innerHTML = `<div class="composer-card-title"><strong>${material.name}</strong><button type="button" data-action="delete-material" data-material-id="${material.id}">Delete</button></div>`;
      section.append(
        createTextRow("Id", material.id, (value) => {
          this.renameMaterial(material.id, value);
        }),
        createTextRow("Name", material.name, (value) => {
          material.name = value || material.name;
          this.render();
        }),
        createColorRow("Base Color", material.baseColor, (value) => {
          material.baseColor = value;
        }),
        createNumberRow("Metallic", material.metallic ?? 0, 0, 1, 0.01, (value) => {
          material.metallic = value;
        }),
        createNumberRow("Roughness", material.roughness ?? 0.5, 0, 1, 0.01, (value) => {
          material.roughness = value;
        }),
        createTextureRow("Base Texture", material.textures?.baseColorTexture ?? BuiltinAssets.textures.white, (value) => {
          material.textures = { ...material.textures, baseColorTexture: value };
        }),
        createTextureRow("Normal Texture", material.textures?.normalTexture ?? BuiltinAssets.textures.flatNormal, (value) => {
          material.textures = { ...material.textures, normalTexture: value };
        }),
      );
      fragment.append(section);
    }
    this.materialList.replaceChildren(fragment);
  }

  private renderObjects() {
    const fragment = document.createDocumentFragment();
    for (const mesh of this.scene?.meshes ?? []) {
      const assignment = this.assignmentFor(mesh.id);
      const row = document.createElement("label");
      row.className = "composer-object-row";
      row.innerHTML = `<span>${mesh.name}</span>`;
      const select = document.createElement("select");
      for (const material of this.experiment.materialInstances) {
        const option = document.createElement("option");
        option.value = material.id;
        option.textContent = material.name;
        select.append(option);
      }
      select.value = assignment.materialId;
      select.addEventListener("change", () => {
        assignment.materialId = select.value;
      });
      row.append(select);
      fragment.append(row);
    }
    this.objectList.replaceChildren(fragment);
  }

  private populateSceneSelect() {
    this.sceneSelect.replaceChildren();
    for (const scene of scenes) {
      const option = document.createElement("option");
      option.value = scene.path;
      option.textContent = scene.name;
      this.sceneSelect.append(option);
    }
  }

  private populateBlueprintSelect() {
    this.blueprintSelect.replaceChildren();
    for (const blueprint of this.blueprints) {
      const option = document.createElement("option");
      option.value = blueprint.id;
      option.textContent = blueprint.name;
      this.blueprintSelect.append(option);
    }
  }

  private populateExperimentSelect(experiments: EditableExperimentDocument[]) {
    this.experimentSelect.replaceChildren();
    for (const experiment of experiments) {
      const option = document.createElement("option");
      option.value = experiment.id;
      option.textContent = experiment.name;
      this.experimentSelect.append(option);
    }
    if (experiments.some((experiment) => experiment.id === this.experiment.id)) {
      this.experimentSelect.value = this.experiment.id;
    }
  }

  private ensureAssignments() {
    const materialId = this.experiment.materialInstances[0]?.id ?? "default-material";
    const existing = new Map(this.experiment.assignments.map((assignment) => [assignment.meshId, assignment]));
    this.experiment.assignments = (this.scene?.meshes ?? []).map((mesh) => existing.get(mesh.id) ?? { meshId: mesh.id, materialId });
  }

  private assignmentFor(meshId: string) {
    this.ensureAssignments();
    return this.experiment.assignments.find((assignment) => assignment.meshId === meshId)!;
  }

  private renameMaterial(oldId: string, nextId: string) {
    if (!nextId || oldId === nextId || this.experiment.materialInstances.some((material) => material.id === nextId)) return;
    const material = this.experiment.materialInstances.find((entry) => entry.id === oldId);
    if (!material) return;
    material.id = nextId;
    for (const assignment of this.experiment.assignments) {
      if (assignment.materialId === oldId) assignment.materialId = nextId;
    }
    this.render();
  }

  private setStatus(message: string, tone: "info" | "error" = "info") {
    this.status.textContent = message;
    this.status.dataset.tone = tone;
    this.options.onLog(tone === "error" ? "error" : "info", message);
  }

  private query<T extends HTMLElement>(selector: string): T {
    const element = this.overlay.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing composer element: ${selector}`);
    }
    return element;
  }
}

function createDefaultBlueprintId() {
  return "my-graph-lab";
}

function createTextRow(label: string, value: string, onChange: (value: string) => void) {
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("change", () => onChange(input.value.trim()));
  row.append(input);
  return row;
}

function createNumberRow(label: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void) {
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span>`;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("change", () => onChange(Number(input.value)));
  row.append(input);
  return row;
}

function createColorRow(label: string, value: GraphMaterialInstance["baseColor"], onChange: (value: GraphMaterialInstance["baseColor"]) => void) {
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span>`;
  const input = document.createElement("input");
  input.type = "color";
  input.value = rgbaToHex(value);
  input.addEventListener("change", () => onChange(hexToRgba(input.value, value[3] ?? 1)));
  row.append(input);
  return row;
}

function createTextureRow(label: string, value: string, onChange: (value: string) => void) {
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span>`;
  const select = document.createElement("select");
  for (const texture of textureOptions) {
    const option = document.createElement("option");
    option.value = texture.value;
    option.textContent = texture.label;
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  row.append(select);
  return row;
}

function rgbaToHex(color: GraphMaterialInstance["baseColor"]) {
  return `#${color
    .slice(0, 3)
    .map((channel: number) => Math.round(channel * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgba(hex: string, alpha: number): GraphMaterialInstance["baseColor"] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
    alpha,
  ];
}

function uniqueId(prefix: string, existing: string[]) {
  let index = 1;
  let id = `${prefix}${index}`;
  while (existing.includes(id)) {
    index += 1;
    id = `${prefix}${index}`;
  }
  return id;
}
