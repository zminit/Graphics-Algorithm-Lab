# Games Platform

图形学算法实验平台。当前完成阶段 0 和阶段 2：Vite + TypeScript + WebGPU 最小可运行骨架，以及标准资产库和场景预设的第一版。

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
