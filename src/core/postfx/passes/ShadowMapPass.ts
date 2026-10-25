import * as THREE from 'three'
import type { Pass, PassContext } from '../Pass'
import { gbufferShared } from '../materials/gbufferShared'
import {
  SHADOW_BIAS_INDEX,
  SHADOW_MODE_INDEX,
  type ShadowBiasMode,
  type ShadowMode,
} from '../shadowTypes'

/** 图集最多容纳的级联数（2×2 分块） */
const MAX_CASCADES = 4

interface AtlasLayout {
  cols: number
  rows: number
}

/**
 * 阴影贴图 pass（p1-shadow 骨架）。
 *
 * 职责（框架部分，已完成）：
 * - 每帧从场景里找主平行光（优先 castShadow 的那一盏），构建光源正交相机；
 * - 按 CSM 切分视锥（1–4 级），把每级渲染进同一张深度图集的分块；
 * - 写 `gbufferShared.uShadow*`：图集深度纹理、每级 worldPos → 图集 UV/深度的矩阵、
 *   级联切分距离、算法 / bias / 采样参数；
 * - 提供图集纹理给 `ShadowDebugPass` 做中间量可视化。
 *
 * **留给作品集作者自写的算法段**在 `gbuffer.frag` 的 `shadowFactor()`：
 * SM 深度比较、PCF 核、PCSS blocker search / 半影估计、三种 bias 补偿、级联过渡。
 * 本 pass 只负责「把原料准备好」，不做任何可见性判断。
 *
 * 与 three 内建阴影的关系：
 * - 场景材质是自写 RawShaderMaterial（GBufferMaterial），three 的内建 shadow map
 *   对它们无效；本 pass 是独立的一套，只复用 `castShadow` 标记筛选投影物；
 * - 渲染深度图时临时关闭 `renderer.shadowMap.enabled`，避免 three 每级再跑一遍
 *   自己的 shadow pass（纯浪费）。
 *
 * 取舍（骨架阶段有意为之，见 TODO.md）：
 * - 投影物筛选用「每帧 traverse + 临时 visible=false」，demo 规模足够；
 *   生产应改成渲染列表 / layer 掩码。
 * - 未处理 alphaTest 投影（树叶等会投出实心影子）。
 * - 未做 texel snapping（相机移动时阴影边缘会游动）与级联间过渡，
 *   两项都标在 `fitCascade()` / shader TODO 里。
 */
export class ShadowMapPass implements Pass {
  readonly name = 'shadow-map'

  /**
   * Pass 是否参与每帧渲染。
   * 注意与 `applyShadows` 区分：打开「阴影图集」调试视图时本 pass 需要跑，
   * 但着色器不一定应用阴影。
   */
  enabled = false

  scale = 1
  source = 'prev' as const

  /**
   * 自己管理渲染目标（深度图集），不要 Pipeline 按 target spec 分配。
   * Pipeline 对本 pass 传入 target = null。
   */
  selfManaged = true

  /** selfManaged 时该字段仅用于满足接口 */
  target = { format: 'RGBA8' as const, filter: 'nearest' as const, samples: 0 }

  // ── 用户旋钮（ShadowPanel / URL 参数 → HDRDriver 每帧同步）──
  /** 是否在 gbuffer.frag 里应用阴影（shadowFactor 的 uShadowEnabled） */
  applyShadows = false
  /** 调试：把 cascade 索引染成色块（走正常 beauty → tonemap 输出） */
  debugCascade = false
  mode: ShadowMode = 'pcf'
  biasMode: ShadowBiasMode = 'normal'
  cascadeCount = 1
  /** 阴影距离（世界单位）；CSM 的 far 会被钳到该值 */
  maxDistance = 40
  /** CSM 实用切分系数：1 = 对数切分，0 = 均匀切分 */
  cascadeLambda = 0.5
  /** 图集边长（像素）。1 级时用满整张，2 级 2×1，3–4 级 2×2 */
  atlasSize = 2048
  /** 常数深度偏移（归一化深度 [0,1]） */
  bias = 0.0008
  /** 斜率缩放系数（slope bias 模式，与 bias 解耦） */
  slopeBias = 0.002
  /** 法线偏移（世界单位） */
  normalBias = 0.02
  /** PCF 半径（纹素） */
  pcfRadius = 1.5
  /** PCSS 光源尺寸（UV 空间的半影尺度近似） */
  lightSize = 0.03
  /** 阴影强度：1 = 全黑阴影，0 = 不压暗 */
  strength = 1

  private atlas: THREE.WebGLRenderTarget | null = null
  private atlasDimension = 0

  private readonly depthMaterial = new THREE.MeshDepthMaterial({ colorWrite: false })
  private readonly lightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10)
  private readonly matrices = Array.from({ length: MAX_CASCADES }, () => new THREE.Matrix4())
  private readonly splits = new THREE.Vector4(1, 1, 1, 1)
  private readonly splitValues = [1, 1, 1, 1]
  /** 本帧主光是否可用（syncUniforms 在 render 之外也要知道） */
  private lightFound = false

  private readonly hidden: THREE.Object3D[] = []
  private readonly tmpLightPos = new THREE.Vector3()
  private readonly tmpTargetPos = new THREE.Vector3()
  private readonly tmpLightDir = new THREE.Vector3()
  private readonly tmpCenter = new THREE.Vector3()
  private readonly tmpCameraPos = new THREE.Vector3()
  private readonly tmpCorners = Array.from({ length: 8 }, () => new THREE.Vector3())
  private readonly tmpLightViewProj = new THREE.Matrix4()
  private readonly tmpTileMatrix = new THREE.Matrix4()

  /** 投影物包围球（单级联时用来收紧光源相机，避免整张图集只有几个像素有内容） */
  private readonly casterBox = new THREE.Box3()
  private readonly casterSphere = new THREE.Sphere(new THREE.Vector3(), 0)
  private readonly tmpMeshBox = new THREE.Box3()
  private casterBoundsFrame = -1_000_000

  /** 供 ShadowDebugPass 读取（可能为 null：尚未渲染过） */
  get atlasTexture(): THREE.Texture | null {
    return this.atlas?.depthTexture ?? null
  }

  /** 当前图集分块布局（调试视图画边框 / 判断有效 tile） */
  get layoutInfo(): AtlasLayout {
    return this.resolveLayout()
  }

  /** 实际生效的级联数（旋钮可能被 URL 写成 0 / 5 等非法值） */
  get resolvedCascadeCount(): number {
    return this.resolveCascadeCount()
  }

  /**
   * 每帧同步「是否应用阴影」。
   * 必须在 Pipeline.render 之前调用：pass 被 disabled / 整链 bypass 时不会进 render，
   * 共享 uniform 需要由这里清零，避免采样上一帧的残留图集。
   */
  syncUniforms(bypass = false): void {
    gbufferShared.uShadowEnabled.value = this.applyShadows && !bypass && this.lightFound ? 1 : 0
    gbufferShared.uShadowDebugCascade.value = this.debugCascade ? 1 : 0
  }

  render(ctx: PassContext): THREE.Texture | null {
    const mainLight = this.findMainLight(ctx.scene)
    this.lightFound = mainLight !== null
    if (!mainLight) {
      gbufferShared.uShadowEnabled.value = 0
      return ctx.input
    }

    this.ensureAtlas()

    // 相机矩阵由 R3F 的相机装置更新，但本 pass 在 renderer.render 之前就要读它，
    // 因此这里主动 update 一次（beauty 的 render 才会顺带更新）。
    ctx.camera.updateMatrixWorld()

    mainLight.getWorldPosition(this.tmpLightPos)
    mainLight.target.getWorldPosition(this.tmpTargetPos)
    this.tmpLightDir.copy(this.tmpLightPos).sub(this.tmpTargetPos).normalize()
    if (this.tmpLightDir.lengthSq() < 1e-8) this.tmpLightDir.set(0, 1, 0)

    // 先更新投影物包围球：单级联的 split 与相机拟合都要用它收紧覆盖范围
    this.updateCasterBounds(ctx.scene, ctx.frame)
    this.computeSplits(ctx.camera)

    const layout = this.resolveLayout()
    const count = this.resolveCascadeCount()
    const atlasSize = this.atlasDimension || this.atlasSize
    const tileSize = Math.max(1, Math.floor(atlasSize / Math.max(layout.cols, layout.rows)))

    // 只让 castShadow 的 mesh 进深度图：天空球 / 只接收阴影的地面不能挡住光。
    // 用 scene.overrideMaterial 时 three 会把线 / 点 / Sprite 也画进去，所以
    // 非 mesh 的可渲染对象一并隐藏（它们不参与我们的阴影投射）。
    // demo 规模下逐帧改 visible 足够；正式版应换成 layer 掩码或渲染列表过滤。
    this.hidden.length = 0
    ctx.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      const isRenderable =
        mesh.isMesh ||
        (object as THREE.Line).isLine ||
        (object as THREE.Points).isPoints ||
        (object as THREE.Sprite).isSprite
      if (!isRenderable || !object.visible) return
      if (mesh.isMesh && mesh.castShadow) return
      object.visible = false
      this.hidden.push(object)
    })

    const prevShadowMapEnabled = ctx.renderer.shadowMap.enabled
    const prevOverride = ctx.scene.overrideMaterial
    const prevTarget = ctx.renderer.getRenderTarget()

    try {
      // three 的内建阴影对自写 raw shader 无效，跑一遍纯属浪费
      ctx.renderer.shadowMap.enabled = false
      // 深度 pass 不需要 GBufferMaterial 的着色，用内建深度材质（支持蒙皮）
      ctx.scene.overrideMaterial = this.depthMaterial

      for (let i = 0; i < count; i++) {
        this.fitCascade(ctx.camera, i, layout)
        const col = i % layout.cols
        const row = Math.floor(i / layout.cols)
        const target = this.atlas!
        // 设置 RT 自己的 viewport / scissor，再 setRenderTarget 才会生效
        // （renderer.setViewport 会乘 DPR，不适用于像素尺寸的 RT）
        target.viewport.set(col * tileSize, row * tileSize, tileSize, tileSize)
        target.scissor.set(col * tileSize, row * tileSize, tileSize, tileSize)
        target.scissorTest = true
        ctx.renderer.setRenderTarget(target)
        ctx.renderer.render(ctx.scene, this.lightCamera)
      }
    } finally {
      for (const mesh of this.hidden) mesh.visible = true
      this.hidden.length = 0
      ctx.scene.overrideMaterial = prevOverride
      ctx.renderer.shadowMap.enabled = prevShadowMapEnabled
      ctx.renderer.setRenderTarget(prevTarget)
    }

    this.writeUniforms()
    return ctx.input
  }

  dispose(): void {
    this.atlas?.dispose()
    this.atlas = null
    this.atlasDimension = 0
    this.depthMaterial.dispose()
    // StrictMode 下实例会被 dispose 后复用：把共享 uniform 复位，避免绑到已释放纹理
    gbufferShared.uShadowEnabled.value = 0
    gbufferShared.uShadowAtlas.value = null
  }

  private resolveCascadeCount(): number {
    return Math.min(MAX_CASCADES, Math.max(1, Math.round(this.cascadeCount)))
  }

  private resolveLayout(): AtlasLayout {
    const count = this.resolveCascadeCount()
    if (count <= 1) return { cols: 1, rows: 1 }
    if (count === 2) return { cols: 2, rows: 1 }
    return { cols: 2, rows: 2 }
  }

  private ensureAtlas(): void {
    // URL 里的 shadowMapSize 是任意外部输入：上下限都钳住，避免分配异常显存
    const size = THREE.MathUtils.clamp(Math.round(this.atlasSize), 256, 4096)
    if (this.atlas && this.atlasDimension === size) return

    this.atlas?.dispose()

    const depthTexture = new THREE.DepthTexture(size, size)
    depthTexture.format = THREE.DepthFormat
    depthTexture.type = THREE.UnsignedIntType
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter
    depthTexture.generateMipmaps = false
    depthTexture.name = 'shadow-atlas-depth'

    const target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    target.texture.colorSpace = THREE.NoColorSpace
    target.texture.name = 'shadow-atlas'
    target.scissorTest = false

    this.atlas = target
    this.atlasDimension = size
  }

  private findMainLight(scene: THREE.Scene): THREE.DirectionalLight | null {
    let fallback: THREE.DirectionalLight | null = null
    let shadowCaster: THREE.DirectionalLight | null = null
    scene.traverse((object) => {
      const light = object as THREE.DirectionalLight
      if (!light.isDirectionalLight) return
      if (!fallback) fallback = light
      if (!shadowCaster && light.castShadow) shadowCaster = light
    })
    return shadowCaster ?? fallback
  }

  /**
   * 缓存投影物包围球（每 30 帧刷新一次；演示场景规模下成本可接受）。
   * 只统计 castShadow 的 mesh —— 地面 / 天空球不投影，不能把包围球撑大。
   */
  private updateCasterBounds(scene: THREE.Scene, frame: number): void {
    if (frame - this.casterBoundsFrame < 30 && this.casterSphere.radius > 0) return
    this.casterBoundsFrame = frame
    this.casterBox.makeEmpty()
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.castShadow) return
      // setFromObject 包含世界变换；蒙皮网格按 bind pose 包围盒近似
      this.tmpMeshBox.setFromObject(mesh)
      this.casterBox.union(this.tmpMeshBox)
    })
    if (!this.casterBox.isEmpty()) {
      this.casterBox.getBoundingSphere(this.casterSphere)
    } else {
      this.casterSphere.radius = 0
    }
  }

  /** CSM 实用切分（practical split scheme） */
  private computeSplits(camera: THREE.Camera): void {
    const cam = camera as THREE.PerspectiveCamera
    const nearLimit = Math.max(0.01, typeof cam.near === 'number' ? cam.near : 0.05)
    const cameraFar = typeof cam.far === 'number' ? cam.far : this.maxDistance
    let farLimit = Math.max(nearLimit + 0.01, Math.min(this.maxDistance, cameraFar))
    const count = this.resolveCascadeCount()
    const lambda = THREE.MathUtils.clamp(this.cascadeLambda, 0, 1)

    if (count === 1 && this.casterSphere.radius > 0) {
      // 单级联按包围球拟合时，阴影距离也应收到包围球的实际覆盖，
      // 否则「cascade 分层」会把没有图集覆盖的区域也标成有效。
      this.tmpCameraPos.setFromMatrixPosition(camera.matrixWorld)
      const coverage =
        this.tmpCameraPos.distanceTo(this.casterSphere.center) + this.casterSphere.radius
      farLimit = Math.max(nearLimit + 0.01, Math.min(farLimit, coverage))
    }

    if (count === 1) {
      this.splitValues[0] = farLimit
    } else {
      for (let i = 0; i < count; i++) {
        const p = (i + 1) / count
        const logSplit = nearLimit * Math.pow(farLimit / nearLimit, p)
        const uniformSplit = nearLimit + (farLimit - nearLimit) * p
        this.splitValues[i] = THREE.MathUtils.lerp(uniformSplit, logSplit, lambda)
      }
    }

    // 未使用的槽位填最后一个有效值，shader 侧仍由 uShadowCascadeCount 限界
    for (let i = count; i < MAX_CASCADES; i++) this.splitValues[i] = farLimit
    this.splits.set(
      this.splitValues[0],
      this.splitValues[1],
      this.splitValues[2],
      this.splitValues[3],
    )
  }

  /** 把第 index 级视锥切片拟合成光源正交相机，并把 tile 变换烘进矩阵 */
  private fitCascade(camera: THREE.Camera, index: number, layout: AtlasLayout): void {
    const cam = camera as THREE.PerspectiveCamera
    const nearSplit = index === 0 ? Math.max(0.01, cam.near ?? 0.01) : this.splitValues[index - 1]
    const farSplit = this.splitValues[index]

    const singleCascade = this.resolveCascadeCount() === 1
    const useCasterBounds = singleCascade && this.casterSphere.radius > 0

    if (useCasterBounds) {
      // 单级联：直接拟合投影物包围球。
      // 按视锥切片（near→40 单位）拟合会把大片空地包进来，实测图集里只有
      // 几个像素有内容；包围球拟合能让同样 2048² 的贴图真正用在物体上。
      // 代价：视锥外、但沿光源方向能投影进画面的物体不在拟合范围内，
      // 后续做完整 CSM 时应改成「视锥切片 + 投影物扩展」。
      this.tmpCenter.copy(this.casterSphere.center)
    } else {
      if (cam.isPerspectiveCamera) {
        const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5)
        const tanX = tanY * cam.aspect
        let cursor = 0
        for (const distance of [nearSplit, farSplit]) {
          const halfHeight = tanY * distance
          const halfWidth = tanX * distance
          for (const signY of [-1, 1]) {
            for (const signX of [-1, 1]) {
              this.tmpCorners[cursor]
                .set(signX * halfWidth, signY * halfHeight, -distance)
                .applyMatrix4(cam.matrixWorld)
              cursor += 1
            }
          }
        }
      } else {
        // 兜底：非透视相机（当前项目不用）按世界原点附近的固定球拟合
        let cursor = 0
        for (let i = 0; i < 8; i++) {
          this.tmpCorners[cursor].set(i % 2 === 0 ? -20 : 20, i < 4 ? 0 : 20, i % 4 < 2 ? -20 : 20)
          cursor += 1
        }
      }

      this.tmpCenter.set(0, 0, 0)
      for (const corner of this.tmpCorners) this.tmpCenter.add(corner)
      this.tmpCenter.multiplyScalar(1 / this.tmpCorners.length)
    }

    let radius = 0.01
    if (useCasterBounds) {
      radius = this.casterSphere.radius * 1.05
    } else {
      for (const corner of this.tmpCorners) {
        radius = Math.max(radius, corner.distanceTo(this.tmpCenter))
      }
    }

    // 光源相机放在包围球外侧，沿「指向光源」的方向看回中心
    this.lightCamera.position.copy(this.tmpCenter).addScaledVector(this.tmpLightDir, radius + 1)
    this.lightCamera.up.set(0, 1, 0)
    if (Math.abs(this.tmpLightDir.dot(this.lightCamera.up)) > 0.99) {
      this.lightCamera.up.set(0, 0, 1)
    }
    this.lightCamera.lookAt(this.tmpCenter)
    this.lightCamera.left = -radius
    this.lightCamera.right = radius
    this.lightCamera.top = radius
    this.lightCamera.bottom = -radius
    this.lightCamera.near = 0.01
    this.lightCamera.far = radius * 2 + 2
    this.lightCamera.updateProjectionMatrix()
    this.lightCamera.updateMatrixWorld()

    this.tmpLightViewProj.multiplyMatrices(
      this.lightCamera.projectionMatrix,
      this.lightCamera.matrixWorldInverse,
    )

    // NDC [-1,1] → 图集 UV [0,1]，再缩放到本级 tile。
    // 把 tile 变换直接烘进矩阵，shader 侧拿到的 xy 就是图集 UV，少一步换算。
    const col = index % layout.cols
    const row = Math.floor(index / layout.cols)

    // tile 永远是正方形：边长 = 1 / max(cols, rows)
    const tileSpan = 1 / Math.max(layout.cols, layout.rows);
    const offsetU = col * tileSpan;
    const offsetV = row * tileSpan;
    this.tmpTileMatrix.set(
      tileSpan * 0.5,
      0,
      0,
      offsetU + tileSpan * 0.5,
      0,
      tileSpan * 0.5,
      0,
      offsetV + tileSpan * 0.5,
      0,
      0,
      0.5,
      0.5,
      0,
      0,
      0,
      1,
    )
    this.matrices[index].multiplyMatrices(this.tmpTileMatrix, this.tmpLightViewProj)

    // TODO(p1-shadow · 你来写)：CSM 稳定化 —— 把光源相机中心吸附到光空间 texel 网格
    // （否则相机移动时阴影边缘会游动）；以及级联间按 viewDepth 混合，消除硬接缝。
  }

  private writeUniforms(): void {
    const layout = this.resolveLayout()
    const count = this.resolveCascadeCount()
    const atlasSize = this.atlasDimension || this.atlasSize

    gbufferShared.uShadowAtlas.value = this.atlas?.depthTexture ?? null
    // 保持数组引用稳定，只拷内容（材质共享的是同一个 uniform 对象）
    const matrices = gbufferShared.uShadowMatrices.value
    for (let i = 0; i < MAX_CASCADES; i++) {
      matrices[i].copy(this.matrices[i])
    }
    gbufferShared.uShadowSplits.value.copy(this.splits)
    gbufferShared.uShadowCascadeCount.value = count
    gbufferShared.uShadowTexelSize.value = 1 / atlasSize
    gbufferShared.uShadowAtlasSize.value = atlasSize
    gbufferShared.uShadowAtlasGrid.value.set(layout.cols, layout.rows)
    gbufferShared.uShadowMode.value = SHADOW_MODE_INDEX[this.mode]
    gbufferShared.uShadowBiasMode.value = SHADOW_BIAS_INDEX[this.biasMode]
    gbufferShared.uShadowBias.value = this.bias
    gbufferShared.uShadowSlopeBias.value = this.slopeBias
    gbufferShared.uShadowNormalBias.value = this.normalBias
    gbufferShared.uShadowPCFRadius.value = this.pcfRadius
    gbufferShared.uShadowLightSize.value = this.lightSize
    gbufferShared.uShadowStrength.value = this.strength
    gbufferShared.uShadowEnabled.value = this.applyShadows ? 1 : 0
  }
}
