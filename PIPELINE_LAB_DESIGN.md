# Pipeline Lab / Shader Lab 设计讨论稿

> 当前状态：开发临时中止。本文件用于讨论接下来的平台方向，暂不提交 git。

## 1. 背景

目前平台已经具备：

- WebGPU 初始化和 render loop。
- Lab 生命周期和实验切换。
- 标准资产库和场景 preset。
- Orbit Camera。
- GLB 加载和基础 mesh 渲染。
- 参数面板。
- Debug View。
- 初版 Shadow Mapping Lab。
- Runtime Log。

但当前 Lab 的问题也很明显：

- 一个算法 Lab 需要写大量 TypeScript 工程代码。
- Shader 逻辑被夹在 pipeline、buffer、bind group、texture 创建代码中间。
- 学习重点容易从算法思想偏移到 WebGPU boilerplate。
- Shadow Mapping 这类算法每次都要重复创建 pass、render target、uniform、debug texture。
- 用户主要只能调参数，还不能方便地“亲手写运算逻辑”。

因此接下来平台更应该转向：

```text
Pipeline Lab / Shader Lab
```

核心目标是：

```text
平台负责工程底座
用户负责 pass 组织和 shader 算法逻辑
```

## 2. 目标

### 2.1 主要目标

让用户可以用很少的 TypeScript 代码声明一个渲染算法实验：

```ts
export default definePipelineLab({
  name: "PCF Shadow Mapping",
  scene: BuiltinAssets.scenes.shadowTest,
  params: { ... },
  targets: { ... },
  passes: [ ... ],
});
```

用户主要手写：

- WGSL shader。
- pass 顺序。
- render target 输入输出。
- 算法参数。
- 少量可选 hook。

平台自动处理：

- pipeline 创建。
- bind group 创建。
- uniform buffer 更新。
- scene mesh draw。
- fullscreen triangle draw。
- render target resize。
- texture usage。
- debug texture 注册。
- screen output。
- 参数面板绑定。
- 常用 camera/object/frame uniform。

### 2.2 非目标

短期不做：

- 完整 Unity ShaderLab 兼容。
- 材质节点系统。
- 完整 Render Graph。
- ECS。
- 大型编辑器。
- 自动 shader include/preprocessor 的复杂系统。
- 通用图形 API 抽象层。

这套系统首先服务于学习 GAMES202 / 实时渲染算法，不是做商业引擎。

## 3. 为什么不能只写 vertex/fragment shader

很多渲染算法不仅仅是单个 shader。

例如 Shadow Mapping 需要：

```text
Pass 1: 从光源视角渲染 depth texture
Pass 2: 从相机视角渲染 scene，并采样 shadow map
```

SSAO 需要：

```text
Pass 1: GBuffer normal/depth
Pass 2: fullscreen SSAO
Pass 3: blur
Pass 4: composite
```

TAA 需要：

```text
jittered camera
velocity buffer
history buffer
resolve pass
history swap
```

所以如果平台只允许“写一个 vertex shader + fragment shader”，很快就不够用了。

更合适的抽象是：

```text
shader + pass + resource
```

即：

- shader 描述单个 pass 的运算。
- pass 描述 shader 如何执行。
- resource 描述 pass 之间如何传递中间结果。

## 4. 能覆盖哪些算法

### 4.1 很适合 Pipeline Lab 的算法

```text
Shadow Mapping
PCF
PCSS
VSSM
Deferred Shading
SSAO
SSR
Bloom
Tone Mapping
FXAA
TAA resolve
PBR direct lighting
IBL lookup
GBuffer visualization
Depth/Normal/Position debug
```

这些算法通常可以拆成：

```text
mesh pass
fullscreen pass
render target
debug view
```

### 4.2 可以支持，但需要扩展的算法

```text
Path Tracing
Progressive Accumulation
Compute-based postprocess
Tiled/clustered lighting
BRDF LUT generation
Environment prefilter
```

这些需要：

- compute pass。
- storage buffer。
- accumulation texture。
- ping-pong texture。
- frame index。

### 4.3 不适合只靠 Pipeline Lab 的方向

```text
NeRF training
3D Gaussian training
复杂 BVH 构建
大型 asset pipeline
复杂 animation system
```

这些后续需要 Python/PyTorch/CUDA 或专门数据结构，不应强行塞进初版 Pipeline Lab。

## 5. 推荐抽象层级

建议分三层能力。

### 5.1 Level 1：Shader Only Lab

适合 fullscreen 后处理或 procedural shader。

用户只写：

```text
shader.wgsl
params
```

平台自动：

```text
draw fullscreen triangle
output to screen
bind time/resolution/params
```

适合：

```text
tone mapping
gamma correction
color grading
procedural pattern
UV visualization
simple postprocess
```

### 5.2 Level 2：Mesh Shader Lab

适合单 pass mesh 渲染。

用户写：

```text
vertex shader
fragment shader
params
scene preset
```

平台自动：

```text
load scene
iterate scene meshes
bind camera/object/material uniforms
drawIndexed
```

适合：

```text
Phong
Blinn-Phong
normal visualization
basic PBR
normal mapping
basic shadow resolve
```

### 5.3 Level 3：Pipeline Lab

适合多 pass 渲染算法。

用户写：

```text
targets
passes
shader
params
optional hooks
```

平台自动：

```text
render target lifecycle
pass scheduling
resource binding
debug registration
screen copy/present
resize
```

适合：

```text
Shadow Mapping
PCF
SSAO
Bloom
Deferred Shading
SSR
TAA
```

## 6. 初版 API 草案

### 6.1 definePipelineLab

```ts
export default definePipelineLab({
  id: "shadow-pcf",
  name: "PCF Shadow Mapping",
  scene: BuiltinAssets.scenes.shadowTest,

  params: {
    bias: float(0.003, { min: 0, max: 0.02, step: 0.0001 }),
    filterRadius: float(2, { min: 1, max: 8, step: 1 }),
    shadowResolution: select("1024", ["512", "1024", "2048"]),
  },

  targets: {
    shadowMap: depthTarget({
      format: "depth32float",
      size: param("shadowResolution"),
      debug: true,
    }),

    color: colorTarget({
      format: "canvas",
      debug: true,
    }),

    cameraDepth: depthTarget({
      format: "depth24plus",
      size: "canvas",
    }),
  },

  passes: [
    meshPass({
      name: "Shadow Depth",
      camera: lightCamera({
        direction: [-0.55, -1, -0.35],
        target: [0, 0.6, 0],
        distance: 8,
        size: 6,
      }),
      depth: "shadowMap",
      shader: "./shaders/shadow-depth.wgsl",
    }),

    meshPass({
      name: "Main Lighting",
      camera: "main",
      color: "color",
      depth: "cameraDepth",
      shader: "./shaders/shadow-main.wgsl",
      inputs: {
        shadowMap: "shadowMap",
      },
      present: true,
    }),
  ],
});
```

### 6.2 参数 DSL

```ts
params: {
  bias: float(0.003, { min: 0, max: 0.02, step: 0.0001 }),
  sampleCount: int(16, { min: 1, max: 64 }),
  enabled: bool(true),
  mode: select("pcf", ["hard", "pcf", "pcss"]),
  tint: color([1, 0.8, 0.6]),
  lightDir: vec3([-0.5, -1, -0.3]),
}
```

平台自动：

- 创建 GUI 控件。
- 创建 params uniform buffer。
- 每帧同步参数到 GPU。
- 支持 reset/save/load。

### 6.3 资源声明

```ts
targets: {
  gNormal: colorTarget({
    format: "rgba16float",
    size: "canvas",
    debug: true,
  }),

  gAlbedo: colorTarget({
    format: "rgba8unorm",
    size: "canvas",
    debug: true,
  }),

  sceneDepth: depthTarget({
    format: "depth32float",
    size: "canvas",
    debug: true,
  }),
}
```

### 6.4 Pass 类型

#### Mesh Pass

```ts
meshPass({
  name: "GBuffer",
  camera: "main",
  color: ["gNormal", "gAlbedo"],
  depth: "sceneDepth",
  shader: "./gbuffer.wgsl",
});
```

平台负责：

- scene mesh iteration。
- vertex/index buffer binding。
- object uniform。
- material uniform。
- drawIndexed。

#### Fullscreen Pass

```ts
fullscreenPass({
  name: "SSAO",
  shader: "./ssao.wgsl",
  color: "ao",
  inputs: {
    normal: "gNormal",
    depth: "sceneDepth",
    noise: BuiltinAssets.textures.blueNoise,
  },
});
```

平台负责：

- fullscreen triangle。
- input texture bind group。
- output render target。

#### Compute Pass

初版可以先不做，后续再加。

```ts
computePass({
  name: "Histogram",
  shader: "./histogram.wgsl",
  dispatch: [16, 16, 1],
  inputs: { color: "sceneColor" },
  outputs: { histogram: "histogramBuffer" },
});
```

## 7. Built-in Uniform 设计

平台应该提供几组固定 uniform，让 shader 有稳定入口。

### 7.1 Frame Uniform

```wgsl
struct FrameUniforms {
  viewProjection: mat4x4f,
  view: mat4x4f,
  projection: mat4x4f,
  cameraPosition: vec4f,
  resolutionTime: vec4f, // width, height, time, deltaTime
}
```

### 7.2 Object Uniform

```wgsl
struct ObjectUniforms {
  model: mat4x4f,
  modelViewProjection: mat4x4f,
  normalMatrix: mat4x4f,
}
```

### 7.3 Material Uniform

```wgsl
struct MaterialUniforms {
  baseColor: vec4f,
  metallicRoughness: vec4f,
}
```

### 7.4 Params Uniform

初版可以统一打包为 `vec4f[]`，由 DSL 自动分配 offset。

```wgsl
struct Params {
  bias: f32,
  filterRadius: f32,
  mode: f32,
  enabled: f32,
}
```

更现实的初版方案：

```wgsl
struct ParamsUniforms {
  values: array<vec4f, 16>,
}
```

优点：

- 简单。
- 避免复杂 WGSL struct 生成。
- 适合实验平台。

缺点：

- shader 中参数访问不够语义化。

后续可加入自动生成 WGSL param struct。

## 8. Shader 文件风格

建议保留普通 WGSL，不发明复杂 DSL。

例如 `shadow-main.wgsl`：

```wgsl
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> params: ParamsUniforms;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var shadowMap: texture_depth_2d;

@group(1) @binding(0) var<uniform> object: ObjectUniforms;
@group(1) @binding(1) var<uniform> material: MaterialUniforms;
```

平台提供约定：

```text
group(0): frame/pass/params/input textures
group(1): object/material
```

这样用户不用关心 bind group layout 的 TypeScript 创建逻辑，但仍然能理解 shader 数据来源。

## 9. 和 Unity Shader 的区别

可以借鉴 Unity ShaderLab：

- 一个实验可以包含多个 pass。
- pass 里指定 vertex/fragment。
- 参数自动出现在 Inspector。

但不要完全模仿 Unity：

- Unity ShaderLab 隐藏太多 render target 和 pass 关系。
- 很多现代算法仍然要写 C# Render Feature。
- 对学习 render target / GBuffer / history / debug texture 不够显式。

本平台应该更显式：

```text
这个 pass 写哪个 target
这个 pass 读哪个 texture
这个 target 是否 debug
这个 pass 是否 present
```

## 10. 推荐实现阶段

### Phase A：Pipeline Lab 最小闭环

目标：支持一个 mesh pass 输出到 screen。

内容：

- `definePipelineLab`
- `meshPass`
- scene mesh iteration
- built-in frame/object/material uniform
- basic params uniform
- output to screen

验收：

- 用 Pipeline Lab 重写 `Basic Mesh`。
- 用户只写 spec + WGSL，不写 WebGPU pipeline boilerplate。

### Phase B：Render Target 和 Debug

目标：支持 offscreen color/depth target。

内容：

- `colorTarget`
- `depthTarget`
- resize lifecycle
- texture input binding
- debug auto registration
- present target to canvas

验收：

- Pipeline Lab 可以实现：

```text
mesh pass -> offscreen color -> present
```

### Phase C：Shadow Mapping Pipeline

目标：用 Pipeline Lab 重写 Shadow Mapping。

内容：

- light camera helper
- depth-only mesh pass
- depth texture input
- comparison sampler
- shadow map debug view

验收：

- 旧 ShadowMappingLab class 可以删除或保留作对照。
- PCF 只需要改 shader 和参数，不需要写新 WebGPU 工程代码。

### Phase D：Fullscreen Pass

目标：支持 postprocess / SSAO / Bloom。

内容：

- fullscreen triangle。
- input texture sampling。
- output color target。
- ping-pong target。

验收：

- 实现 simple tone mapping。
- 实现 depth/normal visualization。
- 为 SSAO 做准备。

### Phase E：Compute Pass

目标：支持更复杂算法。

内容：

- compute pipeline。
- storage texture。
- storage buffer。
- dispatch size。

验收：

- 简单 image blur compute。
- BRDF LUT / histogram / toy path tracing accumulation。

## 11. 建议先做的最小 API

为了避免设计过度，第一版只做：

```ts
definePipelineLab({
  id,
  name,
  scene,
  params,
  passes,
});
```

支持 pass：

```ts
meshPass({
  name,
  shader,
  color: "screen",
  depth: "auto",
  camera: "main",
});
```

支持 shader：

```text
vertexMain
fragmentMain
```

支持内置绑定：

```text
group(0) binding(0): FrameUniforms
group(1) binding(0): ObjectUniforms
group(1) binding(1): MaterialUniforms
```

先不做：

- 多 render target。
- texture inputs。
- compute pass。
- shader include。
- 自动生成 WGSL param struct。

等 `Basic Mesh` 用它跑通，再扩展。

## 12. 风险和取舍

### 12.1 抽象过度风险

如果一开始就做完整 Render Graph，会拖慢学习目标。

控制方法：

- 每次只为下一个算法补能力。
- 第一个目标只重写 Basic Mesh。
- 第二个目标才是 Shadow Mapping。

### 12.2 Shader 约定过强

如果平台固定 bind group 太死，用户写 shader 会被限制。

控制方法：

- 初版提供 built-in layout。
- 后续允许 advanced pass 自定义 bindings。

### 12.3 Debug 难度

声明式系统出错时可能比手写更难定位。

控制方法：

- Runtime Log 保留完整 WebGPU error。
- 每个 pass、pipeline、buffer、texture 都必须有 label。
- Pipeline Lab 编译时输出 pass summary。

### 12.4 性能不是第一目标

实验平台优先学习效率，不追求极致性能。

允许：

- 简单 uniform 更新。
- 简单 pass 调度。
- 一些中间 texture copy。

不允许：

- 频繁卡死。
- 错误信息不可见。
- Shader 调试困难。

## 13. 推荐下一步

建议暂停继续扩展旧式 Lab class。

下一步开发目标：

```text
实现 PipelineLabRunner Phase A
```

最小验收：

```text
用 definePipelineLab + meshPass + WGSL 重写 Basic Mesh
```

如果这个闭环体验好，再继续：

```text
Phase B: render target + debug
Phase C: shadow mapping pipeline
```

这样平台后续会从“写实验类”变成“写算法管线”，更符合学习图形学算法的目标。

## 14. 当前实现状态

已实现第一版 Hybrid Pipeline Lab 的最小闭环：

- `src/core/pipeline/`
- `definePipelineLab`
- `meshPass`
- 参数 DSL：`float/int/bool/select/color/vec3`
- 默认 mesh vertex layout：position / normal / uv
- built-in uniform source：`frame`、`params`、`object`、`material`
- Advanced uniform binding 声明：

```ts
uniform("frame", { group: 0, binding: 0, source: "frame" })
```

当前还未实现：

- custom texture binding
- sampler binding
- offscreen render target graph
- fullscreen pass
- compute pass
- shader include/preprocess

第一版示例：

```text
src/labs/pipeline-basic-mesh/PipelineBasicMeshLab.ts
public/shaders/pipeline/basic-mesh.wgsl
```
