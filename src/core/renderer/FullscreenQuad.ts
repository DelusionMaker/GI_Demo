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
 * 单个全屏三角形的几何。相比两个三角形拼的四边形，
 * 没有对角线上的重复着色，且省一次顶点。
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
 * 使用 ShaderMaterial（而非 RawShaderMaterial）是有意为之：
 * 非 raw 材质会注入 three 的标准前缀，因此片元着色器里可以用
 * `#include <colorspace_fragment>` —— 它调用的 `linearToOutputTexel`
 * 与内置材质走同一条色彩空间转换函数，这是「自建链」与「场景直出」
 * 两条路径画面一致的前提。
 */
export class FullscreenQuad {
  readonly material: THREE.ShaderMaterial

  private readonly scene = new THREE.Scene()
  private readonly mesh: THREE.Mesh

  constructor(material: THREE.ShaderMaterial) {
    this.material = material
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
