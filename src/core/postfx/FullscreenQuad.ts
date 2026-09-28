import * as THREE from 'three'

/**
 * 全屏 pass 的通用顶点着色器。
 * 刻意忽略所有矩阵：顶点位置直接解释为裁剪空间坐标，
 * uv 由位置推导，因此不需要 uv 属性，也不需要相机参与运算。
 */
export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** 顶点着色器不使用矩阵，相机只需满足 three 的 render(scene, camera) 签名 */
const QUAD_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

let sharedGeometry: THREE.BufferGeometry | null = null

/**
 * 单个全屏三角形的几何。
 * 相比 PlaneGeometry(2,2) 拼的四边形：没有对角线上的重复着色，且不需要 uv 属性。
 */
function getSharedGeometry(): THREE.BufferGeometry {
  if (sharedGeometry) return sharedGeometry
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0])
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  sharedGeometry = geometry
  return geometry
}

/**
 * 全屏 pass 的渲染载体。
 *
 * 说明：这里沿用「手写线性→sRGB 编码」而不是 `#include <colorspace_fragment>`。
 * 后者虽然可用（three 会把 linearToOutputTexel 注入非 raw 材质的片元前缀），
 * 但依赖 three 的内部 chunk 命名 —— 与 TODO.md 里记录的那条脆弱性一致，
 * 因此输出 pass 自己掌握编码函数更稳。
 */
export class FullscreenQuad {
  readonly material: THREE.ShaderMaterial

  private readonly scene = new THREE.Scene()
  private readonly mesh: THREE.Mesh

  constructor(material: THREE.ShaderMaterial) {
    this.material = material
    // 自建输出不参与 three 的 tone mapping 注入（全局已是 NoToneMapping，双保险）
    this.material.toneMapped = false
    this.mesh = new THREE.Mesh(getSharedGeometry(), material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /** target 为 null 时直接输出到屏幕 */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target)
    renderer.render(this.scene, QUAD_CAMERA)
  }

  dispose(): void {
    // 几何是模块级共享的，只释放材质
    this.material.dispose()
  }
}
