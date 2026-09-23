# 光照与全局光照 · Web 端技术作品集

以「光照 / GI」为单一主题的深度作品集，从渲染方程出发，逐层做到烘焙 GI 与实时 GI。
规划与技术决策见 [`TODO.md`](./TODO.md)，原始规划文档见 `ref_file/`。

## 技术栈

R3F（@react-three/fiber）+ Vite + three.js + React + TypeScript + MobX。
混合实现路线：three.js 管底座与资源，光照算法全部自写 shader。
状态管理统一走 MobX，约定见下方「状态管理」一节。

## 命令

```bash
npm install
npm run dev        # 本地开发，默认 http://localhost:5173
npm run typecheck  # 类型检查
npm run build      # 生产构建（tsc --noEmit && vite build）
npm run preview    # 预览构建产物
```

## 目录约定

```
src/
  core/                 # 共享基建，所有 demo 复用
    capabilities.ts     # 运行时渲染能力 / 后端档位 store（MobX）
    renderer/
      createRenderer.ts # 后端唯一分叉点（当前 WebGL2；阶段 4 在此切 WebGPU）
      CanvasRoot.tsx    # 统一 R3F Canvas 封装（DPR 上限、性能探针）
      PostFX.tsx        # 后处理链插槽（p0-hdr 在此接 HDR + 色调映射）
    camera/CameraRig.tsx # 预设视角 + 自动巡航 + 轨道操作
    controls/            # ControlPanel 组件 + DemoStore（MobX，URL 状态序列化）
    hud/Hud.tsx          # 四角插槽 HUD 容器
    perf/
      perfStats.ts      # 非响应式帧数据（画布内每帧写入，绝不能触发 React 更新）
      perfStore.ts      # MobX store，把 perfStats 以 5Hz 采样成 observable
      PerfProbe.tsx     # 画布内每帧采集
      PerfPanel.tsx     # observer 组件，展示 perfStore
    scene/               # 场景注册表 + 统一加载入口（含程序化占位回落）
    utils/random.ts      # 固定 seed 随机，服务视觉回归
  demos/                # 各 demo 实现（Stage = 画布 + HUD 整体舞台）
  site/                 # 首页卡片、demo 页模板、元数据
  styles/global.css     # 全站样式（flex 布局）
```

## 状态管理（MobX）

约定：store 是类，用 `makeObservable` 显式声明注解；组件用 `observer()` 订阅后直接读字段。

```ts
import { actionBound, computed, makeObservable, observable } from 'mobx'

class FooStore {
  count = 0
  constructor() {
    makeObservable(this, {
      count: observable,
      double: computed,
      inc: actionBound, // 自动绑定 this，可安全作为回调传递
    })
  }
  get double() {
    return this.count * 2
  }
  inc() {
    this.count += 1
  }
}
```

本项目踩过的两个 MobX 7 差异（v7 是新主版本，不要沿用 v6 写法）：

- 注解值必须是 `Annotation` 对象（`observable` / `computed` / `action` / `actionBound`），**不再接受 `"action.bound"` 这类字符串**。
- v6 的 `action.bound` 已移除，绑定动作改用 **`actionBound`**。

`perfStats` 刻意不是 store：它每帧被写入，做成响应式会导致每帧重渲染，因此由 `perfStore` 以 5Hz 采样后再交给面板。

## 新增一个 demo

1. 在 `src/demos/<id>/index.tsx` 实现并导出 `DemoModule`（`Stage` 组件）。
   参数用 `createDemoStore` 管理，注意 defaults 必须显式标注类型。
   读取参数的组件必须用 `observer()` 包裹，否则不会随参数变化重渲染。
2. 在 `src/demos/index.ts` 的 `DEMO_MODULES` 登记。
3. 在 `src/site/demos.ts` 的 `DEMOS` 补元数据（问题陈述 / 算法概要 / 局限 / 参考）。

完成后自动获得：预设视角与巡航、URL 可分享参数、性能面板、能力档位标注、统一文档结构。

## 当前状态

骨架（p0-base）已落地，含一个 `hello-cube` 冒烟 demo 验证全链路。
已实现的方向在 `TODO.md` 中勾选；其余条目在站点上明确标注为「规划中」。
