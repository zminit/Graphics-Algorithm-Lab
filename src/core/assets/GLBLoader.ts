export type CpuMesh = {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
};

type Gltf = {
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{ name?: string; mesh?: number }>;
  meshes?: Array<{
    name?: string;
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
    }>;
  }>;
  buffers?: Array<{ byteLength: number }>;
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4";
  }>;
};

const componentByteSize = new Map<number, number>([
  [5121, 1],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);

const typeComponentCount = new Map<string, number>([
  ["SCALAR", 1],
  ["VEC2", 2],
  ["VEC3", 3],
  ["VEC4", 4],
  ["MAT4", 16],
]);

export async function loadGLB(url: string): Promise<CpuMesh[]> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load GLB: ${url}`);
  }

  return parseGLB(await response.arrayBuffer());
}

function parseGLB(arrayBuffer: ArrayBuffer): CpuMesh[] {
  const dataView = new DataView(arrayBuffer);
  const magic = dataView.getUint32(0, true);
  const version = dataView.getUint32(4, true);

  if (magic !== 0x46546c67 || version !== 2) {
    throw new Error("Unsupported GLB file.");
  }

  let offset = 12;
  let gltf: Gltf | undefined;
  let binary: ArrayBuffer | undefined;

  while (offset < arrayBuffer.byteLength) {
    const chunkLength = dataView.getUint32(offset, true);
    const chunkType = dataView.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkType === 0x4e4f534a) {
      const jsonText = new TextDecoder().decode(arrayBuffer.slice(chunkStart, chunkEnd)).trim();
      gltf = JSON.parse(jsonText) as Gltf;
    } else if (chunkType === 0x004e4942) {
      binary = arrayBuffer.slice(chunkStart, chunkEnd);
    }

    offset = chunkEnd;
  }

  if (!gltf || !binary) {
    throw new Error("GLB is missing JSON or binary chunk.");
  }

  return extractMeshes(gltf, binary);
}

function extractMeshes(gltf: Gltf, binary: ArrayBuffer): CpuMesh[] {
  const meshes: CpuMesh[] = [];

  for (const mesh of gltf.meshes ?? []) {
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      const positionAccessor = primitive.attributes.POSITION;
      const normalAccessor = primitive.attributes.NORMAL;
      const uvAccessor = primitive.attributes.TEXCOORD_0;

      if (positionAccessor === undefined || normalAccessor === undefined || uvAccessor === undefined) {
        continue;
      }

      meshes.push({
        name: mesh.name ?? `Mesh ${primitiveIndex}`,
        positions: readFloatAccessor(gltf, binary, positionAccessor),
        normals: readFloatAccessor(gltf, binary, normalAccessor),
        uvs: readFloatAccessor(gltf, binary, uvAccessor),
        indices:
          primitive.indices === undefined
            ? buildSequentialIndices(readAccessorCount(gltf, positionAccessor))
            : readIndexAccessor(gltf, binary, primitive.indices),
      });
    }
  }

  return meshes;
}

function readAccessorCount(gltf: Gltf, accessorIndex: number): number {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) {
    throw new Error(`Missing accessor: ${accessorIndex}`);
  }
  return accessor.count;
}

function readFloatAccessor(gltf: Gltf, binary: ArrayBuffer, accessorIndex: number): Float32Array {
  const { accessor, view, byteOffset, componentCount, stride } = getAccessorLayout(gltf, accessorIndex);

  if (accessor.componentType !== 5126) {
    throw new Error("Only Float32 mesh attributes are supported.");
  }

  const output = new Float32Array(accessor.count * componentCount);
  const dataView = new DataView(binary, byteOffset, view.byteLength - (accessor.byteOffset ?? 0));

  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < componentCount; c += 1) {
      output[i * componentCount + c] = dataView.getFloat32(i * stride + c * 4, true);
    }
  }

  return output;
}

function readIndexAccessor(gltf: Gltf, binary: ArrayBuffer, accessorIndex: number): Uint16Array | Uint32Array {
  const { accessor, view, byteOffset, componentCount, stride } = getAccessorLayout(gltf, accessorIndex);

  if (componentCount !== 1) {
    throw new Error("Index accessor must be scalar.");
  }

  if (accessor.componentType === 5123) {
    const output = new Uint16Array(accessor.count);
    const dataView = new DataView(binary, byteOffset, view.byteLength - (accessor.byteOffset ?? 0));
    for (let i = 0; i < accessor.count; i += 1) {
      output[i] = dataView.getUint16(i * stride, true);
    }
    return output;
  }

  if (accessor.componentType === 5125) {
    const output = new Uint32Array(accessor.count);
    const dataView = new DataView(binary, byteOffset, view.byteLength - (accessor.byteOffset ?? 0));
    for (let i = 0; i < accessor.count; i += 1) {
      output[i] = dataView.getUint32(i * stride, true);
    }
    return output;
  }

  throw new Error("Only Uint16 and Uint32 indices are supported.");
}

function getAccessorLayout(gltf: Gltf, accessorIndex: number) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined) {
    throw new Error(`Missing accessor: ${accessorIndex}`);
  }

  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view) {
    throw new Error(`Missing buffer view: ${accessor.bufferView}`);
  }

  const componentSize = componentByteSize.get(accessor.componentType);
  const componentCount = typeComponentCount.get(accessor.type);
  if (!componentSize || !componentCount) {
    throw new Error("Unsupported accessor layout.");
  }

  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? componentSize * componentCount;

  return { accessor, view, byteOffset, componentCount, stride };
}

function buildSequentialIndices(count: number): Uint16Array | Uint32Array {
  const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i += 1) {
    indices[i] = i;
  }
  return indices;
}
