import type { CpuMesh } from "../assets/GLBLoader";

export type GPUMesh = {
  name: string;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  indexFormat: GPUIndexFormat;
};

export function createGPUMesh(device: GPUDevice, mesh: CpuMesh): GPUMesh {
  const vertexStride = 8;
  const vertices = new Float32Array((mesh.positions.length / 3) * vertexStride);

  for (let i = 0; i < mesh.positions.length / 3; i += 1) {
    vertices[i * vertexStride + 0] = mesh.positions[i * 3 + 0];
    vertices[i * vertexStride + 1] = mesh.positions[i * 3 + 1];
    vertices[i * vertexStride + 2] = mesh.positions[i * 3 + 2];
    vertices[i * vertexStride + 3] = mesh.normals[i * 3 + 0];
    vertices[i * vertexStride + 4] = mesh.normals[i * 3 + 1];
    vertices[i * vertexStride + 5] = mesh.normals[i * 3 + 2];
    vertices[i * vertexStride + 6] = mesh.uvs[i * 2 + 0];
    vertices[i * vertexStride + 7] = mesh.uvs[i * 2 + 1];
  }

  const vertexBuffer = device.createBuffer({
    label: `${mesh.name} Vertex Buffer`,
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  const indexData =
    mesh.indices instanceof Uint32Array ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
  const indexBuffer = device.createBuffer({
    label: `${mesh.name} Index Buffer`,
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData);

  return {
    name: mesh.name,
    vertexBuffer,
    indexBuffer,
    indexCount: indexData.length,
    indexFormat: indexData instanceof Uint32Array ? "uint32" : "uint16",
  };
}

export function destroyGPUMesh(mesh: GPUMesh) {
  mesh.vertexBuffer.destroy();
  mesh.indexBuffer.destroy();
}
