import type { Lab, LabContext } from "../../core/lab/Lab";

const triangleShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(0.0, 0.62),
    vec2f(-0.58, -0.42),
    vec2f(0.58, -0.42),
  );

  var colors = array<vec3f, 3>(
    vec3f(0.95, 0.34, 0.28),
    vec3f(0.24, 0.72, 0.96),
    vec3f(0.92, 0.82, 0.38),
  );

  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.color = colors[vertexIndex];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`;

export class TriangleLab implements Lab {
  id = "triangle";
  name = "Triangle";
  category = "template" as const;
  description = "A small WGSL pipeline lab used to verify Lab setup and disposal.";

  private pipeline?: GPURenderPipeline;

  setup(ctx: LabContext) {
    const shader = ctx.device.createShaderModule({
      label: "Triangle Lab Shader",
      code: triangleShader,
    });

    this.pipeline = ctx.device.createRenderPipeline({
      label: "Triangle Lab Pipeline",
      layout: "auto",
      vertex: {
        module: shader,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format: ctx.format }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }

  render(ctx: LabContext) {
    if (!this.pipeline) {
      return;
    }

    const commandEncoder = ctx.device.createCommandEncoder();
    const view = ctx.context.getCurrentTexture().createView();

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.025, g: 0.032, b: 0.042, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.draw(3);
    pass.end();

    ctx.device.queue.submit([commandEncoder.finish()]);
  }

  dispose() {
    this.pipeline = undefined;
  }
}
