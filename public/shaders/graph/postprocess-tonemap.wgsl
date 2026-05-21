struct ParamsUniforms {
  values: array<vec4f, 16>,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> params: ParamsUniforms;
@group(0) @binding(1) var sceneColor: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = output.position.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(sceneColor, sceneSampler, input.uv).rgb;
  let exposure = params.values[2].x;
  let contrast = params.values[3].x;
  let vignetteStrength = params.values[4].x;
  let mapped = vec3f(1.0) - exp(-source * exposure);
  let contrasted = (mapped - vec3f(0.5)) * contrast + vec3f(0.5);
  let centered = input.uv - vec2f(0.5);
  let vignette = 1.0 - dot(centered, centered) * vignetteStrength;
  return vec4f(max(contrasted * vignette, vec3f(0.0)), 1.0);
}
