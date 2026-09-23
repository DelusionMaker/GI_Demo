import type { ComponentType } from 'react'

/**
 * 一个 demo 需要提供的全部内容。
 *
 * Stage = 画布 + HUD 的整体舞台，在这里落地文档「每个 demo 必备八块内容」的
 * 第 3（实时画布，含预设视角与巡航）、4（交互控制面板 + URL 序列化）、
 * 5（中间量可视化下拉）、6（性能面板）块。
 *
 * 其余块（问题陈述 / 算法概要 / 局限 / 源码与参考）由 DemoPage 依据
 * 元数据渲染，保证全站结构统一。
 */
export interface DemoModule {
  Stage: ComponentType
}
