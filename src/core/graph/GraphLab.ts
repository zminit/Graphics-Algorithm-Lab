import type { SceneMaterial, SceneMesh, ScenePreset } from "../assets/ScenePreset";
import type { Lab, LabContext } from "../lab/Lab";
import { composeTransform, multiply4, type Mat4 } from "../math/Mat4";
import { createGPUMesh, destroyGPUMesh, type GPUMesh } from "../renderer/GPUMesh";
import { createParamState, packParams, toGuiParam, type GraphParamState } from "./GraphParams";
import { GraphView } from "./GraphView";
import type {
  GraphBinding,
  GraphEdgeInfo,
  GraphLabSpec,
  GraphMaterialInstance,
  GraphNodeInfo,
  GraphPassSpec,
  GraphResourceSpec,
  GraphViewModel,
} from "./GraphTypes";

type RuntimeTexture = {
  id: string;
  spec: Extract<GraphResourceSpec, { kind: "texture2d" | "depthTexture" }>;
  texture: GPUTexture;
  width: number;
  height: number;
  format: GPUTextureFormat;
};

type RuntimeSampler = {
  id: string;
  spec: Extract<GraphResourceSpec, { kind: "sampler" }>;
  sampler: GPUSampler;
};

type RenderItem = {
  sceneMesh: SceneMesh;
  material: RuntimeMaterial;
  gpuMesh: GPUMesh;
  modelMatrix: Mat4;
  objectBuffer: GPUBuffer;
  materialBuffer: GPUBuffer;
  bindGroups: Map<string, GPUBindGroup>;
};

type RuntimeMaterial = GraphMaterialInstance & {
  fallbackSceneMaterial?: SceneMaterial;
  baseColorTexture?: GPUTexture;
  normalTexture?: GPUTexture;
  sampler?: GPUSampler;
};

type CompiledPass = {
  spec: GraphPassSpec;
  pipeline: GPURenderPipeline;
  layouts: GPUBindGroupLayout[];
  frameBuffer?: GPUBuffer;
  paramsBuffer?: GPUBuffer;
  passBindGroups: Map<number, GPUBindGroup>;
};

export function defineGraphLab(spec: GraphLabSpec): Lab {
  return new GraphLabRunner(spec);
}

class GraphLabRunner implements Lab {
  id: string;
  name: string;
  category = "rendering" as const;
  description?: string;

  private scene?: ScenePreset;
  private graphView?: GraphView;
  private paramState: GraphParamState;
  private textures = new Map<string, RuntimeTexture>();
  private samplers = new Map<string, RuntimeSampler>();
  private passes: CompiledPass[] = [];
  private renderItems: RenderItem[] = [];

  constructor(private readonly spec: GraphLabSpec) {
    this.id = spec.id;
    this.name = spec.name;
    this.description = spec.description;
    this.paramState = createParamState(spec.params ?? {});
  }

  async setup(ctx: LabContext) {
    validateGraph(this.spec);
    this.scene = await ctx.assets.loadScene(this.spec.scene);
    ctx.camera.lookAt(this.scene.camera.position, this.scene.camera.target);
    ctx.camera.setPerspective(this.scene.camera.fovYDegrees, this.scene.camera.near, this.scene.camera.far);

    for (const [name, paramSpec] of Object.entries(this.spec.params ?? {})) {
      ctx.gui.add(name, toGuiParam(name, paramSpec, this.paramState));
    }

    this.graphView = new GraphView(createMountedGraphRoot(ctx), "Render Graph", {
      onTogglePass: (passName, enabled) => {
        this.setPassEnabled(passName, enabled);
      },
    });
    this.graphView.setModel(createGraphViewModel(this.spec));
    await this.loadSceneMeshes(ctx);
    await this.compilePasses(ctx);
    this.resize(ctx);
  }

  resize(ctx: LabContext) {
    this.destroyTextures();
    this.textures = createTextures(ctx, this.spec);
    this.samplers = createSamplers(ctx, this.spec);
    this.registerDebugTextures(ctx);
    this.rebuildBindGroups(ctx);
  }

  update(ctx: LabContext) {
    const packedParams = packParams(this.spec.params ?? {}, this.paramState);

    for (const pass of this.passes) {
      if (pass.frameBuffer) {
        const frameData = new Float32Array(36);
        frameData.set(ctx.camera.viewProjectionMatrix, 0);
        frameData.set([ctx.canvas.width, ctx.canvas.height, ctx.time.elapsed, ctx.time.deltaTime], 32);
        ctx.device.queue.writeBuffer(pass.frameBuffer, 0, frameData);
      }
      if (pass.paramsBuffer) {
        ctx.device.queue.writeBuffer(pass.paramsBuffer, 0, new Float32Array(packedParams));
      }
    }

    for (const item of this.renderItems) {
      const modelViewProjection = multiply4(ctx.camera.viewProjectionMatrix, item.modelMatrix);
      const objectData = new Float32Array(32);
      objectData.set(item.modelMatrix, 0);
      objectData.set(modelViewProjection, 16);
      ctx.device.queue.writeBuffer(item.objectBuffer, 0, objectData);

      const materialData = new Float32Array(12);
      materialData.set(item.material.baseColor, 0);
      materialData.set(
        [
          item.material.metallic ?? 0,
          item.material.roughness ?? 0.5,
          0,
          0,
        ],
        4,
      );
      materialData.set([item.material.baseColorTexture ? 1 : 0, item.material.normalTexture ? 1 : 0, 0, 0], 8);
      ctx.device.queue.writeBuffer(item.materialBuffer, 0, materialData);
    }
  }

  render(ctx: LabContext) {
    if (!this.scene) {
      return;
    }

    const encoder = ctx.device.createCommandEncoder({ label: `${this.name} Graph Encoder` });
    const bg = this.scene.environment?.color ?? [0.03, 0.04, 0.05];

    for (const pass of this.passes) {
      if (pass.spec.enabled === false) {
        continue;
      }
      if (pass.spec.type === "mesh") {
        this.renderMeshPass(pass, encoder, bg);
      } else {
        this.renderFullscreenPass(pass, encoder, bg);
      }
    }

    const output = this.textureOrThrow(this.spec.output);
    encoder.copyTextureToTexture(
      { texture: output.texture },
      { texture: ctx.context.getCurrentTexture() },
      { width: Math.min(output.width, ctx.canvas.width), height: Math.min(output.height, ctx.canvas.height) },
    );
    ctx.device.queue.submit([encoder.finish()]);
  }

  dispose() {
    this.destroyTextures();
    for (const pass of this.passes) {
      pass.frameBuffer?.destroy();
      pass.paramsBuffer?.destroy();
    }
    for (const item of this.renderItems) {
      destroyGPUMesh(item.gpuMesh);
      item.objectBuffer.destroy();
      item.materialBuffer.destroy();
      item.material.baseColorTexture?.destroy();
      item.material.normalTexture?.destroy();
    }
    this.passes = [];
    this.renderItems = [];
    this.samplers.clear();
  }

  private renderMeshPass(pass: CompiledPass, encoder: GPUCommandEncoder, bg: [number, number, number]) {
    const color = this.textureOrThrow(pass.spec.color);
    const depth = pass.spec.depth ? this.textureOrThrow(pass.spec.depth) : undefined;
    const renderPass = encoder.beginRenderPass({
      label: pass.spec.name,
      colorAttachments: [
        {
          view: color.texture.createView(),
          clearValue: toClearValue(color.spec, bg),
          loadOp: pass.spec.clear === false ? "load" : "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: depth
        ? {
            view: depth.texture.createView(),
            depthClearValue: depth.spec.kind === "depthTexture" ? (depth.spec.depthClearValue ?? 1) : 1,
            depthLoadOp: pass.spec.clear === false ? "load" : "clear",
            depthStoreOp: "store",
          }
        : undefined,
    });

    renderPass.setPipeline(pass.pipeline);
    setPassBindGroups(renderPass, pass);
    for (const item of this.renderItems) {
      const objectBindGroup = item.bindGroups.get(pass.spec.name);
      if (objectBindGroup) {
        renderPass.setBindGroup(getObjectGroup(pass.spec.bindings ?? []), objectBindGroup);
      }
      renderPass.setVertexBuffer(0, item.gpuMesh.vertexBuffer);
      renderPass.setIndexBuffer(item.gpuMesh.indexBuffer, item.gpuMesh.indexFormat);
      renderPass.drawIndexed(item.gpuMesh.indexCount);
    }
    renderPass.end();
  }

  private setPassEnabled(passName: string, enabled: boolean) {
    const pass = this.spec.passes.find((entry) => entry.name === passName);
    if (!pass) {
      return;
    }
    pass.enabled = enabled;
    this.graphView?.setModel(createGraphViewModel(this.spec));
  }

  private renderFullscreenPass(pass: CompiledPass, encoder: GPUCommandEncoder, bg: [number, number, number]) {
    const color = this.textureOrThrow(pass.spec.color);
    const renderPass = encoder.beginRenderPass({
      label: pass.spec.name,
      colorAttachments: [
        {
          view: color.texture.createView(),
          clearValue: toClearValue(color.spec, bg),
          loadOp: pass.spec.clear === false ? "load" : "clear",
          storeOp: "store",
        },
      ],
    });
    renderPass.setPipeline(pass.pipeline);
    setPassBindGroups(renderPass, pass);
    renderPass.draw(3);
    renderPass.end();
  }

  private async loadSceneMeshes(ctx: LabContext) {
    if (!this.scene) {
      return;
    }

    const sceneMaterials = new Map(this.scene.materials.map((material) => [material.id, material]));
    const materialInstances = createMaterialInstances(this.spec, this.scene);
    for (const sceneMesh of this.scene.meshes) {
      const sceneMaterial = sceneMaterials.get(sceneMesh.material);
      if (!sceneMaterial) {
        throw new Error(`Missing material: ${sceneMesh.material}`);
      }
      const material = await createRuntimeMaterial(ctx, sceneMesh, sceneMaterial, materialInstances, this.spec.materialAssignments ?? {});
      const cpuMesh = (await ctx.assets.loadGLB(sceneMesh.model))[0];
      if (!cpuMesh) {
        throw new Error(`Model has no mesh: ${sceneMesh.model}`);
      }
      const modelMatrix = composeTransform(sceneMesh.position ?? [0, 0, 0], sceneMesh.rotation ?? [0, 0, 0], sceneMesh.scale ?? [1, 1, 1]);
      this.renderItems.push({
        sceneMesh,
        material,
        gpuMesh: createGPUMesh(ctx.device, cpuMesh),
        modelMatrix,
        objectBuffer: ctx.device.createBuffer({
          label: `${sceneMesh.name} Graph Object`,
          size: 128,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        materialBuffer: ctx.device.createBuffer({
          label: `${sceneMesh.name} Graph Material`,
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        bindGroups: new Map(),
      });
    }
  }

  private async compilePasses(ctx: LabContext) {
    this.passes = [];
    for (const spec of this.spec.passes) {
      const shader = ctx.device.createShaderModule({
        label: `${this.name} ${spec.name} Shader`,
        code: await loadShader(spec.shader),
      });
      const bindings = spec.bindings ?? [];
      const layouts = buildBindGroupLayouts(ctx.device, bindings, `${this.name} ${spec.name}`);
      const pipeline = ctx.device.createRenderPipeline({
        label: `${this.name} ${spec.name} Pipeline`,
        layout: ctx.device.createPipelineLayout({
          label: `${this.name} ${spec.name} Layout`,
          bindGroupLayouts: layouts,
        }),
        vertex:
          spec.type === "mesh"
            ? {
                module: shader,
                entryPoint: "vertexMain",
                buffers: [meshVertexLayout()],
              }
            : {
                module: shader,
                entryPoint: "vertexMain",
              },
        fragment: {
          module: shader,
          entryPoint: "fragmentMain",
          targets: [{ format: this.textureFormatOrThrow(spec.color, ctx.format) }],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: spec.type === "mesh" ? (spec.cullMode ?? "back") : "none",
        },
        depthStencil:
          spec.type === "mesh" && spec.depth
            ? {
                format: this.textureFormatOrThrow(spec.depth, ctx.format),
                depthWriteEnabled: spec.depthWrite ?? true,
                depthCompare: spec.depthCompare ?? "less",
              }
            : undefined,
      });
      const pass: CompiledPass = {
        spec,
        pipeline,
        layouts,
        passBindGroups: new Map(),
      };
      createUniformBuffers(ctx, pass, bindings);
      this.passes.push(pass);
    }
  }

  private rebuildBindGroups(ctx: LabContext) {
    for (const pass of this.passes) {
      pass.passBindGroups.clear();
      const bindings = pass.spec.bindings ?? [];
      createPassBindGroups(ctx, pass, bindings, this.textures, this.samplers);
      this.createObjectBindGroups(ctx, pass, bindings);
    }
  }

  private createObjectBindGroups(ctx: LabContext, pass: CompiledPass, bindings: GraphBinding[]) {
    const objectGroup = getObjectGroup(bindings);
    if (objectGroup < 0) {
      return;
    }

    const groupBindings = bindings.filter((binding) => binding.group === objectGroup);
    for (const item of this.renderItems) {
      const entries: GPUBindGroupEntry[] = [];
      for (const binding of groupBindings) {
        if (binding.kind === "uniform" && binding.source === "object") {
          entries.push({ binding: binding.binding, resource: { buffer: item.objectBuffer } });
        }
        if (binding.kind === "uniform" && binding.source === "material") {
          entries.push({ binding: binding.binding, resource: { buffer: item.materialBuffer } });
        }
        if (binding.kind === "texture" && binding.source === "material.baseColorTexture") {
          entries.push({ binding: binding.binding, resource: item.material.baseColorTexture!.createView() });
        }
        if (binding.kind === "texture" && binding.source === "material.normalTexture") {
          entries.push({ binding: binding.binding, resource: item.material.normalTexture!.createView() });
        }
        if (binding.kind === "sampler" && binding.source === "material.sampler") {
          entries.push({ binding: binding.binding, resource: item.material.sampler! });
        }
      }
      if (entries.length) {
        item.bindGroups.set(
          pass.spec.name,
          ctx.device.createBindGroup({
            label: `${item.sceneMesh.name} ${pass.spec.name} Graph Object Group`,
            layout: pass.layouts[objectGroup],
            entries,
          }),
        );
      }
    }
  }

  private textureOrThrow(id: string): RuntimeTexture {
    const texture = this.textures.get(id);
    if (!texture) {
      throw new Error(`Graph texture not found: ${id}`);
    }
    return texture;
  }

  private textureFormatOrThrow(id: string, screenFormat: GPUTextureFormat): GPUTextureFormat {
    const spec = this.spec.resources[id];
    if (!spec || (spec.kind !== "texture2d" && spec.kind !== "depthTexture")) {
      throw new Error(`Graph pass references missing texture resource: ${id}`);
    }
    if (spec.kind === "texture2d" && spec.format === "screen") {
      return screenFormat;
    }
    return resolveResourceFormat(spec, screenFormat);
  }

  private registerDebugTextures(ctx: LabContext) {
    for (const texture of this.textures.values()) {
      if (!texture.spec.debug) {
        continue;
      }
      ctx.debug.addTexture({
        id: `${this.id}-${texture.id}`,
        label: texture.spec.label ?? texture.id,
        texture: texture.texture,
        width: texture.width,
        height: texture.height,
        format: texture.format === "depth32float" ? "depth32float" : texture.format === "bgra8unorm" ? "bgra8unorm" : "rgba8unorm",
      });
    }
  }

  private destroyTextures() {
    for (const texture of this.textures.values()) {
      texture.texture.destroy();
    }
    this.textures.clear();
  }
}

function createMountedGraphRoot(ctx: LabContext) {
  const root = document.createElement("div");
  root.className = "graph-mount";
  ctx.gui.mount(root);
  return root;
}

function createTextures(ctx: LabContext, spec: GraphLabSpec): Map<string, RuntimeTexture> {
  const textures = new Map<string, RuntimeTexture>();
  for (const [id, resource] of Object.entries(spec.resources)) {
    if (resource.kind === "sampler") {
      continue;
    }
    const [width, height] = resolveTextureSize(resource.size ?? "canvas", ctx);
    const format = resolveResourceFormat(resource, ctx.format);
    const usage = resourceUsageToGpu(resource);
    textures.set(id, {
      id,
      spec: resource,
      width,
      height,
      format,
      texture: ctx.device.createTexture({
        label: resource.label ?? id,
        size: [width, height],
        format,
        usage,
      }),
    });
  }
  return textures;
}

function createMaterialInstances(spec: GraphLabSpec, scene: ScenePreset) {
  const materials = new Map<string, GraphMaterialInstance>();
  for (const material of spec.materialInstances ?? []) {
    materials.set(material.id, material);
  }
  for (const sceneMaterial of scene.materials) {
    if (!materials.has(sceneMaterial.id)) {
      materials.set(sceneMaterial.id, {
        id: sceneMaterial.id,
        name: sceneMaterial.name,
        baseColor: sceneMaterial.baseColor,
        metallic: sceneMaterial.metallic ?? 0,
        roughness: sceneMaterial.roughness ?? 0.5,
        textures: {
          baseColorTexture: sceneMaterial.baseColorTexture ?? "/assets/builtin/textures/white.png",
          normalTexture: sceneMaterial.normalTexture ?? "/assets/builtin/textures/flat-normal.png",
        },
      });
    }
  }
  return materials;
}

async function createRuntimeMaterial(
  ctx: LabContext,
  sceneMesh: SceneMesh,
  sceneMaterial: SceneMaterial,
  materialInstances: Map<string, GraphMaterialInstance>,
  assignments: Record<string, string>,
): Promise<RuntimeMaterial> {
  const materialId = assignments[sceneMesh.id] ?? sceneMesh.material;
  const material = materialInstances.get(materialId) ?? materialInstances.get(sceneMesh.material) ?? {
    id: sceneMaterial.id,
    name: sceneMaterial.name,
    baseColor: sceneMaterial.baseColor,
    metallic: sceneMaterial.metallic ?? 0,
    roughness: sceneMaterial.roughness ?? 0.5,
    textures: {
      baseColorTexture: sceneMaterial.baseColorTexture ?? "/assets/builtin/textures/white.png",
      normalTexture: sceneMaterial.normalTexture ?? "/assets/builtin/textures/flat-normal.png",
    },
  };
  const runtime: RuntimeMaterial = {
    ...material,
    textures: { ...material.textures },
    fallbackSceneMaterial: sceneMaterial,
    sampler: ctx.device.createSampler({
      label: `${sceneMesh.name} Material Sampler`,
      magFilter: "linear",
      minFilter: "linear",
    }),
  };
  runtime.baseColorTexture = await loadTexture2D(
    ctx.device,
    runtime.textures?.baseColorTexture ?? "/assets/builtin/textures/white.png",
    `${sceneMesh.name} Base Color Texture`,
  );
  runtime.normalTexture = await loadTexture2D(
    ctx.device,
    runtime.textures?.normalTexture ?? "/assets/builtin/textures/flat-normal.png",
    `${sceneMesh.name} Normal Texture`,
  );
  return runtime;
}

async function loadTexture2D(device: GPUDevice, url: string, label: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load material texture: ${url}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  const texture = device.createTexture({
    label,
    size: [bitmap.width, bitmap.height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
  bitmap.close();
  return texture;
}

function resolveResourceFormat(
  resource: Extract<GraphResourceSpec, { kind: "texture2d" | "depthTexture" }>,
  screenFormat: GPUTextureFormat,
): GPUTextureFormat {
  if (resource.kind === "depthTexture") {
    return resource.format ?? "depth24plus";
  }
  if (resource.format === "screen" || !resource.format) {
    return screenFormat;
  }
  return resource.format;
}

function createSamplers(ctx: LabContext, spec: GraphLabSpec): Map<string, RuntimeSampler> {
  const samplers = new Map<string, RuntimeSampler>();
  for (const [id, resource] of Object.entries(spec.resources)) {
    if (resource.kind !== "sampler") {
      continue;
    }
    samplers.set(id, {
      id,
      spec: resource,
      sampler: ctx.device.createSampler({
        label: resource.label ?? id,
        magFilter: resource.type === "filtering" ? "linear" : "nearest",
        minFilter: resource.type === "filtering" ? "linear" : "nearest",
        compare: resource.type === "comparison" ? "less" : undefined,
      }),
    });
  }
  return samplers;
}

function resourceUsageToGpu(resource: Extract<GraphResourceSpec, { kind: "texture2d" | "depthTexture" }>) {
  const requested = resource.usage ?? (resource.kind === "texture2d" ? ["render", "sample", "copySrc", "copyDst"] : ["render"]);
  let usage = 0;
  if (requested.includes("render")) usage |= GPUTextureUsage.RENDER_ATTACHMENT;
  if (requested.includes("sample")) usage |= GPUTextureUsage.TEXTURE_BINDING;
  if (requested.includes("copySrc")) usage |= GPUTextureUsage.COPY_SRC;
  if (requested.includes("copyDst")) usage |= GPUTextureUsage.COPY_DST;
  return usage;
}

function resolveTextureSize(size: "canvas" | [number, number], ctx: LabContext): [number, number] {
  if (size === "canvas") {
    return [ctx.canvas.width, ctx.canvas.height];
  }
  return size;
}

function buildBindGroupLayouts(device: GPUDevice, bindings: GraphBinding[], label: string): GPUBindGroupLayout[] {
  if (!bindings.length) {
    return [];
  }

  assertUniqueBindings(bindings);
  const maxGroup = Math.max(...bindings.map((binding) => binding.group));
  const layouts: GPUBindGroupLayout[] = [];

  for (let group = 0; group <= maxGroup; group += 1) {
    const entries = bindings.filter((binding) => binding.group === group).map(toLayoutEntry);
    layouts[group] = device.createBindGroupLayout({
      label: `${label} Group ${group}`,
      entries,
    });
  }
  return layouts;
}

function toLayoutEntry(binding: GraphBinding): GPUBindGroupLayoutEntry {
  if (binding.kind === "uniform") {
    return {
      binding: binding.binding,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    };
  }
  if (binding.kind === "sampler") {
    return {
      binding: binding.binding,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: binding.source === "material.sampler" ? "filtering" : (binding.type ?? "filtering") },
    };
  }
  return {
    binding: binding.binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: binding.sampleType ?? "float" },
  };
}

function createUniformBuffers(ctx: LabContext, pass: CompiledPass, bindings: GraphBinding[]) {
  if (bindings.some((binding) => binding.kind === "uniform" && binding.source === "frame")) {
    pass.frameBuffer = ctx.device.createBuffer({
      label: `${pass.spec.name} Graph Frame Uniforms`,
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }
  if (bindings.some((binding) => binding.kind === "uniform" && binding.source === "params")) {
    pass.paramsBuffer = ctx.device.createBuffer({
      label: `${pass.spec.name} Graph Params Uniforms`,
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }
}

function createPassBindGroups(
  ctx: LabContext,
  pass: CompiledPass,
  bindings: GraphBinding[],
  textures: Map<string, RuntimeTexture>,
  samplers: Map<string, RuntimeSampler>,
) {
  const objectGroup = getObjectGroup(bindings);
  const groups = [...new Set(bindings.map((binding) => binding.group))].filter((group) => group !== objectGroup);
  for (const group of groups) {
    const entries: GPUBindGroupEntry[] = [];
    for (const binding of bindings.filter((entry) => entry.group === group)) {
      if (binding.kind === "uniform" && binding.source === "frame" && pass.frameBuffer) {
        entries.push({ binding: binding.binding, resource: { buffer: pass.frameBuffer } });
      }
      if (binding.kind === "uniform" && binding.source === "params" && pass.paramsBuffer) {
        entries.push({ binding: binding.binding, resource: { buffer: pass.paramsBuffer } });
      }
      if (binding.kind === "texture") {
        if (binding.source.startsWith("material.")) {
          continue;
        }
        const texture = textures.get(binding.source);
        if (!texture) throw new Error(`Missing texture binding source: ${binding.source}`);
        entries.push({ binding: binding.binding, resource: texture.texture.createView() });
      }
      if (binding.kind === "sampler") {
        if (binding.source.startsWith("material.")) {
          continue;
        }
        const sampler = samplers.get(binding.source);
        if (!sampler) throw new Error(`Missing sampler binding source: ${binding.source}`);
        entries.push({ binding: binding.binding, resource: sampler.sampler });
      }
    }
    if (entries.length) {
      pass.passBindGroups.set(
        group,
        ctx.device.createBindGroup({
          label: `${pass.spec.name} Graph Group ${group}`,
          layout: pass.layouts[group],
          entries,
        }),
      );
    }
  }
}

function setPassBindGroups(renderPass: GPURenderPassEncoder, pass: CompiledPass) {
  for (const [group, bindGroup] of pass.passBindGroups) {
    renderPass.setBindGroup(group, bindGroup);
  }
}

function getObjectGroup(bindings: GraphBinding[]) {
  const binding = bindings.find(
    (entry) =>
      (entry.kind === "uniform" && (entry.source === "object" || entry.source === "material")) ||
      entry.source.startsWith("material."),
  );
  return binding?.group ?? -1;
}

function meshVertexLayout(): GPUVertexBufferLayout {
  return {
    arrayStride: 32,
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" },
      { shaderLocation: 1, offset: 12, format: "float32x3" },
      { shaderLocation: 2, offset: 24, format: "float32x2" },
    ],
  };
}

function toClearValue(spec: GraphResourceSpec, bg: [number, number, number]) {
  if (spec.kind === "texture2d" && spec.clear) {
    return { r: spec.clear[0], g: spec.clear[1], b: spec.clear[2], a: spec.clear[3] };
  }
  return { r: bg[0], g: bg[1], b: bg[2], a: 1 };
}

function createGraphViewModel(spec: GraphLabSpec): GraphViewModel {
  const nodes: GraphNodeInfo[] = Object.entries(spec.resources).map(([id, resource]) => ({
    id: `resource:${id}`,
    kind: "resource" as const,
    title: id,
    subtitle: resource.kind,
    details: resourceDetails(id, resource, spec),
  }));

  for (const pass of spec.passes) {
    nodes.push({
      id: `pass:${pass.name}`,
      kind: "pass",
      title: pass.name,
      subtitle: pass.type,
      enabled: pass.enabled !== false,
      details: passDetails(pass),
    });
  }

  nodes.push({
    id: "output:screen",
    kind: "output",
    title: "Screen",
    subtitle: spec.output,
    details: [["Output resource", spec.output]],
  });

  const edges: GraphEdgeInfo[] = [];
  for (const pass of spec.passes) {
    for (const read of pass.reads ?? []) {
      edges.push({ from: `resource:${read}`, to: `pass:${pass.name}`, label: "read" });
    }
    edges.push({ from: `pass:${pass.name}`, to: `resource:${pass.color}`, label: "write" });
    if (pass.type === "mesh" && pass.depth) {
      edges.push({ from: `pass:${pass.name}`, to: `resource:${pass.depth}`, label: "depth" });
    }
  }
  edges.push({ from: `resource:${spec.output}`, to: "output:screen", label: "copy" });
  return { nodes, edges };
}

function resourceDetails(id: string, resource: GraphResourceSpec, spec: GraphLabSpec): Array<[string, string]> {
  const readers = spec.passes.filter((pass) => (pass.reads ?? []).includes(id)).map((pass) => pass.name);
  const writers = spec.passes.filter((pass) => pass.color === id || (pass.type === "mesh" && pass.depth === id)).map((pass) => pass.name);
  return [
    ["Kind", resource.kind],
    ["Format", resource.kind === "texture2d" ? String(resource.format ?? "screen") : resource.kind === "depthTexture" ? String(resource.format ?? "depth24plus") : "-"],
    ["Size", resource.kind === "sampler" ? "-" : String(resource.size ?? "canvas")],
    ["Debug View", resource.kind !== "sampler" && resource.debug ? "yes" : "no"],
    ["Readers", readers.length ? readers.join(", ") : "-"],
    ["Writers", writers.length ? writers.join(", ") : "-"],
  ];
}

function passDetails(pass: GraphPassSpec): Array<[string, string]> {
  return [
    ["Type", pass.type],
    ["Shader", pass.shader],
    ["Color", pass.color],
    ["Depth", pass.type === "mesh" ? (pass.depth ?? "-") : "-"],
    ["Reads", (pass.reads ?? []).join(", ") || "-"],
    ["Bindings", (pass.bindings ?? []).map((binding) => `${binding.group}:${binding.binding} ${binding.kind} ${binding.source}`).join(", ") || "-"],
    ["Enabled", pass.enabled === false ? "no" : "yes"],
  ];
}

function validateGraph(spec: GraphLabSpec) {
  const resourceIds = new Set(Object.keys(spec.resources));
  if (!resourceIds.has(spec.output)) {
    throw new Error(`Graph output resource is missing: ${spec.output}`);
  }
  for (const pass of spec.passes) {
    if (!resourceIds.has(pass.color)) {
      throw new Error(`Graph pass ${pass.name} writes missing color resource: ${pass.color}`);
    }
    if (pass.type === "mesh" && pass.depth && !resourceIds.has(pass.depth)) {
      throw new Error(`Graph pass ${pass.name} writes missing depth resource: ${pass.depth}`);
    }
    for (const read of pass.reads ?? []) {
      if (!resourceIds.has(read)) {
        throw new Error(`Graph pass ${pass.name} reads missing resource: ${read}`);
      }
    }
    for (const binding of pass.bindings ?? []) {
      if (
        (binding.kind === "texture" || binding.kind === "sampler") &&
        !binding.source.startsWith("material.") &&
        !resourceIds.has(binding.source)
      ) {
        throw new Error(`Graph pass ${pass.name} binding references missing resource: ${binding.source}`);
      }
    }
  }
}

function assertUniqueBindings(bindings: GraphBinding[]) {
  const seen = new Set<string>();
  for (const binding of bindings) {
    const key = `${binding.group}:${binding.binding}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate graph binding: group ${binding.group}, binding ${binding.binding}`);
    }
    seen.add(key);
  }
}

async function loadShader(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load shader: ${url}`);
  }
  return response.text();
}
