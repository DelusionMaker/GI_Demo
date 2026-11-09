/**
 * p3-bake S1 · Node CLI 烘焙器（框架部分），`npm run bake` 入口。
 *
 * 运行方式：Node 24 原生 type stripping，直接 `node scripts/bake-probes.ts`，
 * 不引入 tsx / vite-node 等新依赖。因此本文件与它 import 的模块链必须：
 * 显式写 `.ts` 扩展名、不用 `@/` 别名、不 import three / React / DOM。
 *
 * 骨架阶段（BAKE_MATH_IMPLEMENTED=false）只做自检提示，**不写产物、不报假数字**。
 * 填完 src/core/gi/bakeMath.ts 的三处算法段并把开关置 true 后，才会真实烘焙。
 *
 * 产物默认写 bake-out/（已 gitignore）；S3 若要随仓库发布，把 --out 指到
 * public/baked/ 并显式提交，产物带 format/version/seed/spp 可复现。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  BAKE_MATH_IMPLEMENTED,
  evalSH,
  projectToSH,
  sampleIndirect,
} from '../src/core/gi/bakeMath.ts'
import {
  COEFFS_PER_PROBE,
  DEFAULT_GRID,
  type BakedProbe,
  type BakedProbesFile,
  type Vec3,
} from '../src/core/gi/bakeTypes.ts'
import { CORNELL_LIGHT } from '../src/core/gi/cornellData.ts'
import { probeCount, probePosition } from '../src/core/gi/grid.ts'
import { createRng } from '../src/core/utils/random.ts'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

/** evalSH 的自检法线：±x / ±y / ±z */
const AXES: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

function printStub(): void {
  console.log('[bake] 骨架自检 —— 三处算法段尚未实现，本次不写产物、不输出性能数字。')
  console.log('[bake] 待本人实现：src/core/gi/bakeMath.ts')
  console.log('       ① sampleIndirect()  间接光采样积分')
  console.log('       ② projectToSH()     SH 投影')
  console.log('       ③ evalSH()          运行时求值（S2 的 shader 需同形）')
  console.log('       填完后把 BAKE_MATH_IMPLEMENTED 改为 true。')
  console.log('[bake] 待本人定稿：bakeTypes.ts 的 COEFFS_PER_PROBE / DEFAULT_GRID（spacing 与 dims）。')
  if (CORNELL_LIGHT.emission.every((c) => c === 0)) {
    console.log('[bake] 待本人定稿：cornellData.ts 的 CORNELL_LIGHT.emission 仍为 [0,0,0]，顶灯不发光。')
  }
  console.log('[bake] 参考：README「烘焙 GI 的数字口径」与 TODO 阶段 3 的 S0 契约。')
}

async function main(): Promise<void> {
  const seed = Number(arg('seed', '1'))
  const spp = Number(arg('spp', '64'))
  const out = arg('out', 'bake-out/cornell-sh-v1.json')
  const grid = DEFAULT_GRID
  const total = probeCount(grid)

  console.log(`[bake] grid=${grid.dims.join('×')} spacing=${grid.spacing} probes=${total} spp=${spp} seed=${seed}`)

  if (!BAKE_MATH_IMPLEMENTED) {
    printStub()
    return
  }

  if (CORNELL_LIGHT.emission.every((c) => c === 0)) {
    console.warn('[bake] 警告：顶灯 emission 全 0，间接光恒为黑；先定稿 CORNELL_LIGHT.emission。')
  }

  const start = performance.now()
  const probes: BakedProbe[] = []
  for (let i = 0; i < total; i++) {
    const pos = probePosition(grid, i)
    // 每探针独立 seed，保证结果与遍历顺序无关、可按探针复现
    const samples = sampleIndirect(pos, spp, createRng(seed + i * 7919))
    const coeffs = projectToSH(samples)
    if (coeffs.length !== COEFFS_PER_PROBE * 3) {
      throw new Error(`probe ${i}: 系数长度 ${coeffs.length}，应为 ${COEFFS_PER_PROBE * 3}`)
    }
    probes.push({ index: i, coeffs })
  }
  const elapsedMs = performance.now() - start

  // 求值自检：任何 NaN / Infinity 都说明投影或求值写错了，不能进产物
  for (const probe of probes) {
    for (const n of AXES) {
      const v = evalSH(probe.coeffs, n)
      if (v.some((c) => !Number.isFinite(c))) {
        throw new Error(`probe ${probe.index}: evalSH 返回非有限值 ${v.join(',')}`)
      }
    }
  }

  const file: BakedProbesFile = {
    format: 'gi-probe-sh',
    version: 1,
    status: 'implemented',
    seed,
    spp,
    coeffsPerProbe: COEFFS_PER_PROBE,
    grid,
    probes,
  }
  const json = JSON.stringify(file)
  const rawBytes = Buffer.byteLength(json)
  const gzipBytes = gzipSync(Buffer.from(json)).byteLength

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, json, 'utf8')

  // S0 第 5 项定的「三个数字」口径；GPU ms 与 CPU 插值耗时留到 S2 / 真机会话
  const residentBytes = total * COEFFS_PER_PROBE * 3 * 4
  console.log(`[bake] 产物 ${out}（status=implemented, seed=${seed}, spp=${spp}）`)
  console.log(`[bake] ① 烘焙耗时 ${elapsedMs.toFixed(1)} ms（单次；按 README 口径跑 3 次取中位数，同时报 spp 与探针数）`)
  console.log(`[bake] ② 产物体积 ${rawBytes} B / gzip ${gzipBytes} B`)
  console.log(
    `[bake] ③ 运行时开销 常驻约 ${residentBytes} B（${total} 探针 × ${COEFFS_PER_PROBE}×3 系数 × 4B）· 每片元 8 次探针采样（结构性指标）`,
  )
  console.log('[bake] 未含：CPU 插值耗时（S2 接入后 5Hz 采样）与 GPU ms（真机会话补）。')
}

main().catch((error: unknown) => {
  console.error('[bake] 失败：', error)
  process.exitCode = 1
})
