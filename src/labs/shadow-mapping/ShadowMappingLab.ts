import { BuiltinAssets } from "../../core/assets/BuiltinAssets";
import type { SceneMaterial, SceneMesh, ScenePreset } from "../../core/assets/ScenePreset";
import type { Lab, LabContext } from "../../core/lab/Lab";
import { composeTransform, lookAt4, multiply4, orthographic4, type Mat4 } from "../../core/math/Mat4";
import { add3, normalize3, scale3, type Vec3 } from "../../core/math/Vec3";
import { createGPUMesh, destroyGPUMesh, type GPUMesh } from "../../core/renderer/GPUMesh";

const depthShader = /* wgsl */ `
struct DepthObject {
  lightModelViewProjection: mat4x4f,
};

struct VertexInput {
  @location(0) position: vec3f,
};

@group(0) @binding(0) var<uniform> object: DepthObject;

@vertex
fn vertexMain(input: VertexInput) -> @builtin(position) vec4f {
  return object.lightModelViewProjection * vec4f(input.position, 1.0);
}
`;

const shadowShader = /* wgsl */ `
struct FrameUniforms {
  viewProjection: mat4x4f,
  lightViewProjection: mat4x4f,
  lightDirection: vec4f,
  lightColor: vec4f,
  params: vec4f,
};

struct ObjectUniforms {
  model: mat4x4f,
  modelViewProjection: mat4x4f,
  lightModelViewProjection: mat4x4f,
  baseColor: vec4f,
};

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec4f,
  @location(2) shadowPosition: vec4f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var shadowSampler: sampler_comparison;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(input.position, 1.0);
  output.normal = normalize((object.model * vec4f(input.normal, 0.0)).xyz);
  output.color = object.baseColor;
  output.shadowPosition = object.lightModelViewProjection * vec4f(input.position, 1.0);
  return output;
}

fn computeShadow(shadowPosition: vec4f) -> f32 {
  let projected = shadowPosition.xyz / shadowPosition.w;
  let uv = projected.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || projected.z < 0.0 || projected.z > 1.0) {
    return 1.0;
  }

  return textureSampleCompare(shadowMap, shadowSampler, uv, projected.z - frame.params.z);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let n = normalize(input.normal);
  let l = normalize(-frame.lightDirection.xyz);
  let ndotl = max(dot(n, l), 0.0);
  let shadow = mix(1.0, computeShadow(input.shadowPosition), frame.params.w);
  let ambient = frame.params.x;
  let lit = input.color.rgb * (ambient + ndotl * frame.lightColor.rgb * shadow);
  return vec4f(lit, input.color.a);
}
`;

type RenderItem = {
  sceneMesh: SceneMesh;
  material: SceneMaterial;
  gpuMesh: GPUMesh;
  modelMatrix: Mat4;
  depthObjectBuffer: GPUBuffer;
  depthBindGroup: GPUBindGroup;
  objectBuffer: GPUBuffer;
  objectBindGroup: GPUBindGroup;
};

export class ShadowMappingLab implements Lab {
  id = "shadow-mapping";
  name = "Shadow Mapping";
  category = "rendering" as const;
  description = "Hard shadow mapping with adjustable bias, frustum size, resolution, and shadow map debug view.";

  private scene?: ScenePreset;
  private depthPipeline?: GPURenderPipeline;
  private shadowPipeline?: GPURenderPipeline;
  private frameBuffer?: GPUBuffer;
  private frameBindGroup?: GPUBindGroup;
  private shadowSampler?: GPUSampler;
  private colorTexture?: GPUTexture;
  private depthTexture?: GPUTexture;
  private shadowDepthTexture?: GPUTexture;
  private renderItems: RenderItem[] = [];
  private lightViewProjection = orthographic4(-3, 3, -3, 3, 0.1, 20);
  private currentShadowResolution = 0;
  private readonly params = {
    background: [0.03, 0.04, 0.05] as [number, number, number],
    ambient: 0.2,
    bias: 0.0025,
    lightIntensity: 1,
    shadowEnabled: true,
    shadowResolution: "1024",
    lightDistance: 8,
    lightFrustumSize: 6,
  };

  async setup(ctx: LabContext) {
    this.scene = await ctx.assets.loadScene(BuiltinAssets.scenes.shadowTest);
    ctx.camera.lookAt(this.scene.camera.position, this.scene.camera.target);
    ctx.camera.setPerspective(this.scene.camera.fovYDegrees, this.scene.camera.near, this.scene.camera.far);
    this.params.background = [...(this.scene.environment?.color ?? this.params.background)];
    this.registerParams(ctx);

    this.frameBuffer = ctx.device.createBuffer({
      label: "Shadow Mapping Frame Uniforms",
      size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.depthPipeline = ctx.device.createRenderPipeline({
      label: "Shadow Mapping Depth Pipeline",
      layout: "auto",
      vertex: {
        module: ctx.device.createShaderModule({ label: "Shadow Depth Shader", code: depthShader }),
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 32,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    const shadowModule = ctx.device.createShaderModule({ label: "Shadow Resolve Shader", code: shadowShader });
    this.shadowPipeline = ctx.device.createRenderPipeline({
      label: "Shadow Mapping Main Pipeline",
      layout: "auto",
      vertex: {
        module: shadowModule,
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
        module: shadowModule,
        entryPoint: "fragmentMain",
        targets: [{ format: ctx.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    this.shadowSampler = ctx.device.createSampler({
      label: "Shadow Comparison Sampler",
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
    });

    this.createShadowResources(ctx);
    await this.loadSceneMeshes(ctx);
    this.resize(ctx);
  }

  resize(ctx: LabContext) {
    this.colorTexture?.destroy();
    this.depthTexture?.destroy();
    this.colorTexture = ctx.device.createTexture({
      label: "Shadow Mapping Color Texture",
      size: [ctx.canvas.width, ctx.canvas.height],
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthTexture = ctx.device.createTexture({
      label: "Shadow Mapping Camera Depth",
      size: [ctx.canvas.width, ctx.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    ctx.debug.addTexture({
      id: "shadow-main-color",
      label: "Main Color",
      texture: this.colorTexture,
      width: ctx.canvas.width,
      height: ctx.canvas.height,
      format: ctx.format === "bgra8unorm" ? "bgra8unorm" : "rgba8unorm",
    });
  }

  update(ctx: LabContext) {
    if (!this.scene || !this.frameBuffer) {
      return;
    }

    const nextResolution = Number(this.params.shadowResolution);
    if (nextResolution !== this.currentShadowResolution) {
      this.createShadowResources(ctx);
    }

    const directional = this.scene.lights.find((light) => light.type === "directional");
    const lightDirection = normalize3(directional?.direction ?? [-0.55, -1, -0.35]);
    const lightColor = directional?.color ?? [1, 0.94, 0.86];
    const lightIntensity = (directional?.intensity ?? 1) * this.params.lightIntensity;
    this.lightViewProjection = this.computeLightViewProjection(lightDirection);

    const frameUniforms = new Float32Array(44);
    frameUniforms.set(ctx.camera.viewProjectionMatrix, 0);
    frameUniforms.set(this.lightViewProjection, 16);
    frameUniforms.set([lightDirection[0], lightDirection[1], lightDirection[2], 0], 32);
    frameUniforms.set([lightColor[0] * lightIntensity, lightColor[1] * lightIntensity, lightColor[2] * lightIntensity, 1], 36);
    frameUniforms.set([this.params.ambient, 0, this.params.bias, this.params.shadowEnabled ? 1 : 0], 40);
    ctx.device.queue.writeBuffer(this.frameBuffer, 0, frameUniforms);

    for (const item of this.renderItems) {
      const modelViewProjection = multiply4(ctx.camera.viewProjectionMatrix, item.modelMatrix);
      const lightModelViewProjection = multiply4(this.lightViewProjection, item.modelMatrix);
      const objectUniforms = new Float32Array(52);
      objectUniforms.set(item.modelMatrix, 0);
      objectUniforms.set(modelViewProjection, 16);
      objectUniforms.set(lightModelViewProjection, 32);
      objectUniforms.set(item.material.baseColor, 48);
      ctx.device.queue.writeBuffer(item.objectBuffer, 0, objectUniforms);
      ctx.device.queue.writeBuffer(item.depthObjectBuffer, 0, new Float32Array(lightModelViewProjection));
    }
  }

  render(ctx: LabContext) {
    if (
      !this.scene ||
      !this.depthPipeline ||
      !this.shadowPipeline ||
      !this.frameBindGroup ||
      !this.colorTexture ||
      !this.depthTexture ||
      !this.shadowDepthTexture
    ) {
      return;
    }

    const bg = this.params.background;
    const commandEncoder = ctx.device.createCommandEncoder();
    const shadowPass = commandEncoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowDepthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    shadowPass.setPipeline(this.depthPipeline);
    for (const item of this.renderItems) {
      shadowPass.setBindGroup(0, item.depthBindGroup);
      shadowPass.setVertexBuffer(0, item.gpuMesh.vertexBuffer);
      shadowPass.setIndexBuffer(item.gpuMesh.indexBuffer, item.gpuMesh.indexFormat);
      shadowPass.drawIndexed(item.gpuMesh.indexCount);
    }
    shadowPass.end();

    const currentTexture = ctx.context.getCurrentTexture();
    const mainPass = commandEncoder.beginRenderPass({
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

    mainPass.setPipeline(this.shadowPipeline);
    mainPass.setBindGroup(0, this.frameBindGroup);
    for (const item of this.renderItems) {
      mainPass.setBindGroup(1, item.objectBindGroup);
      mainPass.setVertexBuffer(0, item.gpuMesh.vertexBuffer);
      mainPass.setIndexBuffer(item.gpuMesh.indexBuffer, item.gpuMesh.indexFormat);
      mainPass.drawIndexed(item.gpuMesh.indexCount);
    }
    mainPass.end();

    commandEncoder.copyTextureToTexture(
      { texture: this.colorTexture },
      { texture: currentTexture },
      { width: ctx.canvas.width, height: ctx.canvas.height },
    );
    ctx.device.queue.submit([commandEncoder.finish()]);
  }

  dispose() {
    this.colorTexture?.destroy();
    this.depthTexture?.destroy();
    this.shadowDepthTexture?.destroy();
    this.colorTexture = undefined;
    this.depthTexture = undefined;
    this.shadowDepthTexture = undefined;

    for (const item of this.renderItems) {
      destroyGPUMesh(item.gpuMesh);
      item.objectBuffer.destroy();
      item.depthObjectBuffer.destroy();
    }
    this.renderItems = [];
  }

  private async loadSceneMeshes(ctx: LabContext) {
    if (!this.scene || !this.depthPipeline || !this.shadowPipeline) {
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

      const gpuMesh = createGPUMesh(ctx.device, cpuMesh);
      const depthObjectBuffer = ctx.device.createBuffer({
        label: `${sceneMesh.name} Shadow Depth Object`,
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const depthBindGroup = ctx.device.createBindGroup({
        label: `${sceneMesh.name} Shadow Depth Bind Group`,
        layout: this.depthPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: depthObjectBuffer } }],
      });
      const objectBuffer = ctx.device.createBuffer({
        label: `${sceneMesh.name} Shadow Object`,
        size: 208,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const objectBindGroup = ctx.device.createBindGroup({
        label: `${sceneMesh.name} Shadow Object Bind Group`,
        layout: this.shadowPipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: objectBuffer } }],
      });
      const modelMatrix = composeTransform(
        sceneMesh.position ?? [0, 0, 0],
        sceneMesh.rotation ?? [0, 0, 0],
        sceneMesh.scale ?? [1, 1, 1],
      );

      this.renderItems.push({
        sceneMesh,
        material,
        gpuMesh,
        modelMatrix,
        depthObjectBuffer,
        depthBindGroup,
        objectBuffer,
        objectBindGroup,
      });
    }
  }

  private createShadowResources(ctx: LabContext) {
    if (!this.shadowPipeline || !this.frameBuffer || !this.shadowSampler) {
      return;
    }

    this.currentShadowResolution = Number(this.params.shadowResolution);
    this.shadowDepthTexture?.destroy();
    this.shadowDepthTexture = ctx.device.createTexture({
      label: "Shadow Map",
      size: [this.currentShadowResolution, this.currentShadowResolution],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.frameBindGroup = ctx.device.createBindGroup({
      label: "Shadow Mapping Frame Bind Group",
      layout: this.shadowPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: this.shadowSampler },
        { binding: 2, resource: this.shadowDepthTexture.createView() },
      ],
    });
    ctx.debug.addTexture({
      id: "shadow-map",
      label: "Shadow Map",
      texture: this.shadowDepthTexture,
      width: this.currentShadowResolution,
      height: this.currentShadowResolution,
      format: "depth32float",
    });
  }

  private computeLightViewProjection(lightDirection: Vec3): Mat4 {
    const target: Vec3 = [0, 0.6, 0];
    const eye = add3(target, scale3(lightDirection, -this.params.lightDistance));
    const size = this.params.lightFrustumSize * 0.5;
    const view = lookAt4(eye, target, [0, 1, 0]);
    const projection = orthographic4(-size, size, -size, size, 0.1, this.params.lightDistance * 2.5);
    return multiply4(projection, view);
  }

  private registerParams(ctx: LabContext) {
    ctx.gui.add("shadowEnabled", {
      type: "bool",
      label: "Shadow",
      get: () => this.params.shadowEnabled,
      set: (value) => {
        this.params.shadowEnabled = value;
      },
    });
    ctx.gui.add("shadowResolution", {
      type: "enum",
      label: "Resolution",
      options: [
        { label: "512", value: "512" },
        { label: "1024", value: "1024" },
        { label: "2048", value: "2048" },
      ],
      get: () => this.params.shadowResolution,
      set: (value) => {
        this.params.shadowResolution = value;
      },
    });
    ctx.gui.add("bias", {
      type: "float",
      label: "Bias",
      min: 0,
      max: 0.02,
      step: 0.0001,
      get: () => this.params.bias,
      set: (value) => {
        this.params.bias = value;
      },
    });
    ctx.gui.add("frustumSize", {
      type: "float",
      label: "Frustum",
      min: 2,
      max: 12,
      step: 0.1,
      get: () => this.params.lightFrustumSize,
      set: (value) => {
        this.params.lightFrustumSize = value;
      },
    });
    ctx.gui.add("lightDistance", {
      type: "float",
      label: "Light Dist",
      min: 3,
      max: 18,
      step: 0.1,
      get: () => this.params.lightDistance,
      set: (value) => {
        this.params.lightDistance = value;
      },
    });
    ctx.gui.add("ambient", {
      type: "float",
      label: "Ambient",
      min: 0,
      max: 1,
      step: 0.01,
      get: () => this.params.ambient,
      set: (value) => {
        this.params.ambient = value;
      },
    });
  }
}
