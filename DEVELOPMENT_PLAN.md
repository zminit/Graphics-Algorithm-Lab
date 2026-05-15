# 图形学算法实验平台开发文档

## 1. 平台定位

本项目的目标不是开发完整游戏引擎，而是构建一个面向图形学学习和实验的算法沙盒。

核心目标：

- 避免每次学习新算法都从零搭建 WebGPU、相机、模型加载、GUI 和调试环境。
- 让实验开发者主要关注算法思想、Shader 实现、数据流和可视化结果。
- 支持 GAMES202、GAMES104 中和渲染相关的核心算法实验。
- 后续扩展到 NeRF、3D Gaussian Splatting、神经渲染等前沿图形学方向。
- 每个实验都能保留参数、调试视图、截图、笔记和参考资料。

平台应该更像一个高级图形学 notebook，而不是一个小型游戏引擎。

## 2. 技术路线

第一阶段优先采用：

```text
TypeScript + Vite + WebGPU + WGSL + Tweakpane/lil-gui
```

选择原因：

- 启动和调试速度快。
- 不需要复杂 Native 工程、CMake、Vulkan SDK 或窗口系统。
- 非常适合实时渲染算法、Shader 实验和交互式参数调试。
- 可以自然地做调试纹理、A/B 对比、实验笔记和 Web UI。

后续神经渲染方向再引入：

```text
Python + PyTorch + CUDA 后端
```

Web 前端继续负责 Viewer、参数面板、训练状态展示、相机轨迹和结果对比。

## 3. 总体架构

```text
GamesPlatform
├─ App Shell
│  ├─ 实验选择器
│  ├─ 主 Viewport
│  ├─ 参数面板
│  ├─ Debug View 面板
│  └─ 实验笔记入口
│
├─ Core
│  ├─ WebGPU 初始化
│  ├─ Render Loop
│  ├─ Camera Controls
│  ├─ Asset Loader
│  ├─ Shader Loader
│  ├─ Buffer / Texture / RenderTarget Helper
│  ├─ GUI 参数系统
│  ├─ Debug Texture Viewer
│  └─ Lab 生命周期管理
│
├─ Labs
│  ├─ Shadow Mapping
│  ├─ PCF / PCSS / VSSM
│  ├─ SSAO / SSR / TAA
│  ├─ PBR / IBL
│  ├─ Ray Tracing / Path Tracing
│  ├─ NeRF Viewer
│  └─ 3D Gaussian Viewer
│
└─ ML Backend
   ├─ Dataset Loader
   ├─ Training Runner
   ├─ Checkpoint Manager
   └─ Result Exporter
```

## 4. 核心设计原则

1. 算法实验优先，不追求完整引擎化。
2. 平台工程代码只写一次，所有 Lab 复用。
3. 每个 Lab 必须有可调参数和调试输出。
4. 每个 Lab 应该能独立理解、运行和修改。
5. 优先支持 Shader 热更新、快速刷新和清晰错误提示。
6. 不过早引入 ECS、复杂 Render Graph、材质节点系统或完整编辑器。
7. 代码组织要允许渐进式扩展，而不是一次性设计成大框架。

## 5. Lab 接口设计

每个实验通过统一接口接入平台。

```ts
export interface Lab {
  id: string;
  name: string;
  category: LabCategory;
  description?: string;

  setup(ctx: LabContext): Promise<void> | void;
  update?(ctx: LabContext): void;
  render(ctx: LabContext): void;
  resize?(ctx: LabContext): void;
  dispose?(ctx: LabContext): void;
}
```

平台向实验提供统一上下文：

```ts
export interface LabContext {
  device: GPUDevice;
  queue: GPUQueue;
  canvas: HTMLCanvasElement;
  format: GPUTextureFormat;
  camera: Camera;
  time: TimeState;
  assets: AssetSystem;
  gui: GuiSystem;
  debug: DebugSystem;
  renderer: RenderHelper;
}
```

Lab 作者主要关心：

- `setup`: 加载模型、创建 pipeline、注册参数和 debug view。
- `update`: 更新相机、动画、uniform、实验状态。
- `render`: 编写当前算法的渲染流程。
- `dispose`: 释放实验资源。

## 6. 资产库和场景预设策略

平台应该内置一套小而精的标准资产库，避免每个 Lab 都临时搜索模型、纹理、HDRI 或重新布置场景。

资源管理目标：

- 大多数实验可以直接使用标准场景启动。
- Lab 代码不直接写散乱的文件路径，而是通过资产清单引用。
- 常用材质、天空盒、测试模型、调试纹理一次准备，多处复用。
- 特殊实验允许引入专用资源，但不能污染通用资产库。
- 所有第三方资源必须记录来源、许可证和处理流程。

推荐资产分层：

```text
assets/
├─ builtin/        # 平台内置标准测试资源，随项目长期维护
├─ external/       # 第三方下载资源，经过统一转换和压缩
└─ experiments/    # 某个实验专用资源，例如 NeRF 数据集或论文复现数据
```

### 6.1 Builtin 标准资产库

第一版内置资源不求多，但要覆盖常见实验需求：

```text
assets/builtin/
├─ models/
│  ├─ cube.glb
│  ├─ sphere.glb
│  ├─ plane.glb
│  ├─ suzanne.glb
│  ├─ cornell-box.glb
│  ├─ sponza-lite.glb
│  └─ material-test-spheres.glb
│
├─ textures/
│  ├─ checkerboard.png
│  ├─ uv-grid.png
│  ├─ white.png
│  ├─ black.png
│  ├─ gray.png
│  ├─ flat-normal.png
│  └─ blue-noise.png
│
├─ materials/
│  ├─ clay/
│  ├─ metal-rough/
│  ├─ plastic/
│  ├─ wood/
│  ├─ brick/
│  └─ fabric/
│
├─ hdr/
│  ├─ studio-small.hdr
│  ├─ outdoor-day.hdr
│  └─ indoor-soft.hdr
│
└─ scenes/
   ├─ empty-room.json
   ├─ shadow-test.json
   ├─ pbr-test.json
   ├─ postprocess-test.json
   └─ raytracing-cornell.json
```

### 6.2 按实验类型准备场景

不同算法需要不同的观察重点，因此场景应该按实验目的设计：

```text
Shadow / PCF / PCSS / VSSM
- 平面 + 几个遮挡物 + 可移动光源
- Cornell Box
- Sponza-lite

PBR / IBL
- material test spheres
- 多材质模型
- HDR environment

SSAO / SSR / TAA
- 几何层次丰富的房间
- 镜面地板或墙面
- 有细节的模型和运动相机

Path Tracing
- Cornell Box
- diffuse / metal / glass 对比场景
- area light 测试场景

NeRF / 3DGS
- images
- camera poses
- intrinsics
- sparse point cloud
- tiny synthetic dataset
```

场景文件应该描述使用哪些模型、材质、光源、相机初始位置和实验推荐参数。Lab 默认加载对应标准场景，只有在确实需要时才使用专用资源。

### 6.3 Asset Manifest

为了让 Lab 代码保持干净，平台应维护统一资产清单：

```ts
export const BuiltinAssets = {
  models: {
    cube: "assets/builtin/models/cube.glb",
    sphere: "assets/builtin/models/sphere.glb",
    cornellBox: "assets/builtin/models/cornell-box.glb",
    sponzaLite: "assets/builtin/models/sponza-lite.glb",
  },
  textures: {
    checkerboard: "assets/builtin/textures/checkerboard.png",
    uvGrid: "assets/builtin/textures/uv-grid.png",
    flatNormal: "assets/builtin/textures/flat-normal.png",
    blueNoise: "assets/builtin/textures/blue-noise.png",
  },
  hdr: {
    studioSmall: "assets/builtin/hdr/studio-small.hdr",
    outdoorDay: "assets/builtin/hdr/outdoor-day.hdr",
    indoorSoft: "assets/builtin/hdr/indoor-soft.hdr",
  },
  scenes: {
    shadowTest: "assets/builtin/scenes/shadow-test.json",
    pbrTest: "assets/builtin/scenes/pbr-test.json",
    postprocessTest: "assets/builtin/scenes/postprocess-test.json",
    raytracingCornell: "assets/builtin/scenes/raytracing-cornell.json",
  },
};
```

Lab 中推荐这样引用：

```ts
const scene = await ctx.assets.loadScene(BuiltinAssets.scenes.shadowTest);
const blueNoise = await ctx.assets.loadTexture(BuiltinAssets.textures.blueNoise);
```

### 6.4 第三方资源来源和许可证

优先选择许可证清晰、可长期本地保存的资源：

- Khronos glTF Sample Assets：用于 glTF、PBR、动画和模型加载测试。
- Poly Haven：用于 CC0 HDRI、PBR 材质和少量模型。
- ambientCG：用于 CC0 PBR 材质、HDRI 和模型。
- 自制程序化资源：checkerboard、uv-grid、flat-normal、基础几何体等。

原则：

- 不在运行时依赖在线资源。
- 下载后统一转换、压缩、重命名，并记录来源。
- 每个第三方资源目录放置 `LICENSE.md` 或 `SOURCE.md`。
- 不把大体积数据集直接塞进核心仓库，NeRF/3DGS 数据集进入 `assets/experiments/` 或单独下载缓存。

### 6.5 资源处理工具

后续可以加入资源脚本，但第一版只需要最小能力：

```text
tools/assets/
├─ generate-builtins.ts      # 生成 checker、uv-grid、flat-normal 等程序化纹理
├─ convert-gltf.ts           # 统一 glTF/GLB 命名和压缩入口
├─ build-manifest.ts         # 扫描 assets 并生成 BuiltinAssets
└─ validate-assets.ts        # 检查文件是否存在、许可证是否记录
```

验收标准：

- 常用 Lab 不需要临时找模型和纹理。
- Shadow、PBR、Postprocess、Path Tracing 至少各有一个默认场景。
- 资产路径通过 manifest 引用。
- 第三方资源有来源和许可证记录。

## 7. 推荐目录结构

```text
src/
├─ app/
│  ├─ App.ts
│  ├─ LabBrowser.ts
│  ├─ Viewport.ts
│  └─ Panels.ts
│
├─ core/
│  ├─ gpu/
│  │  ├─ initWebGPU.ts
│  │  ├─ RenderTarget.ts
│  │  ├─ BufferHelpers.ts
│  │  └─ PipelineHelpers.ts
│  │
│  ├─ camera/
│  │  ├─ Camera.ts
│  │  └─ OrbitControls.ts
│  │
│  ├─ assets/
│  │  ├─ AssetSystem.ts
│  │  ├─ BuiltinAssets.ts
│  │  ├─ ScenePreset.ts
│  │  ├─ loadTexture.ts
│  │  ├─ loadGLTF.ts
│  │  └─ loadScene.ts
│  │
│  ├─ gui/
│  │  ├─ GuiSystem.ts
│  │  └─ ParamSchema.ts
│  │
│  ├─ debug/
│  │  ├─ DebugSystem.ts
│  │  ├─ TextureViewer.ts
│  │  └─ BufferViewer.ts
│  │
│  ├─ renderer/
│  │  ├─ FullscreenPass.ts
│  │  ├─ MeshPass.ts
│  │  └─ RenderHelper.ts
│  │
│  └─ lab/
│     ├─ Lab.ts
│     ├─ LabContext.ts
│     └─ LabRegistry.ts
│
├─ labs/
│  ├─ 000-template/
│  ├─ 101-basic-rasterization/
│  ├─ 202-shadow-mapping/
│  ├─ 203-pcf-pcss/
│  ├─ 204-ssao/
│  ├─ 205-pbr/
│  ├─ 206-ibl/
│  ├─ 301-path-tracing/
│  ├─ 401-nerf-viewer/
│  └─ 402-3d-gaussian-viewer/
│
├─ assets/
│  ├─ builtin/
│  │  ├─ models/
│  │  ├─ textures/
│  │  ├─ materials/
│  │  ├─ hdr/
│  │  └─ scenes/
│  ├─ external/
│  └─ experiments/
│
└─ tools/
   └─ assets/
      ├─ generate-builtins.ts
      ├─ convert-gltf.ts
      ├─ build-manifest.ts
      └─ validate-assets.ts
```

单个 Lab 的目录：

```text
labs/202-shadow-mapping/
├─ index.ts
├─ params.ts
├─ notes.md
└─ shaders/
   ├─ depth.wgsl
   └─ shadow.wgsl
```

## 8. 阶段 0：项目骨架

目标：建立最小可运行工程。

开发内容：

- 初始化 Vite + TypeScript 项目。
- 配置 WebGPU 类型支持。
- 创建基础页面布局。
- 创建 Canvas 和渲染循环。
- 完成 WebGPU device、context、swapchain format 初始化。
- 输出第一帧清屏颜色。

验收标准：

- `pnpm dev` 能启动本地服务。
- 浏览器中能看到 WebGPU Canvas。
- Resize 时 Canvas 尺寸正确更新。
- 控制台无 WebGPU 初始化错误。

## 9. 阶段 1：Lab 系统 MVP

目标：让平台可以加载和切换实验。

开发内容：

- 定义 `Lab`、`LabContext`、`LabRegistry`。
- 创建实验选择器。
- 实现 Lab 生命周期：`setup`、`update`、`render`、`resize`、`dispose`。
- 创建 `000-template` 实验。
- 创建一个最小 Triangle Lab 或 Clear Color Lab。

验收标准：

- 可以从 UI 切换不同 Lab。
- 切换 Lab 时旧资源能正确释放。
- 新 Lab 能重新初始化并渲染。
- 新建实验时可以直接复制 `000-template`。

## 10. 阶段 2：标准资产库和场景预设

目标：建立可长期复用的内置资源系统，减少每个实验布置场景和搜集资源的时间。

开发内容：

- 创建 `assets/builtin/`、`assets/external/`、`assets/experiments/` 目录。
- 准备程序化基础纹理：
  - checkerboard
  - uv-grid
  - white / black / gray
  - flat-normal
  - blue-noise
- 准备基础几何模型：
  - cube
  - sphere
  - plane
  - material test spheres
- 准备第一批标准场景：
  - `shadow-test.json`
  - `pbr-test.json`
  - `postprocess-test.json`
  - `raytracing-cornell.json`
- 实现 `BuiltinAssets.ts`。
- 实现基础 `loadScene`，能从场景 preset 加载模型、材质、光源和相机默认位置。
- 建立 `SOURCE.md` / `LICENSE.md` 记录规范。

验收标准：

- Lab 可以通过 `BuiltinAssets` 引用模型、纹理、HDRI 和场景。
- 至少有一个 Shadow 测试场景和一个 PBR 测试场景。
- 不需要联网也能运行第一批实验。
- 第三方资源来源和许可证有记录。

## 11. 阶段 3：相机、模型和基础渲染

目标：所有后续算法实验都能复用基础 3D 场景能力。

开发内容：

- 实现 `Camera` 和 `OrbitControls`。
- 支持鼠标旋转、缩放、平移。
- 实现基础 mesh 数据结构。
- 支持加载简单内置几何体：cube、plane、sphere。
- 接入 glTF/GLB 加载。
- 实现基础 mesh render pass。
- 实现 uniform buffer helper。
- 创建 Basic Mesh Lab。

验收标准：

- 可以在 Viewport 中查看 3D 模型。
- 相机控制稳定、手感可用。
- 可以加载至少一个 `.glb` 模型。
- Lab 作者不需要重复写相机和基础 mesh 绘制代码。

## 12. 阶段 4：参数面板系统

目标：让算法参数可以快速暴露到 UI 中。

开发内容：

- 接入 Tweakpane 或 lil-gui。
- 封装 `GuiSystem`。
- 支持参数类型：
  - `float`
  - `int`
  - `bool`
  - `enum`
  - `color`
  - `vec2`
  - `vec3`
- 支持参数 reset。
- 支持参数 preset 保存和加载。
- 参数变化后触发 Lab 更新。

验收标准：

- Lab 可以用少量代码注册参数。
- 参数变化能实时影响渲染。
- 可以保存一组参数 preset。
- 切换 Lab 后参数面板自动刷新。

## 13. 阶段 5：Debug View 系统

目标：让算法中间结果可视化，提升学习效率。

开发内容：

- 实现 Debug Texture Viewer。
- 支持显示：
  - color texture
  - depth texture
  - normal texture
  - single channel texture
  - mip level
- 支持多个 debug view 注册。
- 支持全屏查看 debug texture。
- 支持简单 false color 显示。
- 支持 hover 读取像素值。

验收标准：

- Lab 可以注册中间纹理：

```ts
ctx.debug.addTexture("Shadow Map", shadowDepthTexture);
ctx.debug.addTexture("GBuffer Normal", normalTexture);
```

- UI 中可以选择并查看 debug texture。
- depth texture 能以可理解的方式显示。
- Debug View 不影响主渲染流程。

## 14. 阶段 6：Shadow Mapping Lab

目标：用第一个完整算法实验验证平台设计。

开发内容：

- 创建 `202-shadow-mapping` Lab。
- 实现 light camera。
- 实现 shadow depth pass。
- 实现 main lighting pass。
- 支持 hard shadow。
- 参数面板：
  - light position
  - shadow map resolution
  - depth bias
  - normal bias
  - light frustum size
- Debug View：
  - shadow map
  - light camera frustum
  - receiver depth

验收标准：

- 场景中可以看到正确阴影。
- 调节 bias 可以观察 shadow acne 和 peter panning。
- 可以查看 shadow map。
- `notes.md` 解释算法流程、常见问题和调试方法。

## 15. 阶段 7：GAMES202 实验扩展

目标：系统性覆盖实时渲染算法。

建议顺序：

1. PCF
2. PCSS
3. VSSM
4. SSAO
5. SSR
6. Bloom
7. TAA
8. PBR
9. IBL
10. Spherical Harmonics / PRT 入门

每个 Lab 都应包含：

- 算法参数。
- 原始结果和优化结果对比。
- 至少一个关键中间结果 debug view。
- `notes.md` 学习笔记。
- 常见错误记录。

验收标准：

- 每个算法都能独立运行。
- 每个算法都能从 UI 切换。
- 每个算法都有可视化调试入口。
- 每个算法都有可读笔记。

## 16. 阶段 8：A/B 对比和实验记录

目标：方便比较不同算法、参数和实现版本。

开发内容：

- 支持截图保存。
- 支持当前参数导出为 JSON。
- 支持 A/B 对比：
  - split view
  - slider wipe
  - reference/current
- 支持 error heatmap。
- 支持实验结果记录：

```text
experiment-runs/
├─ 2026-xx-xx-shadow-pcss/
│  ├─ params.json
│  ├─ screenshot.png
│  └─ notes.md
```

验收标准：

- 可以保存当前画面和参数。
- 可以对比两个算法模式或两组参数。
- 可以生成一次实验记录，方便复盘。

## 17. 阶段 9：Shader 开发体验

目标：降低 WGSL 实验成本。

开发内容：

- Shader 文件热更新。
- Shader 编译错误面板。
- Pipeline 创建错误格式化。
- 常用 WGSL include/preprocess 工具。
- 常用 shader chunk：
  - camera
  - lighting
  - pbr
  - fullscreen
  - random
  - sampling

验收标准：

- 修改 WGSL 后能快速看到结果。
- 编译错误能定位到文件和行号。
- Lab 可以复用公共 shader chunk。

## 18. 阶段 10：路径追踪和离线实验

目标：支持更偏算法研究的采样、积分和降噪实验。

开发内容：

- Compute shader fullscreen path tracing。
- Progressive accumulation。
- 随机采样工具。
- BRDF sampling debug。
- BVH 数据结构。
- 简单场景格式。
- Denoising 对比入口。

验收标准：

- 可以 progressive render 一个简单 Cornell Box。
- 支持 sample count、bounce count、BRDF mode 调节。
- 可以查看 convergence 过程。
- 可以保存不同 sample count 的结果对比。

## 19. 阶段 11：NeRF / 神经渲染 Viewer

目标：先做神经渲染结果查看器，不急着训练。

开发内容：

- Dataset 管理：
  - images
  - camera poses
  - intrinsics
- 相机轨迹可视化。
- Ray sampling 可视化。
- 支持加载预训练结果或导出的体数据。
- 前端展示：
  - target image
  - rendered image
  - loss curve
  - camera path

验收标准：

- 可以加载一个小型 NeRF 数据集。
- 可以查看相机位姿和图像对应关系。
- 可以显示训练输出结果。
- 可以用 Web UI 理解 ray sampling 和 volume rendering 流程。

## 20. 阶段 12：Python / PyTorch 后端

目标：让平台能驱动训练任务。

开发内容：

- Python FastAPI 或轻量 WebSocket 服务。
- 训练任务启动、暂停、停止。
- 训练状态推送：
  - iteration
  - loss
  - learning rate
  - preview image
  - checkpoint
- 数据集加载。
- checkpoint 保存和恢复。
- 前端训练面板。

验收标准：

- 可以从 Web UI 启动一个训练任务。
- 前端能实时显示 loss 和 preview。
- 可以停止训练并加载 checkpoint。
- 后端崩溃不会导致前端不可恢复。

## 21. 阶段 13：3D Gaussian Splatting Viewer

目标：支持 3DGS 结果查看和调试。

开发内容：

- 加载 Gaussian 数据：
  - position
  - rotation
  - scale
  - opacity
  - SH color
- 实现 splat rendering。
- 支持按 opacity、scale、depth、tile debug。
- 支持相机轨迹和数据集图像对比。
- 后续接训练后端。

验收标准：

- 可以加载并显示一个 3DGS 场景。
- 可以实时相机浏览。
- 可以切换不同 debug mode。
- 可以和数据集图像做视角对比。

## 22. 阶段 14：实验模板和脚手架

目标：进一步降低新建算法实验成本。

开发内容：

- 新建 Lab 命令：

```bash
pnpm new-lab shadow-pcss
```

- 自动生成：

```text
labs/xxx-name/
├─ index.ts
├─ params.ts
├─ notes.md
└─ shaders/main.wgsl
```

- 提供模板类型：
  - fullscreen pass
  - mesh pass
  - multipass
  - compute
  - postprocess
  - ml viewer

验收标准：

- 30 秒内能创建一个可运行的新 Lab。
- 新 Lab 自动出现在实验选择器中。
- 模板代码包含最小参数和 debug view 示例。

## 23. 暂不开发内容

以下内容先不做，避免偏离算法学习目标：

- 完整 ECS。
- 完整游戏引擎编辑器。
- 复杂场景编辑。
- 材质节点系统。
- 大型资源导入管线。
- 复杂动画系统。
- 跨平台 Native 渲染后端。
- 完整 Render Graph 框架。
- 完整物理系统。

这些内容只有在确实阻碍算法实验效率时再逐步引入。

## 24. 推荐里程碑

### Milestone 1：最小可用平台

包含阶段 0 到阶段 5。

产物：

- 可运行 WebGPU 应用。
- Lab 系统。
- 标准资产库和场景预设。
- 相机和基础模型显示。
- 参数面板。
- Debug Texture Viewer。

### Milestone 2：第一个完整算法闭环

包含阶段 6。

产物：

- Shadow Mapping Lab。
- 参数调试。
- Shadow Map 可视化。
- 学习笔记。

### Milestone 3：GAMES202 核心算法集

包含阶段 7 到阶段 9。

产物：

- PCF / PCSS / SSAO / PBR / IBL 等实验。
- A/B 对比。
- Shader 热更新。
- 实验记录系统。

### Milestone 4：离线渲染和采样实验

包含阶段 10。

产物：

- Path Tracing Lab。
- Progressive accumulation。
- BRDF sampling debug。

### Milestone 5：神经渲染扩展

包含阶段 11 到阶段 13。

产物：

- NeRF Viewer。
- Python/PyTorch 后端。
- 3DGS Viewer。
- 训练状态可视化。

### Milestone 6：长期学习工作流

包含阶段 14。

产物：

- Lab 脚手架。
- 多种实验模板。
- 稳定的实验记录和复盘流程。

## 25. 第一版实施顺序

建议严格按照下面顺序开始：

1. 初始化 Vite + TypeScript + WebGPU。
2. 渲染一个清屏 Canvas。
3. 定义 `Lab` 和 `LabContext`。
4. 做实验切换器。
5. 建立 `assets/builtin/` 和 `BuiltinAssets`。
6. 准备 checker、uv-grid、flat-normal、cube、sphere、plane。
7. 做 `shadow-test.json` 和 `pbr-test.json`。
8. 做 Orbit Camera。
9. 画 cube / plane。
10. 接参数面板。
11. 接 Debug Texture Viewer。
12. 做 Shadow Mapping。
13. 根据 Shadow Mapping 的痛点反向完善 Core 和资产系统。

第一版不要急着设计太多抽象。只有当两个以上 Lab 出现重复代码时，再把它提取到 Core。

## 26. 每个 Lab 的完成标准

一个 Lab 只有满足以下条件才算完成：

- 可以从实验选择器打开。
- 有清晰默认场景。
- 默认优先使用 `assets/builtin/` 中的标准场景。
- 有可调参数。
- 有至少一个关键中间结果 debug view。
- 有 `notes.md`。
- 有常见错误或调试建议。
- 可以截图保存当前结果。
- 代码不依赖其他具体 Lab。

## 27. 学习笔记模板

每个 Lab 的 `notes.md` 建议包含：

```text
# 算法名称

## 目标

## 核心思想

## 数学公式

## 实现步骤

## 参数解释

## Debug View 说明

## 常见问题

## 参考资料
```

## 28. 当前优先级结论

最高优先级不是算法数量，而是把实验工作流打通：

```text
创建 Lab -> 写 Shader -> 调参数 -> 看中间结果 -> 截图/对比 -> 写笔记
```

只要这个闭环足够顺滑，后面学习 GAMES202、GAMES104 渲染系统，以及 NeRF/3DGS 都会变得高效。
