import { createStore, type Store } from '../store'

export type DemoValue = string | number | boolean
export type DemoState = Record<string, DemoValue>

export interface DemoStore<T extends DemoState> extends Store<T> {
  reset(): void
  /** 当前状态对应的 query string（不含 '?'） */
  toSearch(): string
}

const WRITE_DEBOUNCE_MS = 150

/**
 * demo 参数 store，状态双向同步到 URL query。
 * 文档硬要求：「状态序列化进 URL query，可直接分享复现」。
 *
 * 只写与默认值不同的项 → 链接保持简短；
 * 读取时按默认值的类型做强制转换（number / boolean / string）。
 *
 * 用法提醒：defaults 请用「显式标注类型的常量」传入。
 * 直接写内联对象字面量时，boolean 属性会被推断成 true/false 字面量类型，
 * 导致后续 store.set({ flag: someBoolean }) 报类型错误。
 */
export function createDemoStore<T extends DemoState>(defaults: T): DemoStore<T> {
  const store = createStore<T>(readFromUrl(defaults))
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (state: T) => {
    const params = new URLSearchParams(window.location.search)
    for (const key of Object.keys(state)) {
      const value = state[key]
      if (Object.is(value, defaults[key])) {
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

  const scheduleFlush = (state: T) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      flush(state)
    }, WRITE_DEBOUNCE_MS)
  }

  return {
    ...store,
    set(patch) {
      store.set(patch)
      scheduleFlush(store.get())
    },
    reset() {
      store.set(defaults)
      scheduleFlush(store.get())
    },
    toSearch() {
      const params = new URLSearchParams()
      const state = store.get()
      for (const key of Object.keys(state)) {
        const value = state[key]
        if (Object.is(value, defaults[key])) continue
        params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
      }
      return params.toString()
    },
  }
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
