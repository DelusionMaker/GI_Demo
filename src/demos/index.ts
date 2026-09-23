import { helloCubeDemo } from './hello-cube'
import type { DemoModule } from './types'

/**
 * demo id → 实现。新增 demo 时：
 * 1. 在 `src/demos/<id>/` 实现并导出 DemoModule
 * 2. 在此登记
 * 3. 在 `src/site/demos.ts` 补元数据（问题陈述 / 算法 / 局限 / 参考）
 */
export const DEMO_MODULES: Record<string, DemoModule> = {
  'hello-cube': helloCubeDemo,
}
