import { BuiltinAssets } from "../assets/BuiltinAssets";
import type { GraphLabSpec, GraphMaterialInstance, GraphPassSpec, GraphResourceSpec } from "../graph";
import type { GraphParamSpecs } from "../graph/GraphParamTypes";

export type EditableGraphLabDocument = {
  schema: "games-platform.editable-blueprint";
  version: 1;
  id: string;
  name: string;
  description?: string;
  scene: string;
  params: GraphParamSpecs;
  resources: Record<string, GraphResourceSpec>;
  passes: GraphPassSpec[];
  output: string;
  layout: {
    nodes: Record<string, { x: number; y: number }>;
  };
  shaders: Record<string, { path: string; code: string }>;
};

export type ExperimentMaterialAssignment = {
  meshId: string;
  materialId: string;
};

export type EditableExperimentDocument = {
  schema: "games-platform.experiment-lab";
  version: 1;
  id: string;
  name: string;
  description?: string;
  scene: string;
  blueprintId: string;
  materialInstances: GraphMaterialInstance[];
  assignments: ExperimentMaterialAssignment[];
};

export type UserLabListEntry = {
  id: string;
  path: string;
  updatedAt: number;
};

export type UserLabCollection = {
  blueprints?: UserLabListEntry[];
  experiments?: UserLabListEntry[];
};

export function createDefaultGraphDocument(id = "my-graph-lab"): EditableGraphLabDocument {
  return {
    schema: "games-platform.editable-blueprint",
    version: 1,
    id,
    name: "My Blueprint",
    description: "User editable render blueprint.",
    scene: BuiltinAssets.scenes.shadowTest,
    params: {
      ambient: { type: "float", value: 0.2, min: 0, max: 1, step: 0.01 },
      lightIntensity: { type: "float", value: 2.4, min: 0, max: 6, step: 0.05 },
    },
    resources: {
      mainColor: {
        kind: "texture2d",
        format: "screen",
        size: "canvas",
        usage: ["render", "sample", "copySrc", "copyDst"],
        debug: true,
        label: "Main Color",
      },
      mainDepth: {
        kind: "depthTexture",
        format: "depth24plus",
        size: "canvas",
        usage: ["render"],
        label: "Main Depth",
      },
    },
    passes: [
      {
        type: "mesh",
        name: "Scene Mesh Pass",
        shader: "main",
        color: "mainColor",
        depth: "mainDepth",
        reads: [],
        bindings: [
          { kind: "uniform", name: "frame", group: 0, binding: 0, source: "frame" },
          { kind: "uniform", name: "params", group: 0, binding: 1, source: "params" },
          { kind: "uniform", name: "object", group: 1, binding: 0, source: "object" },
          { kind: "uniform", name: "material", group: 1, binding: 1, source: "material" },
          { kind: "texture", name: "baseColorTexture", group: 1, binding: 2, source: "material.baseColorTexture" },
          { kind: "sampler", name: "materialSampler", group: 1, binding: 3, source: "material.sampler" },
        ],
        cullMode: "back",
        depthWrite: true,
        depthCompare: "less",
        clear: true,
        enabled: true,
      },
    ],
    output: "mainColor",
    layout: {
      nodes: {
        "resource:mainColor": { x: 80, y: 80 },
        "resource:mainDepth": { x: 80, y: 210 },
        "pass:Scene Mesh Pass": { x: 360, y: 130 },
        "output:screen": { x: 680, y: 130 },
      },
    },
    shaders: {
      main: {
        path: "main.wgsl",
        code: defaultMeshShader(),
      },
    },
  };
}

export function createDefaultExperimentDocument(
  id: string,
  blueprintId: string,
  scene: string,
  meshIds: string[],
): EditableExperimentDocument {
  const defaultMaterialId = "default-material";
  return {
    schema: "games-platform.experiment-lab",
    version: 1,
    id,
    name: toTitle(id),
    description: "User composed Scene + Blueprint experiment.",
    scene,
    blueprintId,
    materialInstances: [
      {
        id: defaultMaterialId,
        name: "Default Material",
        baseColor: [0.72, 0.74, 0.72, 1],
        metallic: 0,
        roughness: 0.55,
        textures: {
          baseColorTexture: "/assets/builtin/textures/white.png",
          normalTexture: "/assets/builtin/textures/flat-normal.png",
        },
      },
    ],
    assignments: meshIds.map((meshId) => ({ meshId, materialId: defaultMaterialId })),
  };
}

export function documentToGraphLabSpec(
  document: EditableGraphLabDocument,
  shaderVersion = Date.now(),
  experiment?: EditableExperimentDocument,
  shaderBase = `/__user_labs/blueprints/${document.id}`,
): GraphLabSpec {
  return {
    id: experiment?.id ?? document.id,
    name: experiment?.name ?? document.name,
    description: experiment?.description ?? document.description,
    scene: experiment?.scene ?? document.scene,
    params: document.params,
    resources: document.resources,
    passes: document.passes.map((pass) => ({
      ...pass,
      shader: resolveShaderUrl(shaderBase, pass.shader, document.shaders, shaderVersion),
    })),
    output: document.output,
    materialInstances: experiment?.materialInstances,
    materialAssignments: experiment
      ? Object.fromEntries(experiment.assignments.map((entry) => [entry.meshId, entry.materialId]))
      : undefined,
  };
}

export function validateEditableGraphDocument(document: EditableGraphLabDocument): string[] {
  const errors: string[] = [];
  const resourceIds = new Set(Object.keys(document.resources));
  const passNames = new Set<string>();

  if (!document.id.match(/^[a-zA-Z0-9_-]+$/)) {
    errors.push("Blueprint id only supports letters, numbers, underscore, and dash.");
  }
  if (!document.name.trim()) {
    errors.push("Blueprint name is required.");
  }
  if (!resourceIds.has(document.output)) {
    errors.push(`Output resource is missing: ${document.output}`);
  }
  for (const pass of document.passes) {
    if (passNames.has(pass.name)) {
      errors.push(`Duplicate pass name: ${pass.name}`);
    }
    passNames.add(pass.name);
    if (!document.shaders[pass.shader]) {
      errors.push(`Pass ${pass.name} references missing shader: ${pass.shader}`);
    }
    if (!resourceIds.has(pass.color)) {
      errors.push(`Pass ${pass.name} writes missing color resource: ${pass.color}`);
    }
    if (pass.type === "mesh" && pass.depth && !resourceIds.has(pass.depth)) {
      errors.push(`Pass ${pass.name} writes missing depth resource: ${pass.depth}`);
    }
    for (const read of pass.reads ?? []) {
      if (!resourceIds.has(read)) {
        errors.push(`Pass ${pass.name} reads missing resource: ${read}`);
      }
    }
    const seenBindings = new Set<string>();
    for (const binding of pass.bindings ?? []) {
      const key = `${binding.group}:${binding.binding}`;
      if (seenBindings.has(key)) {
        errors.push(`Pass ${pass.name} has duplicate binding ${key}.`);
      }
      seenBindings.add(key);
      if (
        (binding.kind === "texture" || binding.kind === "sampler") &&
        !binding.source.startsWith("material.") &&
        !resourceIds.has(binding.source)
      ) {
        errors.push(`Pass ${pass.name} binding references missing resource: ${binding.source}`);
      }
    }
  }
  return errors;
}

export function validateEditableExperimentDocument(
  experiment: EditableExperimentDocument,
  blueprintIds: string[],
  sceneMeshIds: string[],
): string[] {
  const errors: string[] = [];
  const materialIds = new Set(experiment.materialInstances.map((material) => material.id));
  const meshIds = new Set(sceneMeshIds);

  if (!experiment.id.match(/^[a-zA-Z0-9_-]+$/)) {
    errors.push("Experiment id only supports letters, numbers, underscore, and dash.");
  }
  if (!experiment.name.trim()) {
    errors.push("Experiment name is required.");
  }
  if (!blueprintIds.includes(experiment.blueprintId)) {
    errors.push(`Experiment references missing blueprint: ${experiment.blueprintId}`);
  }
  for (const material of experiment.materialInstances) {
    if (!material.id.match(/^[a-zA-Z0-9_-]+$/)) {
      errors.push(`Invalid material id: ${material.id}`);
    }
    if (!material.name.trim()) {
      errors.push(`Material name is required: ${material.id}`);
    }
  }
  for (const assignment of experiment.assignments) {
    if (!meshIds.has(assignment.meshId)) {
      errors.push(`Assignment references missing mesh: ${assignment.meshId}`);
    }
    if (!materialIds.has(assignment.materialId)) {
      errors.push(`Assignment references missing material: ${assignment.materialId}`);
    }
  }
  return errors;
}

function resolveShaderUrl(
  shaderBase: string,
  shaderId: string,
  shaders: EditableGraphLabDocument["shaders"],
  shaderVersion: number,
) {
  const shader = shaders[shaderId];
  if (!shader) {
    return `${shaderBase}/shaders/missing.wgsl?v=${shaderVersion}`;
  }
  return `${shaderBase}/shaders/${shader.path}?v=${shaderVersion}`;
}

function toTitle(id: string) {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function defaultMeshShader() {
  return `struct FrameUniforms {
  viewProjection: mat4x4f,
  reserved: mat4x4f,
  resolutionTime: vec4f,
};

struct ParamsUniforms {
  values: array<vec4f, 16>,
};

struct ObjectUniforms {
  model: mat4x4f,
  modelViewProjection: mat4x4f,
};

struct MaterialUniforms {
  baseColor: vec4f,
  metallicRoughness: vec4f,
  textureFlags: vec4f,
};

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> params: ParamsUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;
@group(1) @binding(1) var<uniform> material: MaterialUniforms;
@group(1) @binding(2) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(3) var materialSampler: sampler;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(input.position, 1.0);
  output.normal = normalize((object.model * vec4f(input.normal, 0.0)).xyz);
  output.uv = input.uv;
  let texColor = textureSample(baseColorTexture, materialSampler, input.uv);
  output.color = mix(material.baseColor, material.baseColor * texColor, material.textureFlags.x);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let lightDirection = normalize(vec3f(-0.55, -1.0, -0.35));
  let n = normalize(input.normal);
  let ndotl = max(dot(n, -lightDirection), 0.0);
  let ambient = params.values[0].x;
  let lightIntensity = params.values[1].x;
  return vec4f(input.color.rgb * (ambient + ndotl * lightIntensity), input.color.a);
}
`;
}
