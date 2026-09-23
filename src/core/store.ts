import { useSyncExternalStore } from 'react'

export type Listener = () => void

/**
 * 极简 store：不引入状态管理库，足够承载
 * - 渲染能力 / 后端档位
 * - demo 参数（配合 demoStore 做 URL 序列化）
 * 约定：set 只在真正变化时才产生新引用，因此可直接用于 useSyncExternalStore。
 */
export interface Store<T extends object> {
  get(): T
  set(patch: Partial<T> | ((prev: T) => Partial<T>)): void
  subscribe(listener: Listener): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<Listener>()

  const get = () => state

  const set = (patch: Partial<T> | ((prev: T) => Partial<T>)) => {
    const next = typeof patch === 'function' ? patch(state) : patch
    let changed = false
    for (const key of Object.keys(next) as (keyof T)[]) {
      if (!Object.is(state[key], next[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    state = { ...state, ...next }
    listeners.forEach((listener) => listener())
  }

  const subscribe = (listener: Listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return { get, set, subscribe }
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
