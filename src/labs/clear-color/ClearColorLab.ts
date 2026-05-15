import type { Lab, LabContext } from "../../core/lab/Lab";

export class ClearColorLab implements Lab {
  id = "clear-color";
  name = "Clear Color";
  category = "template" as const;
  description = "Minimal render loop lab that clears the swapchain with an animated color.";

  render(ctx: LabContext) {
    const commandEncoder = ctx.device.createCommandEncoder();
    const view = ctx.context.getCurrentTexture().createView();
    const t = ctx.time.elapsed;

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: {
            r: 0.04 + Math.sin(t * 0.7) * 0.015,
            g: 0.055,
            b: 0.075 + Math.cos(t * 0.5) * 0.015,
            a: 1,
          },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.end();
    ctx.device.queue.submit([commandEncoder.finish()]);
  }
}
