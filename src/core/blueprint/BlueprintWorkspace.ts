import {
  createDefaultGraphDocument,
  validateEditableGraphDocument,
  type EditableGraphLabDocument,
} from "./EditableGraphDocument";
import { showCreateDocumentDialog, uniqueSafeId } from "./CreateDocumentDialog";
import { UserLabStore } from "./UserLabStore";
import { WgslEditor } from "./WgslEditor";

export type BlueprintWorkspaceOptions = {
  store: UserLabStore;
  onBlueprintsChanged: () => Promise<void> | void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
};

type NodeKind = "texture2d" | "depthTexture" | "sampler" | "meshPass" | "fullscreenPass" | "output";
type BlueprintNodeModel = {
  id: string;
  title: string;
  kind: NodeKind;
  x: number;
  y: number;
};

export class BlueprintWorkspace {
  private document = createDefaultGraphDocument();
  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly library: HTMLElement;
  private readonly status: HTMLElement;
  private readonly labSelect: HTMLSelectElement;
  private readonly shaderSelect: HTMLSelectElement;
  private readonly editor: WgslEditor;
  private selectedNodeId = "pass:Scene Mesh Pass";
  private activeShaderId = "main";
  private dragging?: { id: string; offsetX: number; offsetY: number };
  private connecting?: { fromId: string };

  constructor(private readonly options: BlueprintWorkspaceOptions) {
    this.overlay = document.createElement("div");
    this.overlay.className = "blueprint-overlay";
    this.overlay.hidden = true;

    this.overlay.innerHTML = `
      <section class="blueprint-window" role="dialog" aria-modal="true" aria-label="Blueprint Workspace">
        <header class="blueprint-toolbar">
          <strong>Blueprint Workspace</strong>
          <select class="blueprint-lab-select" aria-label="Blueprint"></select>
          <button type="button" data-action="new">New</button>
          <button type="button" data-action="save">Save</button>
          <button type="button" data-action="validate">Validate</button>
          <button type="button" data-action="delete-blueprint">Delete Blueprint</button>
          <button type="button" data-action="close">Close</button>
        </header>
        <div class="blueprint-body">
          <aside class="blueprint-library">
            <p class="panel-label">Nodes</p>
            <button type="button" data-node="texture2d">Texture2D</button>
            <button type="button" data-node="depthTexture">Depth Texture</button>
            <button type="button" data-node="sampler">Sampler</button>
            <button type="button" data-node="meshPass">Mesh Pass</button>
            <button type="button" data-node="fullscreenPass">Fullscreen Pass</button>
          </aside>
          <div class="blueprint-canvas" aria-label="Blueprint canvas"></div>
          <aside class="blueprint-inspector"></aside>
        </div>
        <section class="blueprint-code">
          <div class="blueprint-codebar">
            <label>Shader <select class="blueprint-shader-select"></select></label>
            <div class="blueprint-shader-actions">
              <button type="button" data-action="new-shader">New Shader</button>
              <button type="button" data-action="duplicate-shader">Duplicate</button>
              <button type="button" data-action="rename-shader">Rename</button>
              <button type="button" data-action="delete-shader">Delete</button>
            </div>
            <span class="blueprint-status">Ready.</span>
          </div>
          <div class="blueprint-editor"></div>
        </section>
      </section>
    `;

    document.body.append(this.overlay);
    this.canvas = this.query(".blueprint-canvas");
    this.inspector = this.query(".blueprint-inspector");
    this.library = this.query(".blueprint-library");
    this.status = this.query(".blueprint-status");
    this.labSelect = this.query(".blueprint-lab-select");
    this.shaderSelect = this.query(".blueprint-shader-select");
    this.editor = new WgslEditor(this.query(".blueprint-editor"), () => this.syncShaderFromEditor());
    this.editor.setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    window.addEventListener("lab-theme-change", (event) => {
      const theme = (event as CustomEvent<{ theme: "dark" | "light" }>).detail.theme;
      this.editor.setTheme(theme);
    });
    this.bindEvents();
    this.render();
  }

  async open() {
    this.overlay.hidden = false;
    await this.refreshLabList();
    this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  private bindEvents() {
    this.overlay.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      const nodeKind = target.dataset.node as NodeKind | undefined;
      if (action === "new") void this.createNew();
      if (action === "save") void this.save();
      if (action === "validate") this.validate();
      if (action === "close") this.close();
      if (action === "delete-blueprint") void this.deleteBlueprint();
      if (action === "new-shader") void this.createShader();
      if (action === "duplicate-shader") void this.duplicateShader();
      if (action === "rename-shader") void this.renameShader();
      if (action === "delete-shader") this.deleteShader();
      if (action === "move-pass-up") this.movePass(target.dataset.passName ?? "", -1);
      if (action === "move-pass-down") this.movePass(target.dataset.passName ?? "", 1);
      if (action === "select-pass") this.selectPass(target.dataset.passName ?? "");
      if (nodeKind) this.addNode(nodeKind);
    });

    this.labSelect.addEventListener("change", () => {
      void this.loadSelectedLab();
    });

    this.shaderSelect.addEventListener("change", () => {
      this.syncShaderFromEditor();
      this.activeShaderId = this.shaderSelect.value;
      this.syncEditorFromShader();
    });

    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", () => {
      this.dragging = undefined;
      this.connecting = undefined;
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.dragging = undefined;
    });
  }

  private async refreshLabList() {
    const result = await this.options.store.loadAll().catch(() => ({ documents: [], labs: [] }));
    this.labSelect.replaceChildren();
    for (const doc of result.documents) {
      const option = document.createElement("option");
      option.value = doc.id;
      option.textContent = doc.name;
      this.labSelect.append(option);
    }
    if (result.documents.some((doc) => doc.id === this.document.id)) {
      this.labSelect.value = this.document.id;
    }
  }

  private async loadSelectedLab() {
    if (!this.labSelect.value) return;
    const loaded = await this.options.store.load(this.labSelect.value);
    this.document = await this.options.store.hydrateShaders(loaded);
    this.selectedNodeId = `pass:${this.document.passes[0]?.name ?? ""}`;
    this.activeShaderId = this.currentShaderId() ?? Object.keys(this.document.shaders)[0] ?? "";
    this.render();
    this.setStatus(`Loaded ${this.document.name}.`);
  }

  private async createNew() {
    const existing = (await this.options.store.loadAll().catch(() => ({ documents: [] }))).documents.map((doc) => doc.id);
    const result = await showCreateDocumentDialog({
      title: "New Blueprint",
      nameLabel: "Blueprint Name",
      defaultName: "My Blueprint",
      existingIds: existing,
      idLabel: "Blueprint Id",
    });
    if (!result) return;
    this.document = createDefaultGraphDocument(result.id);
    this.document.name = result.name;
    this.selectedNodeId = "pass:Scene Mesh Pass";
    this.activeShaderId = "main";
    this.render();
    if (await this.save()) {
      this.setStatus(`Created blueprint ${this.document.name}.`);
    }
  }

  private async save(): Promise<boolean> {
    this.syncShaderFromEditor();
    const errors = validateEditableGraphDocument(this.document);
    if (errors.length) {
      this.setStatus(errors.join(" | "), "error");
      return false;
    }
    await this.options.store.save(this.document);
    await this.options.onBlueprintsChanged();
    await this.refreshLabList();
    this.setStatus(`Saved blueprint ${this.document.id}.`);
    return true;
  }

  private async deleteBlueprint() {
    const all = await this.options.store.loadAll();
    const deletedId = this.document.id;
    const deletedName = this.document.name;
    const references = all.experiments.filter((experiment) => experiment.blueprintId === this.document.id);
    const suffix = references.length
      ? `\n\n${references.length} lab(s) will keep a Missing Blueprint placeholder.`
      : "";
    const confirmed = window.confirm(`Delete blueprint "${deletedName}"?\n\nIt will be moved to user-labs/.trash.${suffix}`);
    if (!confirmed) return;
    try {
      await this.options.store.deleteBlueprint(this.document.id);
      await this.options.onBlueprintsChanged();
      await this.refreshLabList();
      if (this.labSelect.value) {
        await this.loadSelectedLab();
      } else {
        this.document = createDefaultGraphDocument();
        this.selectedNodeId = "pass:Scene Mesh Pass";
        this.activeShaderId = "main";
        this.render();
      }
      this.setStatus(`Deleted blueprint ${deletedId}.`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  private validate() {
    this.syncShaderFromEditor();
    const errors = validateEditableGraphDocument(this.document);
    if (errors.length) {
      this.setStatus(errors.join(" | "), "error");
      this.options.onLog("warn", errors.join("\n"));
      return;
    }
    this.setStatus("Validation passed.");
  }

  private addNode(kind: NodeKind) {
    this.syncShaderFromEditor();
    const id = uniqueId(kind, [
      ...Object.keys(this.document.resources),
      ...this.document.passes.map((pass) => pass.name),
      this.document.output,
    ]);
    const x = 120 + Object.keys(this.document.layout.nodes).length * 18;
    const y = 90 + Object.keys(this.document.layout.nodes).length * 14;

    if (kind === "texture2d") {
      this.document.resources[id] = { kind: "texture2d", format: "screen", size: "canvas", usage: ["render", "sample", "copySrc", "copyDst"], debug: true, label: id };
      this.selectedNodeId = `resource:${id}`;
    }
    if (kind === "depthTexture") {
      this.document.resources[id] = { kind: "depthTexture", format: "depth24plus", size: "canvas", usage: ["render"], label: id };
      this.selectedNodeId = `resource:${id}`;
    }
    if (kind === "sampler") {
      this.document.resources[id] = { kind: "sampler", type: "filtering", label: id };
      this.selectedNodeId = `resource:${id}`;
    }
    if (kind === "meshPass" || kind === "fullscreenPass") {
      const shaderId = uniqueSafeId(`${id}Shader`, Object.keys(this.document.shaders));
      this.document.shaders[shaderId] = {
        path: `${shaderId}.wgsl`,
        code: kind === "meshPass" ? this.document.shaders.main?.code ?? "" : fullscreenShader(),
      };
      this.document.passes.push(
        kind === "meshPass"
          ? {
              type: "mesh",
              name: id,
              shader: shaderId,
              color: firstTexture(this.document) ?? "",
              depth: firstDepth(this.document),
              reads: [],
              bindings: structuredClone(this.document.passes[0]?.bindings ?? []),
              cullMode: "back",
              depthWrite: true,
              depthCompare: "less",
              clear: true,
              enabled: true,
            }
          : {
              type: "fullscreen",
              name: id,
              shader: shaderId,
              color: firstTexture(this.document) ?? "",
              reads: firstTexture(this.document) ? [firstTexture(this.document) as string] : [],
              bindings: [],
              clear: true,
              enabled: true,
            },
      );
      this.selectedNodeId = `pass:${id}`;
      this.activeShaderId = shaderId;
    }
    this.document.layout.nodes[this.selectedNodeId] = { x, y };
    this.render();
  }

  private async createShader() {
    this.syncShaderFromEditor();
    const result = await showCreateDocumentDialog({
      title: "New Shader",
      nameLabel: "Shader Name",
      defaultName: "New Shader",
      existingIds: Object.keys(this.document.shaders),
      idLabel: "Shader Id",
      extraFields: [
        {
          id: "template",
          label: "Template",
          value: "mesh",
          options: [
            { label: "Mesh Shader", value: "mesh" },
            { label: "Fullscreen Shader", value: "fullscreen" },
            { label: "Empty Shader", value: "empty" },
          ],
        },
      ],
    });
    if (!result) return;
    this.document.shaders[result.id] = {
      path: `${result.id}.wgsl`,
      code: shaderTemplate(result.extra.template),
    };
    this.activeShaderId = result.id;
    this.renderShaderSelect();
    this.syncEditorFromShader();
    this.setStatus(`Created shader ${result.id}.`);
  }

  private async duplicateShader() {
    this.syncShaderFromEditor();
    const sourceId = this.selectedShaderId();
    const source = this.document.shaders[sourceId];
    if (!source) return;
    const result = await showCreateDocumentDialog({
      title: "Duplicate Shader",
      nameLabel: "Shader Name",
      defaultName: `${sourceId} Copy`,
      existingIds: Object.keys(this.document.shaders),
      idLabel: "Shader Id",
    });
    if (!result) return;
    this.document.shaders[result.id] = {
      path: `${result.id}.wgsl`,
      code: source.code,
    };
    this.activeShaderId = result.id;
    this.renderShaderSelect();
    this.syncEditorFromShader();
    this.setStatus(`Duplicated shader ${sourceId}.`);
  }

  private async renameShader() {
    this.syncShaderFromEditor();
    const oldId = this.selectedShaderId();
    const shader = this.document.shaders[oldId];
    if (!shader) return;
    const result = await showCreateDocumentDialog({
      title: "Rename Shader",
      nameLabel: "Shader Name",
      defaultName: oldId,
      existingIds: Object.keys(this.document.shaders).filter((id) => id !== oldId),
      idLabel: "Shader Id",
    });
    if (!result) return;
    this.document.shaders[result.id] = {
      ...shader,
      path: `${result.id}.wgsl`,
    };
    delete this.document.shaders[oldId];
    for (const pass of this.document.passes) {
      if (pass.shader === oldId) pass.shader = result.id;
    }
    this.activeShaderId = result.id;
    this.render();
    this.setStatus(`Renamed shader ${oldId} to ${result.id}.`);
  }

  private deleteShader() {
    this.syncShaderFromEditor();
    const shaderId = this.selectedShaderId();
    if (Object.keys(this.document.shaders).length <= 1) {
      this.setStatus("At least one shader is required.", "error");
      return;
    }
    const users = this.document.passes.filter((pass) => pass.shader === shaderId).map((pass) => pass.name);
    if (users.length) {
      this.setStatus(`Shader ${shaderId} is used by: ${users.join(", ")}`, "error");
      return;
    }
    delete this.document.shaders[shaderId];
    this.activeShaderId = Object.keys(this.document.shaders)[0] ?? "";
    this.renderShaderSelect();
    this.syncEditorFromShader();
    this.setStatus(`Deleted shader ${shaderId}.`);
  }

  private render() {
    this.renderLibrary();
    this.renderCanvas();
    this.renderInspector();
    this.renderShaderSelect();
    this.syncEditorFromShader();
  }

  private renderLibrary() {
    const fragment = document.createDocumentFragment();
    const nodeLabel = document.createElement("p");
    nodeLabel.className = "panel-label";
    nodeLabel.textContent = "Nodes";
    fragment.append(nodeLabel);
    for (const [kind, label] of [
      ["texture2d", "Texture2D"],
      ["depthTexture", "Depth Texture"],
      ["sampler", "Sampler"],
      ["meshPass", "Mesh Pass"],
      ["fullscreenPass", "Fullscreen Pass"],
    ] as Array<[NodeKind, string]>) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.node = kind;
      button.textContent = label;
      fragment.append(button);
    }
    const order = document.createElement("section");
    order.className = "blueprint-pass-order";
    order.innerHTML = `<p class="panel-label">Pass Order</p>`;
    if (!this.document.passes.length) {
      const empty = document.createElement("p");
      empty.className = "blueprint-pass-order-empty";
      empty.textContent = "No passes.";
      order.append(empty);
    }
    this.document.passes.forEach((pass, index) => {
      const row = document.createElement("div");
      row.className = "blueprint-pass-order-row";
      if (`pass:${pass.name}` === this.selectedNodeId) row.dataset.selected = "true";
      const select = document.createElement("button");
      select.type = "button";
      select.dataset.action = "select-pass";
      select.dataset.passName = pass.name;
      select.textContent = `${index + 1}. ${pass.name}`;
      const up = document.createElement("button");
      up.type = "button";
      up.dataset.action = "move-pass-up";
      up.dataset.passName = pass.name;
      up.textContent = "Up";
      up.disabled = index === 0;
      const down = document.createElement("button");
      down.type = "button";
      down.dataset.action = "move-pass-down";
      down.dataset.passName = pass.name;
      down.textContent = "Down";
      down.disabled = index === this.document.passes.length - 1;
      row.append(select, up, down);
      order.append(row);
    });
    fragment.append(order);
    this.library.replaceChildren(fragment);
  }

  private renderCanvas() {
    const fragment = document.createDocumentFragment();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("blueprint-links");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    fragment.append(svg);

    const nodes = this.nodeModels();
    for (const edge of this.edgeModels(nodes)) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edge.path);
      path.setAttribute("class", "blueprint-link");
      svg.append(path);
    }

    for (const node of nodes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `blueprint-node blueprint-node-${node.kind}`;
      button.dataset.id = node.id;
      if (node.id === this.selectedNodeId) button.dataset.selected = "true";
      button.style.left = `${node.x}px`;
      button.style.top = `${node.y}px`;
      button.innerHTML = `<span>${node.title}</span><small>${node.kind}</small>`;
      const inputHandle = document.createElement("i");
      inputHandle.className = "blueprint-handle blueprint-handle-in";
      const outputHandle = document.createElement("i");
      outputHandle.className = "blueprint-handle blueprint-handle-out";
      outputHandle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.connecting = { fromId: node.id };
      });
      button.addEventListener("pointerdown", (event) => {
        if (event.target instanceof HTMLElement && event.target.closest(".blueprint-handle")) {
          return;
        }
        this.syncShaderFromEditor();
        this.selectedNodeId = node.id;
        this.activeShaderId = this.currentShaderId() ?? this.activeShaderId;
        this.dragging = { id: node.id, offsetX: event.offsetX, offsetY: event.offsetY };
        button.setPointerCapture(event.pointerId);
        this.renderInspector();
      });
      button.addEventListener("pointerup", (event) => {
        if (this.connecting && this.connecting.fromId !== node.id) {
          event.preventDefault();
          event.stopPropagation();
          this.connectNodes(this.connecting.fromId, node.id);
          this.connecting = undefined;
        }
      });
      button.append(inputHandle, outputHandle);
      fragment.append(button);
    }
    this.canvas.replaceChildren(fragment);
  }

  private renderInspector() {
    const node = this.selectedNode();
    if (!node) {
      this.inspector.replaceChildren();
      return;
    }
    const form = document.createElement("div");
    form.className = "blueprint-inspector-form";
    form.innerHTML = `<p class="panel-label">Inspector</p><h3>${node.title}</h3>`;
    form.append(
      createTextRow("Blueprint Name", this.document.name, (value) => {
        this.document.name = value || this.document.name;
        this.refreshSelectedBlueprintLabel();
      }),
      createTextareaRow("Description", this.document.description ?? "", (value) => {
        this.document.description = value;
      }),
    );

    if (node.id.startsWith("resource:")) {
      this.renderResourceInspector(form, node.title);
    } else if (node.id.startsWith("pass:")) {
      this.renderPassInspector(form, node.title);
    } else {
      form.append(createSelectRow("Output", Object.keys(this.document.resources), this.document.output, (value) => {
        this.document.output = value;
        this.render();
      }));
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete Node";
    deleteButton.addEventListener("click", () => this.deleteSelectedNode());
    if (node.id === "output:screen") deleteButton.disabled = true;
    form.append(deleteButton);
    this.inspector.replaceChildren(form);
  }

  private renderResourceInspector(form: HTMLElement, id: string) {
    const resource = this.document.resources[id];
    if (!resource) return;
    form.append(createTextRow("Id", id, (value) => this.renameResource(id, value)));
    form.append(createTextRow("Label", resource.label ?? "", (value) => {
      resource.label = value;
    }));
    if (resource.kind !== "sampler") {
      form.append(createCheckboxRow("Debug View", Boolean(resource.debug), (value) => {
        resource.debug = value;
      }));
    }
    if (resource.kind === "sampler") {
      form.append(createSelectRow("Type", ["filtering", "non-filtering", "comparison"], resource.type ?? "filtering", (value) => {
        resource.type = value as "filtering";
      }));
    }
  }

  private renderPassInspector(form: HTMLElement, name: string) {
    const pass = this.document.passes.find((entry) => entry.name === name);
    if (!pass) return;
    form.append(createTextRow("Name", pass.name, (value) => this.renamePass(pass.name, value)));
    form.append(createSelectRow("Shader", shaderOptions(this.document, pass.shader), pass.shader, (value) => {
      this.syncShaderFromEditor();
      pass.shader = value;
      this.activeShaderId = value;
      this.renderShaderSelect();
      this.syncEditorFromShader();
    }));
    form.append(createSelectRow("Color", textureResources(this.document), pass.color, (value) => {
      pass.color = value;
      this.render();
    }));
    if (pass.type === "mesh") {
      form.append(createSelectRow("Depth", ["", ...depthResources(this.document)], pass.depth ?? "", (value) => {
        pass.depth = value || undefined;
        this.render();
      }));
    }
    form.append(createTextRow("Reads", (pass.reads ?? []).join(", "), (value) => {
      pass.reads = value.split(",").map((entry) => entry.trim()).filter(Boolean);
      this.render();
    }));
    form.append(createCheckboxRow("Clear Target", pass.clear !== false, (value) => {
      pass.clear = value;
      this.render();
    }));
  }

  private renderShaderSelect() {
    const current = this.currentShaderId();
    this.shaderSelect.replaceChildren();
    for (const id of Object.keys(this.document.shaders)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      this.shaderSelect.append(option);
    }
    if (current && !this.document.shaders[current]) {
      const option = document.createElement("option");
      option.value = current;
      option.textContent = `Missing: ${current}`;
      this.shaderSelect.append(option);
    }
    if (this.activeShaderId && this.document.shaders[this.activeShaderId]) {
      this.shaderSelect.value = this.activeShaderId;
      return;
    }
    if (current) {
      this.shaderSelect.value = current;
      this.activeShaderId = current;
    }
  }

  private syncEditorFromShader() {
    const shader = this.document.shaders[this.selectedShaderId()];
    this.editor.setValue(shader?.code ?? "");
  }

  private syncShaderFromEditor() {
    const shaderId = this.activeShaderId || this.shaderSelect.value || this.currentShaderId();
    if (shaderId && this.document.shaders[shaderId]) {
      this.document.shaders[shaderId].code = this.editor.getValue();
    }
  }

  private selectedShaderId() {
    return this.shaderSelect.value || this.activeShaderId || this.currentShaderId() || Object.keys(this.document.shaders)[0] || "main";
  }

  private currentShaderId() {
    if (this.selectedNodeId.startsWith("pass:")) {
      return this.document.passes.find((pass) => `pass:${pass.name}` === this.selectedNodeId)?.shader;
    }
    return Object.keys(this.document.shaders)[0];
  }

  private onPointerMove(event: PointerEvent) {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const next = {
      x: Math.max(8, event.clientX - rect.left - this.dragging.offsetX),
      y: Math.max(8, event.clientY - rect.top - this.dragging.offsetY),
    };
    this.document.layout.nodes[this.dragging.id] = next;
    this.renderCanvas();
  }

  private selectedNode() {
    return this.nodeModels().find((node) => node.id === this.selectedNodeId);
  }

  private nodeModels(): BlueprintNodeModel[] {
    const nodes: BlueprintNodeModel[] = Object.entries(this.document.resources).map(([id, resource]) => ({
      id: `resource:${id}`,
      title: id,
      kind: resource.kind,
      ...(this.document.layout.nodes[`resource:${id}`] ?? { x: 80, y: 80 }),
    }));
    for (const pass of this.document.passes) {
      nodes.push({
        id: `pass:${pass.name}`,
        title: pass.name,
        kind: pass.type === "mesh" ? "meshPass" : "fullscreenPass",
        ...(this.document.layout.nodes[`pass:${pass.name}`] ?? { x: 360, y: 120 }),
      });
    }
    nodes.push({
      id: "output:screen",
      title: "Screen",
      kind: "output",
      ...(this.document.layout.nodes["output:screen"] ?? { x: 680, y: 120 }),
    });
    return nodes;
  }

  private edgeModels(nodes: BlueprintNodeModel[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges: Array<{ path: string }> = [];
    const add = (fromId: string, toId: string) => {
      const from = byId.get(fromId);
      const to = byId.get(toId);
      if (!from || !to) return;
      const sx = from.x + 150;
      const sy = from.y + 30;
      const ex = to.x;
      const ey = to.y + 30;
      const mx = (sx + ex) * 0.5;
      edges.push({ path: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}` });
    };
    for (const pass of this.document.passes) {
      for (const read of pass.reads ?? []) add(`resource:${read}`, `pass:${pass.name}`);
      add(`pass:${pass.name}`, `resource:${pass.color}`);
      if (pass.type === "mesh" && pass.depth) add(`pass:${pass.name}`, `resource:${pass.depth}`);
    }
    add(`resource:${this.document.output}`, "output:screen");
    return edges;
  }

  private renameResource(oldId: string, nextId: string) {
    if (!nextId || oldId === nextId || this.document.resources[nextId]) return;
    this.document.resources[nextId] = this.document.resources[oldId];
    delete this.document.resources[oldId];
    for (const pass of this.document.passes) {
      if (pass.color === oldId) pass.color = nextId;
      if (pass.type === "mesh" && pass.depth === oldId) pass.depth = nextId;
      pass.reads = (pass.reads ?? []).map((read) => (read === oldId ? nextId : read));
    }
    if (this.document.output === oldId) this.document.output = nextId;
    moveLayout(this.document, `resource:${oldId}`, `resource:${nextId}`);
    this.selectedNodeId = `resource:${nextId}`;
    this.render();
  }

  private renamePass(oldName: string, nextName: string) {
    if (!nextName || oldName === nextName || this.document.passes.some((pass) => pass.name === nextName)) return;
    const pass = this.document.passes.find((entry) => entry.name === oldName);
    if (!pass) return;
    pass.name = nextName;
    moveLayout(this.document, `pass:${oldName}`, `pass:${nextName}`);
    this.selectedNodeId = `pass:${nextName}`;
    this.render();
  }

  private movePass(name: string, direction: -1 | 1) {
    if (!name) return;
    this.syncShaderFromEditor();
    const index = this.document.passes.findIndex((pass) => pass.name === name);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= this.document.passes.length) return;
    const [pass] = this.document.passes.splice(index, 1);
    this.document.passes.splice(nextIndex, 0, pass);
    this.selectedNodeId = `pass:${pass.name}`;
    this.activeShaderId = pass.shader;
    this.render();
    this.setStatus(`Moved ${pass.name} ${direction < 0 ? "up" : "down"}.`);
  }

  private selectPass(name: string) {
    const pass = this.document.passes.find((entry) => entry.name === name);
    if (!pass) return;
    this.syncShaderFromEditor();
    this.selectedNodeId = `pass:${pass.name}`;
    this.activeShaderId = pass.shader;
    this.render();
  }

  private deleteSelectedNode() {
    const id = this.selectedNodeId;
    if (id.startsWith("resource:")) {
      const resourceId = id.slice("resource:".length);
      delete this.document.resources[resourceId];
      for (const pass of this.document.passes) {
        pass.reads = (pass.reads ?? []).filter((read) => read !== resourceId);
        if (pass.color === resourceId) pass.color = "";
        if (pass.type === "mesh" && pass.depth === resourceId) pass.depth = undefined;
      }
    }
    if (id.startsWith("pass:")) {
      const name = id.slice("pass:".length);
      this.document.passes = this.document.passes.filter((pass) => pass.name !== name);
    }
    delete this.document.layout.nodes[id];
    this.selectedNodeId = "output:screen";
    this.render();
  }

  private connectNodes(fromId: string, toId: string) {
    if (fromId.startsWith("resource:") && toId.startsWith("pass:")) {
      const resourceId = fromId.slice("resource:".length);
      const passName = toId.slice("pass:".length);
      const pass = this.document.passes.find((entry) => entry.name === passName);
      if (pass && !pass.reads?.includes(resourceId)) {
        pass.reads = [...(pass.reads ?? []), resourceId];
      }
    }
    if (fromId.startsWith("pass:") && toId.startsWith("resource:")) {
      const passName = fromId.slice("pass:".length);
      const resourceId = toId.slice("resource:".length);
      const resource = this.document.resources[resourceId];
      const pass = this.document.passes.find((entry) => entry.name === passName);
      if (pass && resource?.kind === "texture2d") {
        pass.color = resourceId;
      }
      if (pass?.type === "mesh" && resource?.kind === "depthTexture") {
        pass.depth = resourceId;
      }
    }
    if (fromId.startsWith("resource:") && toId === "output:screen") {
      const resourceId = fromId.slice("resource:".length);
      if (this.document.resources[resourceId]?.kind === "texture2d") {
        this.document.output = resourceId;
      }
    }
    this.render();
  }

  private setStatus(message: string, tone: "info" | "error" = "info") {
    this.status.textContent = message;
    this.status.dataset.tone = tone;
    this.options.onLog(tone === "error" ? "error" : "info", message);
  }

  private refreshSelectedBlueprintLabel() {
    const option = [...this.labSelect.options].find((entry) => entry.value === this.document.id);
    if (option) option.textContent = this.document.name;
  }

  private query<T extends HTMLElement>(selector: string): T {
    const element = this.overlay.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing blueprint element: ${selector}`);
    }
    return element;
  }
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

function createTextareaRow(label: string, value: string, onChange: (value: string) => void) {
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span>`;
  const input = document.createElement("textarea");
  input.value = value;
  input.rows = 3;
  input.addEventListener("change", () => onChange(input.value.trim()));
  row.append(input);
  return row;
}

function createSelectRow(
  label: string,
  options: Array<string | { label: string; value: string }>,
  value: string,
  onChange: (value: string) => void,
) {
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span>`;
  const select = document.createElement("select");
  for (const option of options) {
    const element = document.createElement("option");
    const optionValue = typeof option === "string" ? option : option.value;
    element.value = optionValue;
    element.textContent = typeof option === "string" ? option || "None" : option.label;
    select.append(element);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  row.append(select);
  return row;
}

function createCheckboxRow(label: string, value: boolean, onChange: (value: boolean) => void) {
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span>`;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => onChange(input.checked));
  row.append(input);
  return row;
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

function textureResources(document: EditableGraphLabDocument) {
  return Object.entries(document.resources)
    .filter(([, resource]) => resource.kind === "texture2d")
    .map(([id]) => id);
}

function depthResources(document: EditableGraphLabDocument) {
  return Object.entries(document.resources)
    .filter(([, resource]) => resource.kind === "depthTexture")
    .map(([id]) => id);
}

function shaderOptions(document: EditableGraphLabDocument, current: string) {
  const options = Object.keys(document.shaders);
  return current && !document.shaders[current]
    ? [...options, { label: `Missing: ${current}`, value: current }]
    : options;
}

function firstTexture(document: EditableGraphLabDocument) {
  return textureResources(document)[0];
}

function firstDepth(document: EditableGraphLabDocument) {
  return depthResources(document)[0];
}

function moveLayout(document: EditableGraphLabDocument, from: string, to: string) {
  document.layout.nodes[to] = document.layout.nodes[from] ?? { x: 100, y: 100 };
  delete document.layout.nodes[from];
}

function fullscreenShader() {
  return `struct ParamsUniforms {
  values: array<vec4f, 16>,
};

@group(0) @binding(0) var<uniform> params: ParamsUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(params.values[0].xxx, 1.0);
}
`;
}

function shaderTemplate(template: string) {
  if (template === "fullscreen") return fullscreenShader();
  if (template === "empty") return "";
  return `struct FrameUniforms {
  viewProjection: mat4x4f,
  reserved: mat4x4f,
  resolutionTime: vec4f,
};

struct ObjectUniforms {
  model: mat4x4f,
  modelViewProjection: mat4x4f,
};

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) uv: vec2f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(input.position, 1.0);
  output.normal = input.normal;
  output.uv = input.uv;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(abs(input.normal), 1.0);
}
`;
}
