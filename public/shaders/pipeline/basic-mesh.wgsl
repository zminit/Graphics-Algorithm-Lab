struct FrameUniforms {
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
@group(0) @binding(1) var<uniform> params: ParamsUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;
@group(1) @binding(1) var<uniform> material: MaterialUniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(input.position, 1.0);
  output.normal = normalize((object.model * vec4f(input.normal, 0.0)).xyz);
  output.color = material.baseColor;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let lightDirection = normalize(vec3f(-0.55, -1.0, -0.35));
  let n = normalize(input.normal);
  let ndotl = max(dot(n, -lightDirection), 0.0);
  let ambient = params.values[0].x;
  let lightIntensity = params.values[1].x;
  let normalMix = params.values[2].x;
  let normalColor = n * 0.5 + vec3f(0.5);
  let base = mix(input.color.rgb, normalColor, normalMix);
  return vec4f(base * (ambient + ndotl * lightIntensity), input.color.a);
}
