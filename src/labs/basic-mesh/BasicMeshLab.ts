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
  let ambient = 0.18;
  let lit = input.color.rgb * (ambient + ndotl * frame.lightColor.rgb);
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
  private depthTexture?: GPUTexture;
  private renderItems: RenderItem[] = [];

  async setup(ctx: LabContext) {
    this.scene = await ctx.assets.loadScene(BuiltinAssets.scenes.shadowTest);
    ctx.camera.lookAt(this.scene.camera.position, this.scene.camera.target);
    ctx.camera.setPerspective(this.scene.camera.fovYDegrees, this.scene.camera.near, this.scene.camera.far);

    const shader = ctx.device.createShaderModule({
      label: "Basic Mesh Shader",
      code: meshShader,
    });

    this.frameBuffer = ctx.device.createBuffer({
      label: "Basic Mesh Frame Uniforms",
      size: 96,
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
    this.depthTexture?.destroy();
    this.depthTexture = ctx.device.createTexture({
      label: "Basic Mesh Depth Texture",
      size: [ctx.canvas.width, ctx.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  update(ctx: LabContext) {
    if (!this.scene || !this.frameBuffer) {
      return;
    }

    const directional = this.scene.lights.find((light) => light.type === "directional");
    const lightDirection = normalize3(directional?.direction ?? [-0.5, -1, -0.4]);
    const lightColor = directional?.color ?? [1, 1, 1];
    const lightIntensity = directional?.intensity ?? 1;
    const frameUniforms = new Float32Array(24);

    frameUniforms.set(ctx.camera.viewProjectionMatrix, 0);
    frameUniforms.set([lightDirection[0], lightDirection[1], lightDirection[2], 0], 16);
    frameUniforms.set(
      [lightColor[0] * lightIntensity, lightColor[1] * lightIntensity, lightColor[2] * lightIntensity, 1],
      20,
    );
    ctx.device.queue.writeBuffer(this.frameBuffer, 0, frameUniforms);

    for (const item of this.renderItems) {
      const modelViewProjection = multiply4(ctx.camera.viewProjectionMatrix, item.modelMatrix);
      const objectUniforms = new Float32Array(36);
      objectUniforms.set(item.modelMatrix, 0);
      objectUniforms.set(modelViewProjection, 16);
      objectUniforms.set(item.material.baseColor, 32);
      ctx.device.queue.writeBuffer(item.objectBuffer, 0, objectUniforms);
    }
  }

  render(ctx: LabContext) {
    if (!this.pipeline || !this.frameBindGroup || !this.depthTexture || !this.scene) {
      return;
    }

    const bg = this.scene.environment?.color ?? [0.03, 0.04, 0.05];
    const commandEncoder = ctx.device.createCommandEncoder();
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.context.getCurrentTexture().createView(),
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
    ctx.device.queue.submit([commandEncoder.finish()]);
  }

  dispose() {
    this.depthTexture?.destroy();
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
}
