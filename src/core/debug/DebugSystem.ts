export type DebugTextureFormat = "rgba8unorm" | "bgra8unorm";

export type DebugTextureEntry = {
  id: string;
  label: string;
  texture: GPUTexture;
  width: number;
  height: number;
  format: DebugTextureFormat;
};

export class DebugSystem {
  private readonly textures = new Map<string, DebugTextureEntry>();
  private selectedTextureId = "";
  private previewCanvas?: HTMLCanvasElement;
  private select?: HTMLSelectElement;
  private status?: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly device: GPUDevice,
  ) {}

  clear() {
    this.textures.clear();
    this.selectedTextureId = "";
    this.render();
  }

  addTexture(entry: DebugTextureEntry) {
    this.textures.set(entry.id, entry);
    if (!this.selectedTextureId) {
      this.selectedTextureId = entry.id;
    }
    this.render();
  }

  removeTexture(id: string) {
    this.textures.delete(id);
    if (this.selectedTextureId === id) {
      this.selectedTextureId = this.textures.keys().next().value ?? "";
    }
    this.render();
  }

  async refresh() {
    const entry = this.textures.get(this.selectedTextureId);
    if (!entry || !this.previewCanvas || !this.status) {
      return;
    }

    try {
      this.status.textContent = "Reading texture...";
      const imageData = await this.readTexture(entry);
      this.previewCanvas.width = entry.width;
      this.previewCanvas.height = entry.height;
      const context = this.previewCanvas.getContext("2d");
      context?.putImageData(imageData, 0, 0);
      this.status.textContent = `${entry.width} x ${entry.height} · ${entry.format}`;
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private render() {
    const fragment = document.createDocumentFragment();
    const header = document.createElement("div");
    header.className = "gui-header";
    header.innerHTML = "<p class=\"panel-label\">Debug Views</p>";

    const actions = document.createElement("div");
    actions.className = "gui-actions";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.textContent = "Refresh";
    refreshButton.addEventListener("click", () => {
      void this.refresh();
    });
    actions.append(refreshButton);
    header.append(actions);
    fragment.append(header);

    if (this.textures.size === 0) {
      const empty = document.createElement("p");
      empty.className = "gui-empty";
      empty.textContent = "No debug textures registered.";
      fragment.append(empty);
      this.root.replaceChildren(fragment);
      return;
    }

    const selectRow = document.createElement("label");
    selectRow.className = "gui-row gui-row-stacked";
    const label = document.createElement("span");
    label.textContent = "Texture";
    this.select = document.createElement("select");
    for (const entry of this.textures.values()) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      this.select.append(option);
    }
    this.select.value = this.selectedTextureId;
    this.select.addEventListener("change", () => {
      this.selectedTextureId = this.select?.value ?? "";
      void this.refresh();
    });
    selectRow.append(label, this.select);
    fragment.append(selectRow);

    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.className = "debug-preview";
    fragment.append(this.previewCanvas);

    this.status = document.createElement("p");
    this.status.className = "debug-status";
    this.status.textContent = "Press Refresh to capture.";
    fragment.append(this.status);

    this.root.replaceChildren(fragment);
  }

  private async readTexture(entry: DebugTextureEntry): Promise<ImageData> {
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = entry.width * bytesPerPixel;
    const bytesPerRow = alignTo(unpaddedBytesPerRow, 256);
    const size = bytesPerRow * entry.height;
    const buffer = this.device.createBuffer({
      label: `${entry.label} Debug Readback`,
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: entry.texture },
      { buffer, bytesPerRow, rowsPerImage: entry.height },
      { width: entry.width, height: entry.height },
    );
    this.device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const pixels = new Uint8ClampedArray(entry.width * entry.height * bytesPerPixel);

    for (let y = 0; y < entry.height; y += 1) {
      for (let x = 0; x < entry.width; x += 1) {
        const source = y * bytesPerRow + x * bytesPerPixel;
        const target = (y * entry.width + x) * bytesPerPixel;
        if (entry.format === "bgra8unorm") {
          pixels[target] = mapped[source + 2];
          pixels[target + 1] = mapped[source + 1];
          pixels[target + 2] = mapped[source];
          pixels[target + 3] = mapped[source + 3];
        } else {
          pixels[target] = mapped[source];
          pixels[target + 1] = mapped[source + 1];
          pixels[target + 2] = mapped[source + 2];
          pixels[target + 3] = mapped[source + 3];
        }
      }
    }

    buffer.unmap();
    buffer.destroy();

    return new ImageData(pixels, entry.width, entry.height);
  }
}

function alignTo(value: number, alignment: number) {
  return Math.ceil(value / alignment) * alignment;
}
