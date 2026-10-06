import type { TonemapMode } from './HDRPipeline'

/**
 * 色调映射曲线（CPU 侧实现，供曲线图与将来的验证脚本使用）。
 *
 * ============================================================================
 * ⚠️ 这是 S2 里**要你自己写**的部分。
 *
 * GPU 侧同一组曲线在 `passes/TonemapOutputPass.ts` 的 `tonemap()` 里，
 * 两边必须给出相同结果。你需要做的三件事：
 *
 *   1. 实现下面三个函数（`reinhardCurve` / `acesCurve` / `agxCurve`）
 *   2. 在 `TonemapOutputPass.ts` 的 `tonemap()` 里写对应的 GLSL
 *   3. 决定「过曝回收」怎么呈现（该文件 main() 里有两种低成本做法的说明）
 *
 * 为什么同一组曲线要写两遍：GLSL 与 TS 无法共享源码，这是当前方案的已知代价。
 * 三个选项，选一个并把理由记进 DEVLOG：
 *   a) 两份手写，再加 e2e 断言两者在若干采样点上一致（最省事，但要防漂移）
 *   b) 只保留 GPU 版，曲线图改成把 1D LUT 渲到小 RenderTarget 再贴到 canvas
 *      （单一事实源，工作量更大）
 *   c) 用 TSL / 节点材质统一，代价是引入 WebGPU 后端
 * ============================================================================
 */
/**
 * slu: 用于 UI 显示曲线
 */
export type ToneCurve = (x: number) => number

/** 曲线图与验证脚本都按 [0, CURVE_DOMAIN_MAX] 采样 */
export const CURVE_DOMAIN_MAX = 8

// ============================================================================
// TODO(S2 · 你来写)：三条曲线
//
// 建议顺序：Reinhard（最简单，先建立信心）→ ACES → AgX（最难）。
//
// 每个函数都要满足：
//   1. x <= 0 时返回 0（片元可能传进负值，必须 clamp）
//   2. f(0) = 0
//   3. 单调不减
//   4. x → ∞ 时有界 —— 否则高光照样被截断，等于白做
//   5. 注意 f(1) 落在哪：它决定"中灰"被映射到哪个亮度，写完在图上看一眼
//
// 写完在图上对照虚线（直通参照），确认形状：
//   - ACES  ：暗部有 toe（起步较平）、高部有 shoulder（逐渐压平）
//   - AgX   ：中间调对比比 ACES 更陡
//   - Reinhard：最平缓，高光收敛慢，白色容易发灰
// ============================================================================

/**
 * TODO(S2 · 你来写)：Reinhard
 *
 * 最经典的形式是 x / (1 + x)。先写这个最简形式跑通，
 * 再判断是否需要扩展版（如 x(1 + x/W²) / (1 + x)）来控制高光收敛速度。
 * slu:（高光细节丢失‌：在极亮区域（如窗口、光源）细节保留不如专门的高光压缩算法。）/ W*2怎么确定
 */
export const reinhardCurve: ToneCurve = (x) => {
  void x
  const reinhard = x / (1 + x);
  // const reinhard = x * (1 + x / 4) / (1 + x);
  return reinhard;
}

/**
 * TODO(S2 · 你来写)：ACES（建议用 Narkowicz 2015 的拟合式）
 *
 * 提示：形式是分子分母都是二次的比值 x(ax + b) / (x(cx + d) + e)。
 * 查 Narkowicz 那组常数，注意它的约定是「输入线性 HDR、输出显示参考」。
 * slu: (compare to Stephen Hill ACES)
 */
export const acesCurve: ToneCurve = (x) => {
  void x
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const aces = Math.min(Math.max(x * (a * x + b) / (x * (c * x + d) + e), 0), 1);
  return aces;
}

/**
 * TODO(S2 · 你来写)：AgX
 *
 * 提示：AgX 不是一条简单曲线，而是「原色变换 → 对数编码 → sigmoid」三步。
 * 本函数只承担最后的标量曲线部分；若你要完整实现原色变换，
 * 那属于 GPU 侧的矩阵运算，CPU 侧保证曲线形状一致即可（并在 DEVLOG 说明差异）。
 *
 * 另外注意：AgX 通常需要配一个 contrast look，否则会觉得"灰"。
 */
export const agxCurve: ToneCurve = (x) => {
  // 规范 AgX 对比度曲线（Sobotka 拟合），与 GPU 侧 agxDefaultContrastApprox 保持一致。
  // 这只是标量曲线段；完整原色变换在 GPU 侧用矩阵完成，参见 tonemap-output.frag。
  const v = Math.max(0, x);
  const agx = 15.5 * Math.pow(v, 6) - 40.14 * Math.pow(v, 5) + 31.96 * Math.pow(v, 4)
            - 6.868 * Math.pow(v, 3) + 0.4298 * Math.pow(v, 2) + 0.1191 * v - 0.00232;
  return Math.min(Math.max(agx, 0), 1);
};

/** 直通曲线：仅作为图上的虚线参照，不代表要渲染成"线性" */
export const linearCurve: ToneCurve = (x) => Math.max(0, x)

export const TONE_CURVES: Record<TonemapMode, ToneCurve> = {
  linear: linearCurve,
  reinhard: reinhardCurve,
  aces: acesCurve,
  agx: agxCurve,
}

/**
 * 取曲线并做兜底：URL 里的 `tm` 可能是任意字符串，
 * 若不校验会拿到 undefined 而崩在图里。
 */
export function resolveCurve(mode: string): ToneCurve {
  return (TONE_CURVES as Record<string, ToneCurve | undefined>)[mode] ?? linearCurve
}

/** 校验 URL 里的曲线名是否合法（同样用于下拉的取值兜底） */
export function isTonemapMode(value: string): value is TonemapMode {
  return value in TONE_CURVES
}

/** 判断曲线是否已实现：未实现时函数恒返回 0，曲线图上会标"未实现" */
export function isCurveImplemented(mode: string): boolean {
  if (mode === 'linear') return true
  const curve = resolveCurve(mode)
  return [0.25, 0.5, 1, 2, 4].some((x) => curve(x) > 0)
}
