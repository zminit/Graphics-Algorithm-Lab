import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetRoot = resolve(root, "public/assets/builtin");

const textureDir = resolve(assetRoot, "textures");
const modelDir = resolve(assetRoot, "models");

async function ensureDirs() {
  await mkdir(textureDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function makePng(width, height, pixelAt) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function hashNoise(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >>> 13)) * 1274126177;
  return (n ^ (n >>> 16)) & 255;
}

async function writePng(name, width, height, pixelAt) {
  await writeFile(resolve(textureDir, name), makePng(width, height, pixelAt));
}

function align4(value) {
  return (value + 3) & ~3;
}

function f32(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function u16(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function bounds3(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

async function writeGlb(name, meshes) {
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  const gltfMeshes = [];

  function pushBuffer(buffer, target) {
    const byteOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const paddedLength = align4(buffer.length);
    const padded = Buffer.alloc(paddedLength);
    buffer.copy(padded);
    chunks.push(padded);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: buffer.length, target });
    return bufferViews.length - 1;
  }

  for (const mesh of meshes) {
    const positionView = pushBuffer(f32(mesh.positions), 34962);
    const normalView = pushBuffer(f32(mesh.normals), 34962);
    const uvView = pushBuffer(f32(mesh.uvs), 34962);
    const indexView = pushBuffer(u16(mesh.indices), 34963);
    const { min, max } = bounds3(mesh.positions);

    const positionAccessor = accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: mesh.positions.length / 3,
      type: "VEC3",
      min,
      max,
    }) - 1;
    const normalAccessor = accessors.push({
      bufferView: normalView,
      componentType: 5126,
      count: mesh.normals.length / 3,
      type: "VEC3",
    }) - 1;
    const uvAccessor = accessors.push({
      bufferView: uvView,
      componentType: 5126,
      count: mesh.uvs.length / 2,
      type: "VEC2",
    }) - 1;
    const indexAccessor = accessors.push({
      bufferView: indexView,
      componentType: 5123,
      count: mesh.indices.length,
      type: "SCALAR",
    }) - 1;

    gltfMeshes.push({
      name: mesh.name,
      primitives: [
        {
          attributes: {
            POSITION: positionAccessor,
            NORMAL: normalAccessor,
            TEXCOORD_0: uvAccessor,
          },
          indices: indexAccessor,
        },
      ],
    });
  }

  const binary = Buffer.concat(chunks);
  const json = {
    asset: {
      version: "2.0",
      generator: "GamesPlatform built-in asset generator",
    },
    scene: 0,
    scenes: [{ nodes: gltfMeshes.map((_, index) => index) }],
    nodes: gltfMeshes.map((mesh, index) => ({ name: mesh.name, mesh: index })),
    meshes: gltfMeshes,
    buffers: [{ byteLength: binary.length }],
    bufferViews,
    accessors,
  };

  const jsonBuffer = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(align4(jsonBuffer.length), 0x20);
  jsonBuffer.copy(paddedJson);

  const header = Buffer.alloc(12);
  const jsonHeader = Buffer.alloc(8);
  const binaryHeader = Buffer.alloc(8);
  const totalLength = 12 + 8 + paddedJson.length + 8 + binary.length;

  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);

  await writeFile(resolve(modelDir, name), Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, binary]));
}

function makePlane(size = 1) {
  const h = size * 0.5;
  return {
    name: "Plane",
    positions: [-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 2, 1, 0, 3, 2],
  };
}

function makeCube(size = 1) {
  const h = size * 0.5;
  const faces = [
    [[0, 0, 1], [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]]],
    [[0, 0, -1], [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]]],
    [[1, 0, 0], [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]]],
    [[-1, 0, 0], [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]]],
    [[0, 1, 0], [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]]],
    [[0, -1, 0], [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]]],
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (const [normal, corners] of faces) {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return { name: "Cube", positions, normals, uvs, indices };
}

function makeSphere(radius = 0.5, segments = 32, rings = 16, center = [0, 0, 0], name = "Sphere") {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let y = 0; y <= rings; y += 1) {
    const v = y / rings;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= segments; x += 1) {
      const u = x / segments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const nx = cosPhi * sinTheta;
      const ny = cosTheta;
      const nz = sinPhi * sinTheta;

      positions.push(center[0] + nx * radius, center[1] + ny * radius, center[2] + nz * radius);
      normals.push(nx, ny, nz);
      uvs.push(u, 1 - v);
    }
  }

  for (let y = 0; y < rings; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = y * (segments + 1) + x;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return { name, positions, normals, uvs, indices };
}

async function generateTextures() {
  await writePng("white.png", 4, 4, () => [255, 255, 255, 255]);
  await writePng("black.png", 4, 4, () => [0, 0, 0, 255]);
  await writePng("gray.png", 4, 4, () => [128, 128, 128, 255]);
  await writePng("flat-normal.png", 4, 4, () => [128, 128, 255, 255]);
  await writePng("checkerboard.png", 256, 256, (x, y) => {
    const checker = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
    return checker ? [232, 236, 240, 255] : [39, 49, 60, 255];
  });
  await writePng("uv-grid.png", 256, 256, (x, y) => {
    const grid = x % 32 === 0 || y % 32 === 0 || x === 255 || y === 255;
    const axis = x < 3 || y < 3;
    if (axis) return [255, 80, 80, 255];
    if (grid) return [245, 245, 245, 255];
    return [Math.floor((x / 255) * 220), Math.floor((y / 255) * 220), 180, 255];
  });
  await writePng("blue-noise.png", 128, 128, (x, y) => {
    const value = hashNoise(x, y);
    const neighbor = hashNoise(x + 17, y + 31);
    const mixed = Math.floor((value * 0.75 + neighbor * 0.25) % 256);
    return [mixed, mixed, mixed, 255];
  });
}

async function generateModels() {
  await writeGlb("plane.glb", [makePlane()]);
  await writeGlb("cube.glb", [makeCube()]);
  await writeGlb("sphere.glb", [makeSphere()]);
  await writeGlb("material-test-spheres.glb", [
    makeSphere(0.45, 32, 16, [-1.2, 0.5, 0], "Rough Dielectric Sphere"),
    makeSphere(0.45, 32, 16, [0, 0.5, 0], "Metal Sphere"),
    makeSphere(0.45, 32, 16, [1.2, 0.5, 0], "Plastic Sphere"),
  ]);
}

await ensureDirs();
await generateTextures();
await generateModels();

console.log("Generated built-in textures and models.");
