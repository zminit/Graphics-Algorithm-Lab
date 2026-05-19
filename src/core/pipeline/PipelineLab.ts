import type { SceneMaterial, SceneMesh, ScenePreset } from "../assets/ScenePreset";
import type { Lab, LabContext } from "../lab/Lab";
import { composeTransform, identity4, multiply4, type Mat4 } from "../math/Mat4";
import { createGPUMesh, destroyGPUMesh, type GPUMesh } from "../renderer/GPUMesh";
import {
  createParamState,
  packParams,
  toGuiParam,
  type PipelineParamSpecs,
  type PipelineParamState,
} from "./PipelineParams";

export type BindingSource = "frame" | "object" | "material" | "params";

export type PipelineBinding =
  | {
      kind: "uniform";
      group: number;
      binding: number;
      source: BindingSource;
    }
  | {
      kind: "sampler";
      group: number;
      binding: number;
      type: "filtering" | "comparison";
    }
  | {
      kind: "texture";
      group: number;
      binding: number;
      source: string;
      sampleType: "float" | "depth";
    };

export type MeshPassSpec = {
  type: "mesh";
  name: string;
  shader: string;
  bindings?: "default" | PipelineBinding[];
  camera?: "main";
  color?: "screen";
  depth?: "auto";
  cullMode?: GPUCullMode;
};

export type PipelineLabSpec = {
  id: string;
  name: string;
  description?: string;
  scene: string;
  params?: PipelineParamSpecs;
  passes: MeshPassSpec[];
};

type RenderItem = {
  sceneMesh: SceneMesh;
  material: SceneMaterial;
  gpuMesh: GPUMesh;
  modelMatrix: Mat4;
  objectBuffer: GPUBuffer;
  materialBuffer: GPUBuffer;
  bindGroups: Map<number, GPUBindGroup>;
};

type CompiledPass = {
  spec: MeshPassSpec;
  pipeline: GPURenderPipeline;
  frameBuffer?: GPUBuffer;
  paramsBuffer?: GPUBuffer;
  bindGroups: Map<number, GPUBindGroup>;
};

export function definePipelineLab(spec: PipelineLabSpec): Lab {
  return new PipelineLabRunner(spec);
}

export function meshPass(spec: Omit<MeshPassSpec, "type">): MeshPassSpec {
  return {
    type: "mesh",
    camera: "main",
    color: "screen",
    depth: "auto",
    bindings: "default",
    cullMode: "back",
    ...spec,
  };
}

export function uniform(
  _name: string,
  options: { group: number; binding: number; source: BindingSource },
): PipelineBinding {
  return { kind: "uniform", ...options };
}

class PipelineLabRunner implements Lab {
  id: string;
  name: string;
  category = "rendering" as const;
  description?: string;

  private scene?: ScenePreset;
  private colorTexture?: GPUTexture;
  private depthTexture?: GPUTexture;
  private renderItems: RenderItem[] = [];
  private passes: CompiledPass[] = [];
  private paramState: PipelineParamState;

  constructor(private readonly spec: PipelineLabSpec) {
    this.id = spec.id;
    this.name = spec.name;
    this.description = spec.description;
    this.paramState = createParamState(spec.params ?? {});
  }

  async setup(ctx: LabContext) {
    this.scene = await ctx.assets.loadScene(this.spec.scene);
    ctx.camera.lookAt(this.scene.camera.position, this.scene.camera.target);
    ctx.camera.setPerspective(this.scene.camera.fovYDegrees, this.scene.camera.near, this.scene.camera.far);

    for (const [name, paramSpec] of Object.entries(this.spec.params ?? {})) {
      ctx.gui.add(name, toGuiParam(name, paramSpec, this.paramState));
    }

    await this.loadSceneMeshes(ctx);
    await this.compilePasses(ctx);
    this.resize(ctx);
  }

  resize(ctx: LabContext) {
    this.colorTexture?.destroy();
    this.depthTexture?.destroy();
    this.colorTexture = ctx.device.createTexture({
      label: `${this.name} Color`,
      size: [ctx.canvas.width, ctx.canvas.height],
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthTexture = ctx.device.createTexture({
      label: `${this.name} Depth`,
      size: [ctx.canvas.width, ctx.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    ctx.debug.addTexture({
      id: `${this.id}-color`,
      label: `${this.name} Color`,
      texture: this.colorTexture,
      width: ctx.canvas.width,
      height: ctx.canvas.height,
      format: ctx.format === "bgra8unorm" ? "bgra8unorm" : "rgba8unorm",
    });
  }

  update(ctx: LabContext) {
    const packedParams = packParams(this.spec.params ?? {}, this.paramState);

    for (const pass of this.passes) {
      if (pass.frameBuffer) {
        const frameData = new Float32Array(36);
        frameData.set(ctx.camera.viewProjectionMatrix, 0);
        frameData.set([ctx.canvas.width, ctx.canvas.height, ctx.time.elapsed, ctx.time.deltaTime], 32);
        ctx.device.queue.writeBuffer(pass.frameBuffer, 0, new Float32Array(frameData));
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

      const materialData = new Float32Array(8);
      materialData.set(item.material.baseColor, 0);
      materialData.set([item.material.metallic ?? 0, item.material.roughness ?? 0.5, 0, 0], 4);
      ctx.device.queue.writeBuffer(item.materialBuffer, 0, materialData);
    }
  }

  render(ctx: LabContext) {
    if (!this.colorTexture || !this.depthTexture || !this.scene) {
      return;
    }

    const commandEncoder = ctx.device.createCommandEncoder({ label: `${this.name} Encoder` });
    const bg = this.scene.environment?.color ?? [0.03, 0.04, 0.05];

    for (const pass of this.passes) {
      const renderPass = commandEncoder.beginRenderPass({
        label: pass.spec.name,
        colorAttachments: [
          {
            view: this.colorTexture.createView(),
            clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: this.depthTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      renderPass.setPipeline(pass.pipeline);

      for (const [group, bindGroup] of pass.bindGroups) {
        renderPass.setBindGroup(group, bindGroup);
      }

      for (const item of this.renderItems) {
        for (const [group, bindGroup] of item.bindGroups) {
          renderPass.setBindGroup(group, bindGroup);
        }
        renderPass.setVertexBuffer(0, item.gpuMesh.vertexBuffer);
        renderPass.setIndexBuffer(item.gpuMesh.indexBuffer, item.gpuMesh.indexFormat);
        renderPass.drawIndexed(item.gpuMesh.indexCount);
      }

      renderPass.end();
    }

    commandEncoder.copyTextureToTexture(
      { texture: this.colorTexture },
      { texture: ctx.context.getCurrentTexture() },
      { width: ctx.canvas.width, height: ctx.canvas.height },
    );
    ctx.device.queue.submit([commandEncoder.finish()]);
  }

  dispose() {
    this.colorTexture?.destroy();
    this.depthTexture?.destroy();
    this.colorTexture = undefined;
    this.depthTexture = undefined;

    for (const item of this.renderItems) {
      destroyGPUMesh(item.gpuMesh);
      item.objectBuffer.destroy();
      item.materialBuffer.destroy();
    }
    this.renderItems = [];
    this.passes = [];
  }

  private async loadSceneMeshes(ctx: LabContext) {
    if (!this.scene) {
      return;
    }

    const materials = new Map(this.scene.materials.map((material) => [material.id, material]));

    for (const sceneMesh of this.scene.meshes) {
      const material = materials.get(sceneMesh.material);
      if (!material) {
        throw new Error(`Missing material: ${sceneMesh.material}`);
      }

      const cpuMesh = (await ctx.assets.loadGLB(sceneMesh.model))[0];
      if (!cpuMesh) {
        throw new Error(`Model has no mesh: ${sceneMesh.model}`);
      }

      this.renderItems.push({
        sceneMesh,
        material,
        gpuMesh: createGPUMesh(ctx.device, cpuMesh),
        modelMatrix: composeTransform(sceneMesh.position ?? [0, 0, 0], sceneMesh.rotation ?? [0, 0, 0], sceneMesh.scale ?? [1, 1, 1]),
        objectBuffer: ctx.device.createBuffer({
          label: `${sceneMesh.name} Pipeline Object`,
          size: 128,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        materialBuffer: ctx.device.createBuffer({
          label: `${sceneMesh.name} Pipeline Material`,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        bindGroups: new Map(),
      });
    }
  }

  private async compilePasses(ctx: LabContext) {
    this.passes = [];

    for (const passSpec of this.spec.passes) {
      const bindings = passSpec.bindings === "default" || !passSpec.bindings ? defaultBindings() : passSpec.bindings;
      assertSupportedBindings(bindings);
      const shader = ctx.device.createShaderModule({
        label: `${this.name} ${passSpec.name} Shader`,
        code: await loadShader(passSpec.shader),
      });
      const bindGroupLayouts = buildBindGroupLayouts(ctx.device, bindings, `${this.name} ${passSpec.name}`);
      const pipelineLayout = ctx.device.createPipelineLayout({
        label: `${this.name} ${passSpec.name} Layout`,
        bindGroupLayouts,
      });
      const pipeline = ctx.device.createRenderPipeline({
        label: `${this.name} ${passSpec.name} Pipeline`,
        layout: pipelineLayout,
        vertex: {
          module: shader,
          entryPoint: "vertexMain",
          buffers: [
            {
              arrayStride: 32,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x3" },
                { shaderLocation: 2, offset: 24, format: "float32x2" },
              ],
            },
          ],
        },
        fragment: {
          module: shader,
          entryPoint: "fragmentMain",
          targets: [{ format: ctx.format }],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: passSpec.cullMode ?? "back",
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
      const compiledPass: CompiledPass = {
        spec: passSpec,
        pipeline,
        bindGroups: new Map(),
      };
      createPassResources(ctx, compiledPass, bindings, bindGroupLayouts);
      this.createObjectBindGroups(ctx, bindings, bindGroupLayouts);
      this.passes.push(compiledPass);
    }
  }

  private createObjectBindGroups(ctx: LabContext, bindings: PipelineBinding[], layouts: GPUBindGroupLayout[]) {
    for (const item of this.renderItems) {
      for (const group of getGroupsForSources(bindings, ["object", "material"])) {
        const entries: GPUBindGroupEntry[] = [];
        for (const binding of bindings.filter((entry) => entry.group === group)) {
          if (binding.kind !== "uniform") continue;
          if (binding.source === "object") {
            entries.push({ binding: binding.binding, resource: { buffer: item.objectBuffer } });
          }
          if (binding.source === "material") {
            entries.push({ binding: binding.binding, resource: { buffer: item.materialBuffer } });
          }
        }
        if (entries.length) {
          item.bindGroups.set(
            group,
            ctx.device.createBindGroup({
              label: `${item.sceneMesh.name} Pipeline Group ${group}`,
              layout: layouts[group],
              entries,
            }),
          );
        }
      }
    }
  }
}

function defaultBindings(): PipelineBinding[] {
  return [
    { kind: "uniform", group: 0, binding: 0, source: "frame" },
    { kind: "uniform", group: 0, binding: 1, source: "params" },
    { kind: "uniform", group: 1, binding: 0, source: "object" },
    { kind: "uniform", group: 1, binding: 1, source: "material" },
  ];
}

function buildBindGroupLayouts(device: GPUDevice, bindings: PipelineBinding[], label: string): GPUBindGroupLayout[] {
  const maxGroup = Math.max(...bindings.map((binding) => binding.group));
  const layouts: GPUBindGroupLayout[] = [];

  for (let group = 0; group <= maxGroup; group += 1) {
    const groupBindings = bindings.filter((binding) => binding.group === group);
    layouts[group] = device.createBindGroupLayout({
      label: `${label} Group ${group}`,
      entries: groupBindings.map(toLayoutEntry),
    });
  }

  return layouts;
}

function toLayoutEntry(binding: PipelineBinding): GPUBindGroupLayoutEntry {
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
      sampler: { type: binding.type === "comparison" ? "comparison" : "filtering" },
    };
  }

  return {
    binding: binding.binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: binding.sampleType === "depth" ? "depth" : "float" },
  };
}

function createPassResources(
  ctx: LabContext,
  pass: CompiledPass,
  bindings: PipelineBinding[],
  layouts: GPUBindGroupLayout[],
) {
  const frameBinding = bindings.find((binding) => binding.kind === "uniform" && binding.source === "frame");
  const paramsBinding = bindings.find((binding) => binding.kind === "uniform" && binding.source === "params");

  if (frameBinding) {
    pass.frameBuffer = ctx.device.createBuffer({
      label: `${pass.spec.name} Frame Uniforms`,
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }
  if (paramsBinding) {
    pass.paramsBuffer = ctx.device.createBuffer({
      label: `${pass.spec.name} Params Uniforms`,
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  for (const group of getGroupsForSources(bindings, ["frame", "params"])) {
    const entries: GPUBindGroupEntry[] = [];
    for (const binding of bindings.filter((entry) => entry.group === group)) {
      if (binding.kind !== "uniform") continue;
      if (binding.source === "frame" && pass.frameBuffer) {
        entries.push({ binding: binding.binding, resource: { buffer: pass.frameBuffer } });
      }
      if (binding.source === "params" && pass.paramsBuffer) {
        entries.push({ binding: binding.binding, resource: { buffer: pass.paramsBuffer } });
      }
    }
    if (entries.length) {
      pass.bindGroups.set(
        group,
        ctx.device.createBindGroup({
          label: `${pass.spec.name} Pipeline Group ${group}`,
          layout: layouts[group],
          entries,
        }),
      );
    }
  }
}

function getGroupsForSources(bindings: PipelineBinding[], sources: BindingSource[]) {
  return [...new Set(bindings.filter((binding) => binding.kind === "uniform" && sources.includes(binding.source)).map((binding) => binding.group))];
}

function assertSupportedBindings(bindings: PipelineBinding[]) {
  const seen = new Set<string>();
  for (const binding of bindings) {
    const key = `${binding.group}:${binding.binding}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate pipeline binding: group ${binding.group}, binding ${binding.binding}`);
    }
    seen.add(key);
    if (binding.kind !== "uniform") {
      throw new Error("Pipeline Lab v1 only supports custom uniform bindings. Texture and sampler bindings are reserved for Phase B.");
    }
  }
}

async function loadShader(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load shader: ${url}`);
  }
  return response.text();
}

export const identity = identity4;
