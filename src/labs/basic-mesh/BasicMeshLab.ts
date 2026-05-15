import { BuiltinAssets } from "../../core/assets/BuiltinAssets";
import type { SceneMaterial, SceneMesh, ScenePreset } from "../../core/assets/ScenePreset";
import type { Lab, LabContext } from "../../core/lab/Lab";
import { composeTransform, multiply4, type Mat4 } from "../../core/math/Mat4";
import { normalize3, type Vec3 } from "../../core/math/Vec3";
import { createGPUMesh, destroyGPUMesh, type GPUMesh } from "../../core/renderer/GPUMesh";

const meshShader = /* wgsl */ `
struct FrameUniforms {
  viewProjection: mat4x4f,
  lightDirection: vec4f,
  lightColor: vec4f,
  params: vec4f,
};

struct ObjectUniforms {
  model: mat4x4f,
  modelViewProjection: mat4x4f,
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
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(input.position, 1.0);
  output.normal = normalize((object.model * vec4f(input.normal, 0.0)).xyz);
  output.color = object.baseColor;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let n = normalize(input.normal);
  let l = normalize(-frame.lightDirection.xyz);
  let ndotl = max(dot(n, l), 0.0);
  let ambient = frame.params.x;
  let normalColor = n * 0.5 + vec3f(0.5);
  let base = mix(input.color.rgb, normalColor, frame.params.y);
  let lit = base * (ambient + ndotl * frame.lightColor.rgb);
  return vec4f(lit, input.color.a);
}
`;

type RenderItem = {
  sceneMesh: SceneMesh;
  material: SceneMaterial;
  gpuMesh: GPUMesh;
  modelMatrix: Mat4;
  objectBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
};

export class BasicMeshLab implements Lab {
  id = "basic-mesh";
  name = "Basic Mesh";
  category = "rendering" as const;
  description = "Loads the built-in shadow test scene, draws GLB meshes, and exposes the shared orbit camera.";

  private scene?: ScenePreset;
  private pipeline?: GPURenderPipeline;
  private frameBuffer?: GPUBuffer;
  private frameBindGroup?: GPUBindGroup;
  private colorTexture?: GPUTexture;
  private depthTexture?: GPUTexture;
  private renderItems: RenderItem[] = [];
  private readonly params = {
    background: [0.03, 0.04, 0.05] as [number, number, number],
    ambient: 0.18,
    lightIntensity: 1,
    shadingMode: "lit",
    autoRotate: false,
    rotationSpeed: 0.35,
  };

  async setup(ctx: LabContext) {
    this.scene = await ctx.assets.loadScene(BuiltinAssets.scenes.shadowTest);
    ctx.camera.lookAt(this.scene.camera.position, this.scene.camera.target);
    ctx.camera.setPerspective(this.scene.camera.fovYDegrees, this.scene.camera.near, this.scene.camera.far);
    this.params.background = [...(this.scene.environment?.color ?? this.params.background)];
    this.registerParams(ctx);

    const shader = ctx.device.createShaderModule({
      label: "Basic Mesh Shader",
      code: meshShader,
    });

    this.frameBuffer = ctx.device.createBuffer({
      label: "Basic Mesh Frame Uniforms",
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pipeline = ctx.device.createRenderPipeline({
      label: "Basic Mesh Pipeline",
      layout: "auto",
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
        cullMode: "back",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    this.frameBindGroup = ctx.device.createBindGroup({
      label: "Basic Mesh Frame Bind Group",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }],
    });

    await this.loadSceneMeshes(ctx);
    this.resize(ctx);
  }

  resize(ctx: LabContext) {
    this.colorTexture?.destroy();
    this.depthTexture?.destroy();
    this.colorTexture = ctx.device.createTexture({
      label: "Basic Mesh Color Texture",
      size: [ctx.canvas.width, ctx.canvas.height],
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthTexture = ctx.device.createTexture({
      label: "Basic Mesh Depth Texture",
      size: [ctx.canvas.width, ctx.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    ctx.debug.addTexture({
      id: "basic-mesh-color",
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

    const directional = this.scene.lights.find((light) => light.type === "directional");
    const lightDirection = normalize3(directional?.direction ?? [-0.5, -1, -0.4]);
    const lightColor = directional?.color ?? [1, 1, 1];
    const lightIntensity = (directional?.intensity ?? 1) * this.params.lightIntensity;
    const frameUniforms = new Float32Array(28);

    frameUniforms.set(ctx.camera.viewProjectionMatrix, 0);
    frameUniforms.set([lightDirection[0], lightDirection[1], lightDirection[2], 0], 16);
    frameUniforms.set(
      [lightColor[0] * lightIntensity, lightColor[1] * lightIntensity, lightColor[2] * lightIntensity, 1],
      20,
    );
    frameUniforms.set([this.params.ambient, this.params.shadingMode === "normal" ? 1 : 0, 0, 0], 24);
    ctx.device.queue.writeBuffer(this.frameBuffer, 0, frameUniforms);

    for (const item of this.renderItems) {
      const modelMatrix =
        this.params.autoRotate && item.sceneMesh.id !== "floor"
          ? multiply4(item.modelMatrix, composeTransform([0, 0, 0], [0, ctx.time.elapsed * this.params.rotationSpeed * 90, 0], [1, 1, 1]))
          : item.modelMatrix;
      const modelViewProjection = multiply4(ctx.camera.viewProjectionMatrix, modelMatrix);
      const objectUniforms = new Float32Array(36);
      objectUniforms.set(modelMatrix, 0);
      objectUniforms.set(modelViewProjection, 16);
      objectUniforms.set(item.material.baseColor, 32);
      ctx.device.queue.writeBuffer(item.objectBuffer, 0, objectUniforms);
    }
  }

  render(ctx: LabContext) {
    if (!this.pipeline || !this.frameBindGroup || !this.colorTexture || !this.depthTexture || !this.scene) {
      return;
    }

    const bg = this.params.background;
    const commandEncoder = ctx.device.createCommandEncoder();
    const currentTexture = ctx.context.getCurrentTexture();
    const pass = commandEncoder.beginRenderPass({
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

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.frameBindGroup);

    for (const item of this.renderItems) {
      pass.setBindGroup(1, item.bindGroup);
      pass.setVertexBuffer(0, item.gpuMesh.vertexBuffer);
      pass.setIndexBuffer(item.gpuMesh.indexBuffer, item.gpuMesh.indexFormat);
      pass.drawIndexed(item.gpuMesh.indexCount);
    }

    pass.end();
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
    this.colorTexture = undefined;
    this.depthTexture = undefined;

    for (const item of this.renderItems) {
      destroyGPUMesh(item.gpuMesh);
      item.objectBuffer.destroy();
    }
    this.renderItems = [];
  }

  private async loadSceneMeshes(ctx: LabContext) {
    if (!this.scene || !this.pipeline) {
      return;
    }

    const materials = new Map(this.scene.materials.map((material) => [material.id, material]));

    for (const sceneMesh of this.scene.meshes) {
      const material = materials.get(sceneMesh.material);
      if (!material) {
        throw new Error(`Missing material: ${sceneMesh.material}`);
      }

      const cpuMeshes = await ctx.assets.loadGLB(sceneMesh.model);
      const cpuMesh = cpuMeshes[0];
      if (!cpuMesh) {
        throw new Error(`Model has no mesh: ${sceneMesh.model}`);
      }

      const gpuMesh = createGPUMesh(ctx.device, cpuMesh);
      const objectBuffer = ctx.device.createBuffer({
        label: `${sceneMesh.name} Object Uniforms`,
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = ctx.device.createBindGroup({
        label: `${sceneMesh.name} Bind Group`,
        layout: this.pipeline.getBindGroupLayout(1),
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
        objectBuffer,
        bindGroup,
      });
    }
  }

  private registerParams(ctx: LabContext) {
    ctx.gui.add("background", {
      type: "color",
      label: "Background",
      get: () => this.params.background,
      set: (value) => {
        this.params.background = value;
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
    ctx.gui.add("lightIntensity", {
      type: "float",
      label: "Light",
      min: 0,
      max: 2,
      step: 0.01,
      get: () => this.params.lightIntensity,
      set: (value) => {
        this.params.lightIntensity = value;
      },
    });
    ctx.gui.add("shadingMode", {
      type: "enum",
      label: "Shading",
      options: [
        { label: "Lit", value: "lit" },
        { label: "Normal", value: "normal" },
      ],
      get: () => this.params.shadingMode,
      set: (value) => {
        this.params.shadingMode = value;
      },
    });
    ctx.gui.add("autoRotate", {
      type: "bool",
      label: "Auto Rotate",
      get: () => this.params.autoRotate,
      set: (value) => {
        this.params.autoRotate = value;
      },
    });
    ctx.gui.add("rotationSpeed", {
      type: "float",
      label: "Spin Speed",
      min: 0,
      max: 2,
      step: 0.01,
      get: () => this.params.rotationSpeed,
      set: (value) => {
        this.params.rotationSpeed = value;
      },
    });
  }
}
