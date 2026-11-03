import { useFrame } from '@react-three/fiber'
import { clusterParams } from './clusterParams'
import { gbufferShared } from './materials/gbufferShared'

/**
 * p1-light-ssr S3：把「剔除策略」参数每帧单向同步到共享 uniform。
 *
 * 三个硬约束（都是踩过坑之后定的，改之前先读完）：
 *
 * 1. **必须每帧写，不能在开关回调里写**：`gbufferShared` 是模块级单例，
 *    切换 demo 页面后上一页写的值会留下来（阴影阶段同样的教训）。
 * 2. **必须挂在 `<GBufferLightSync />` 之前**：R3F 中同优先级（0）的 `useFrame`
 *    按挂载顺序执行，而 `GBufferLightSync` 在帧内读 `uClustered` 决定是否重建
 *    cluster 列表 —— 挂晚了会有一帧的滞后（开关看起来「慢半拍」）。
 * 3. **没有额外光源时不启用剔除**：只有 1–2 盏平行光时它们覆盖全部 cluster，
 *    剔除毫无收益，却要每帧重建 + 上传约 1.5 MB 数据纹理（96k cluster × vec4）。
 *    这是「默认 lightCount = 0 时现有页面零回归」的关键。
 */
export function ClusterSync() {
  useFrame(() => {
    const { clustered, lightCount } = clusterParams.params
    gbufferShared.uClustered.value = clustered && lightCount > 0 ? 1 : 0
  })

  return null
}
