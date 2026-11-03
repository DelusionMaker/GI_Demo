import { actionBound, makeObservable, observable } from 'mobx'
import { clusterStats } from './clusterStats'

/** 采样间隔：与 perfStore 一致，面板不需要每帧刷新 */
const SAMPLE_INTERVAL_MS = 200

/**
 * Clustered 统计的展示层（MobX），数据源是 `clusterStats`（非响应式）。
 *
 * 为什么不在 useFrame 里直接写 observable：每帧写会触发每帧重渲染，
 * 这条约束在本项目已经踩过一次（见 TODO「每帧数据」一行）。
 */
export class ClusterStore {
  enabled = false
  requestedLights = 0
  activeLights = 0
  totalClusters = 0
  litClusters = 0
  avgLightsPerCluster = 0
  cullCpuMs = 0
  truncatedClusters = 0

  private timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    makeObservable(this, {
      enabled: observable,
      requestedLights: observable,
      activeLights: observable,
      totalClusters: observable,
      litClusters: observable,
      avgLightsPerCluster: observable,
      cullCpuMs: observable,
      truncatedClusters: observable,
      sample: actionBound,
    })
  }

  startSampling(): void {
    if (this.timer !== null) return
    this.timer = setInterval(this.sample, SAMPLE_INTERVAL_MS)
  }

  stopSampling(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  sample(): void {
    this.enabled = clusterStats.enabled
    this.requestedLights = clusterStats.requestedLights
    this.activeLights = clusterStats.activeLights
    this.totalClusters = clusterStats.totalClusters
    this.litClusters = clusterStats.litClusters
    this.avgLightsPerCluster = clusterStats.avgLightsPerCluster
    this.cullCpuMs = clusterStats.cullCpuMs
    this.truncatedClusters = clusterStats.truncatedClusters
  }
}

export const clusterStore = new ClusterStore()
