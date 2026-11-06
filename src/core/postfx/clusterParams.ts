import { createDemoStore } from '../controls/demoStore'

/**
 * p1-light-ssr S3 的用户旋钮（Clustered 多光源 / 剔除）。
 *
 * 与 `shadowParams` 同构：走 `createDemoStore`，自动获得 URL 序列化
 * （`?clustered=0&lightCount=32` 打开即复现）。
 *
 * 参数名避开 demo / HDR / 阴影已占用的键（`speed` / `scene` / `debug` / `env` / `ev` / `shadow*` …）。
 *
 * ⚠️ 默认值是「分享链接的语义契约」：`createDemoStore` 只序列化与默认值不同的项，
 * 所以一旦发布，改默认值会让历史链接的行为漂移。定稿后不要再动。
 */

export type ClusterParams = {
  /** false = 暴力遍历全部灯光（A/B 的对照组） */
  clustered: boolean
  /** 点光数量：0 = 不挂灯阵（保证现有 hdr / pbr-ibl 页面零回归） */
  lightCount: number
  /** 灯阵绕场景旋转：只为展示 per-frame 重建；默认关（会破坏截图确定性） */
  lightSpin: boolean
}

/**
 * 默认值已定稿（2026-11-06，见 DEVLOG）—— 三个值都是实验设计，不再随意改动：
 *
 * 1. `clustered: true`：默认走剔除路径；对照组由 `?clustered=0` 显式进入。
 * 2. `lightCount: 0`：`clusterParams` 是全站单例，非 0 会让 hdr / pbr-ibl /
 *    shadows 页面一进来就挂灯阵，hero 画面与 README 截图、白炉 / IBL 基线全部漂移。
 *    多光源只在显式带 `?lightCount=` 的链接或后续 `light-ssr` 页面里出现。
 * 3. `lightSpin: false`：旋转会破坏 A/B 截图的可比性。
 *
 * ⚠️ 这三个值是分享链接的语义契约，改动前先读文件头注释。
 */
export const CLUSTER_PARAM_DEFAULTS: ClusterParams = {
  clustered: true,
  lightCount: 0,
  lightSpin: false,
}

export const clusterParams = createDemoStore(CLUSTER_PARAM_DEFAULTS)

/**
 * 点光档位：**刻意用离散值而不是滑杆**。
 *
 * 理由（也是面试可讲的取舍）：性能对照表需要固定梯级才能复现；
 * 滑杆会产出无法对照的中间值，链接也失去「打开即同一组实验」的意义。
 *
 * TODO(作品集 · 你来定稿)：档位上限受 `MAX_LIGHTS` 约束 ——
 * 64 是**所有灯合计**，场景固定占 4 盏（主平行光 + 补光 + 灯阵的 2 盏聚光），
 * 所以点光最多 56。改这里之前先看 `gbufferShared.ts` 的 MAX_LIGHTS 与 `GBufferLightSync` 的截断逻辑。
 */
export const LIGHT_COUNT_STEPS = [0, 8, 32, 56] as const
