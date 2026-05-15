# Games Platform

图形学算法实验平台。当前完成阶段 0 到阶段 5：Vite + TypeScript + WebGPU 最小可运行骨架、Lab 系统 MVP、标准资产库和场景预设、基础相机/模型/mesh 渲染、参数面板系统，以及 Debug View 系统第一版。

## 开发命令

```bash
npm install
npm run dev
npm run build
npm run assets:generate
```

本地开发地址：

```text
http://127.0.0.1:5173
```

说明：当前机器未安装 `pnpm`，所以阶段 0 先使用 `npm`。后续可以无痛切换到 `pnpm`。

## 内置资产

运行时静态资源位于：

```text
public/assets/
```

核心目录：

```text
public/assets/builtin/models/
public/assets/builtin/textures/
public/assets/builtin/scenes/
public/assets/builtin/hdr/
```

源码侧通过 `src/core/assets/BuiltinAssets.ts` 统一引用资产路径。当前应用启动时会加载 `shadow-test.json`，用于验证场景 preset 和静态资源路径。

基础纹理和基础模型由 `tools/assets/generate-builtins.mjs` 生成：

```bash
npm run assets:generate
```

## Lab 系统

Lab 核心位于：

```text
src/core/lab/
```

当前内置两个验证实验：

```text
src/labs/clear-color/
src/labs/triangle/
src/labs/basic-mesh/
```

应用启动后会显示实验选择器，可以在 `Clear Color`、`Triangle` 和 `Basic Mesh` 之间切换，用于验证 Lab 的 `setup`、`render`、`dispose` 和运行时切换流程。

`Basic Mesh` 会加载内置 `shadow-test` 场景，显示 plane、cube、sphere，并支持 Orbit Camera：

- 左键拖拽：旋转
- Shift + 拖拽或中键拖拽：平移
- 滚轮：缩放

## 参数面板

GUI 核心位于：

```text
src/core/gui/GuiSystem.ts
```

Lab 可以通过 `ctx.gui.add(id, param)` 注册参数。当前支持：

```text
float
int
bool
enum
color
vec3
```

参数面板支持：

- Reset：恢复当前 Lab 初始参数
- Save：保存当前 Lab 参数到 `localStorage`
- Load：读取当前 Lab 保存过的参数

`Basic Mesh` 当前注册了背景色、环境光、光照强度、着色模式、自动旋转和旋转速度参数。

## Debug View

Debug View 核心位于：

```text
src/core/debug/DebugSystem.ts
```

Lab 可以通过 `ctx.debug.addTexture(...)` 注册 GPU color texture。当前第一版支持：

- `rgba8unorm`
- `bgra8unorm`
- 手动 Refresh 读取 GPU texture
- 在右侧面板预览 color texture

`Basic Mesh` 当前会先渲染到 offscreen color texture，再复制到屏幕，并把这张 `Main Color` texture 注册到 Debug View。
