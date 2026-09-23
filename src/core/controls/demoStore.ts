import { actionBound, computed, makeObservable, observable, reaction } from 'mobx'

export type DemoValue = string | number | boolean
export type DemoState = Record<string, DemoValue>

/** URL 写回延迟：拖滑块时避免每一帧都 replaceState */
const URL_SYNC_DELAY_MS = 150

/**
 * demo 参数 store（MobX），状态双向同步到 URL query。
 * 文档硬要求：「状态序列化进 URL query，可直接分享复现」。
 *
 * 只写与默认值不同的项 → 链接保持简短；
 * 读取时按默认值的类型做强制转换（number / boolean / string）。
 *
 * 用法提醒：defaults 请用「显式标注类型的常量」传入。
 * 直接写内联对象字面量时，boolean 属性会被推断成 true/false 字面量类型，
 * 导致后续 store.set({ flag: someBoolean }) 报类型错误。
 */
export class DemoStore<T extends DemoState> {
  /** 当前参数。observable.deep，组件里 store.params.x 即可被 observer 追踪 */
  params: T

  private readonly defaults: T
  private disposeUrlSync: (() => void) | null = null

  constructor(defaults: T) {
    this.defaults = defaults
    this.params = readFromUrl(defaults)

    makeObservable(this, {
      params: observable,
      set: actionBound,
      reset: actionBound,
      search: computed,
      shareUrl: computed,
    })

    // 用 reaction 替代手写 debounce：只在序列化结果真正变化时才写回 URL
    this.disposeUrlSync = reaction(
      () => this.search,
      () => this.applyToUrl(),
      { delay: URL_SYNC_DELAY_MS },
    )
  }

  /** 只包含与默认值不同的项，可直接作为 query string */
  get search(): string {
    const params = new URLSearchParams()
    for (const key of Object.keys(this.params)) {
      const value = this.params[key]
      if (Object.is(value, this.defaults[key])) continue
      params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
    }
    return params.toString()
  }

  /** 完整可分享链接 */
  get shareUrl(): string {
    const { origin, pathname, hash } = window.location
    return `${origin}${pathname}${this.search ? `?${this.search}` : ''}${hash}`
  }

  set(patch: Partial<T>): void {
    Object.assign(this.params, patch)
  }

  reset(): void {
    Object.assign(this.params, this.defaults)
  }

  /** 单页 demo 生命周期结束时调用，解除 URL 同步 */
  dispose(): void {
    this.disposeUrlSync?.()
    this.disposeUrlSync = null
  }

  /** 从当前 URL 读取后再合并写回：保留 seed / backend 这类外部参数 */
  private applyToUrl(): void {
    const params = new URLSearchParams(window.location.search)
    for (const key of Object.keys(this.params)) {
      const value = this.params[key]
      if (Object.is(value, this.defaults[key])) {
        params.delete(key)
      } else if (typeof value === 'boolean') {
        params.set(key, value ? '1' : '0')
      } else {
        params.set(key, String(value))
      }
    }
    const query = params.toString()
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', next)
  }
}

export function createDemoStore<T extends DemoState>(defaults: T): DemoStore<T> {
  return new DemoStore(defaults)
}

function readFromUrl<T extends DemoState>(defaults: T): T {
  const params = new URLSearchParams(window.location.search)
  const state: DemoState = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const raw = params.get(key)
    if (raw === null) continue
    const fallback = defaults[key]
    if (typeof fallback === 'number') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) state[key] = parsed
    } else if (typeof fallback === 'boolean') {
      state[key] = raw === '1' || raw === 'true'
    } else {
      state[key] = raw
    }
  }
  return state as T
}
