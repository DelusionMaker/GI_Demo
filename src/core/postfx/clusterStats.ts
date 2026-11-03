/**
 * Clustered 剔除的**非响应式**帧内统计（p1-light-ssr S3-d）。
 *
 * 与 `perfStats` 同样的分工：
 * - 本单例由画布内的 `GBufferLightSync` 每帧写入 —— 这里绝不能触发 React 更新；
 * - `clusterStore` 以 5Hz 把它采样成 observable，供 DOM 面板消费。
 *
 * 口径说明（写进面板与 README，避免被问到时说不清）：
 * - `avgLightsPerCluster` 是**按 cluster 平均**，不是严格逐像素循环次数；
 *   两者接近，但深度切片内像素分布不均，cluster 平均是估计值。
 * - `cullCpuMs` 覆盖「CPU 重建 cluster 列表 + 标记纹理重传」，
 *   不含 GPU 侧真正的 `texSubImage2D`（那发生在绘制提交时）。
 */
export interface ClusterSnapshot {
  /** 本帧是否真的走 clustered 路径（关闭时其余统计无意义） */
  enabled: boolean
  /** 场景里收集到的灯数（平行光 + 点光 + 聚光） */
  requestedLights: number
  /** 真正写进 uniform 的灯数（超过 MAX_LIGHTS 会被丢弃） */
  activeLights: number
  totalClusters: number
  litClusters: number
  avgLightsPerCluster: number
  /** CPU 侧剔除 + 上传准备耗时（ms） */
  cullCpuMs: number
  /** 单 cluster 灯数被 MAX_LIGHTS 截断的 cluster 数（> 0 会局部漏光） */
  truncatedClusters: number
}

export const clusterStats: ClusterSnapshot = {
  enabled: false,
  requestedLights: 0,
  activeLights: 0,
  totalClusters: 0,
  litClusters: 0,
  avgLightsPerCluster: 0,
  cullCpuMs: 0,
  truncatedClusters: 0,
}

/** 每帧调用；`Object.assign` 保持零分配（不要在这里 new 对象） */
export function recordClusterFrame(patch: Partial<ClusterSnapshot>): void {
  Object.assign(clusterStats, patch)
}
