/**
 * 确定性随机。文档「视觉回归与性能门禁」要求固定 seed，
 * 否则 Playwright 截图 diff 无法稳定复现。
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  next(): number
  range(min: number, max: number): number
  int(min: number, max: number): number
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed)
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
  }
}

/** 从 URL 读取 seed，默认固定值 —— 保证首次打开与 CI 截图一致 */
export function readSeedFromUrl(fallback = 1): number {
  const raw = new URLSearchParams(window.location.search).get('seed')
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}
