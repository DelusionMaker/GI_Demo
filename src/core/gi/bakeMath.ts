/**
 * p3-bake S1 · **作品集自写段**（三处 TODO，均不由工具代笔）。
 *
 * 与 p0-hdr 的三条色调曲线、Bloom 三段、p1-shadow 的 shadowFactor()、
 * p1-pbr-ibl 的 iblDiffuse/iblSpecular 是同一分工：框架保证「链路能跑、
 * 中间量可见、参数可复现」，数学留给自己写并在面试里讲清楚。
 *
 * 求交请自行 import `./trace.ts` 的 `traceCornell(origin, dir): Hit | null`：
 * 它返回命中距离、世界空间法线、albedo 与 emission，几何数据来自
 * `cornellData.ts`（与渲染侧同一份）。
 *
 * 统一口径（S0 已锁定，写错会直接破坏与 IBL 的叠加）：
 * - 本链路算的是**辐照度 E / π**（平均 radiance），不含 albedo、不含 kD；
 * - 着色侧统一乘 `kD * albedo`，与 `gbuffer_ibl.glsl` 的 irradianceOverPi 对齐；
 * - 若在这里提前乘材质项或补一个 π，白炉与 Cornell 色溢都会错。
 */

import { COEFFS_PER_PROBE, type RadianceSample, type Vec3 } from './bakeTypes.ts'
import type { Rng } from '../utils/random.ts'

/**
 * 三处算法段填完后，把它改成 true —— CLI 据此决定「骨架自检」还是「真实烘焙」。
 * 未实现状态必须可见：骨架阶段不会写出任何产物，也不会打印假的耗时数字。
 */
export const BAKE_MATH_IMPLEMENTED = false

/**
 * TODO(作品集 · 你来写) ① 每探针的间接光采样积分
 *
 * 目标：从 `origin` 往半球/球面发射 spp 条射线，用 `traceCornell` 求交，
 *       收集各方向的入射 radiance，返回给 SH 投影。
 * 要求：
 * - 方向由固定 seed 的 `rng` 生成（同一 seed 结果逐字节一致，服务可复现）；
 * - 至少处理一次间接弹射；命中发光面时把 emission 计入；
 * - 命中墙面时按 `albedo` 与余弦权重处理反射，注意能量不要凭空增长；
 * - 无命中方向返回 radiance = [0,0,0]。
 * 自查点：
 * - 常数环境 / 白炉条件下，SH 的 c₀ 应接近 π·L_avg（其余低阶系数趋近 0）；
 * - Cornell 红绿墙附近应出现可见色溢，且随探针位置连续变化；
 * - spp 翻倍时结果单调收敛，同 seed 两次运行完全一致。
 */
export function sampleIndirect(_origin: Vec3, _spp: number, _rng: Rng): RadianceSample[] {
  void _origin
  void _spp
  void _rng
  return []
}

/**
 * TODO(作品集 · 你来写) ② SH 投影
 *
 * 目标：把方向样本投影成每探针 `COEFFS_PER_PROBE × 3` 个系数（RGB 三通道）。
 * 要求：
 * - `cᵢ = ∫ L(ω) Yᵢ(ω) dω` 的蒙特卡洛估计，记得除以样本数与 pdf；
 * - 基函数阶数与 `bakeTypes.ts` 的 COEFFS_PER_PROBE 一致（定稿常量后不要偷改）；
 * - 输出顺序固定为「先 R 通道全部系数、再 G、再 B」，S2 的 shader 按同序读取。
 * 自查点：
 * - 常数 radiance 下只有 c₀ 非零；
 * - 系数有限（无 NaN / Infinity），量纲与 `E/π` 一致。
 */
export function projectToSH(_samples: readonly RadianceSample[]): number[] {
  void _samples
  return new Array<number>(COEFFS_PER_PROBE * 3).fill(0)
}

/**
 * TODO(作品集 · 你来写) ③ 运行时求值
 *
 * 目标：`E(n) ≈ Σᵢ cᵢ Yᵢ(n)`，按世界空间法线求该探针的辐照度。
 * 要求：
 * - 返回 `E/π`，**不乘 albedo / kD**（着色侧负责）；
 * - 与 ② 的系数顺序、基函数定义严格对应；
 * - S2 的 `gbuffer_gi.glsl` 必须与此函数同形（同 p0-hdr CPU/GPU 曲线约束），
 *   三线性权重见 `grid.ts` 的 trilinear()，别在 shader 里另写一套。
 * 自查点：
 * - 常数环境下任意 normal 返回同一个值；
 * - 结果非负且有限，低阶 SH 的振铃（负值）要说明如何钳制。
 */
export function evalSH(_coeffs: readonly number[], _normal: Vec3): Vec3 {
  void _coeffs
  void _normal
  return [0, 0, 0]
}
