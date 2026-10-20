import { useFrame } from '@react-three/fiber'
import { observer } from 'mobx-react-lite'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { createGBufferMaterial } from '@/core/postfx/materials/GBufferMaterial'
import { gbufferShared } from '@/core/postfx/materials/gbufferShared'
import { GBufferEnvironment } from '@/core/postfx/GBufferEnvironment'
import { GBufferLightSync } from '@/core/postfx/GBufferLightSync'
import { CAMERA_HELP, CameraRig, type CameraPreset } from '@/core/camera/CameraRig'
import { Panel, Select, Slider, Toggle, type SelectOption } from '@/core/controls/ControlPanel'
import { createDemoStore } from '@/core/controls/demoStore'
import { Hud, HudHint, HudTitle } from '@/core/hud/Hud'
import { PerfPanel } from '@/core/perf/PerfPanel'
import { CanvasRoot } from '@/core/renderer/CanvasRoot'
import { HDRPanel } from '@/core/postfx/HDRPanel'
import { ShadowPanel } from '@/core/postfx/ShadowPanel'
import { hdrStore } from '@/core/postfx/hdrStore'
import { hdrParams } from '@/core/postfx/hdrParams'
import { shadowParams } from '@/core/postfx/shadowParams'
import { SceneAsset } from '@/core/scene/SceneAsset'
import { SCENES, type SceneId } from '@/core/scene/scenes'
import type { DemoModule } from '../types'

type DebugView = 'shaded' | 'normals' | 'wireframe'

/**
 * Cornell Box 的相机固定在开口一侧（z 负半轴）朝 +z 看：
 * 这是官方数据的原始视角，红色墙在画面左侧、绿色墙在右侧。
 * fov 45 下相机距开口约 5.8，开口会略微充满画面，与经典 Cornell 照片一致。
 */
const CORNELL_PRESETS: CameraPreset[] = [
  { name: '正视', position: [0, 2.74, -8.6], target: [0, 2.74, 0] },
  { name: '斜俯视', position: [4.6, 4.2, -7.4], target: [0, 2.2, 0] },
]

/** 占位场景（室内）沿用原来的机位，等真实资产接入后再按包围盒适配 */
const PLACEHOLDER_PRESETS: CameraPreset[] = [
  { name: '正视', position: [0, 1.7, 5.6], target: [0, 0.9, 0] },
  { name: '斜俯视', position: [4.2, 3.4, 4.2], target: [0, 0.6, 0] },
]

/** 户外：城市 hero / IBL 球列特写 / 全景 / 低角度 */
const OUTDOOR_PRESETS: CameraPreset[] = [
  // 城市 hero：目标点靠近模型，前景球列落在画面下缘；机位略退，避免切屋顶
  { name: '城市', position: [9, 6.5, 14], target: [0, 4.8, -5] },
  // IBL lab：正对球列，粗糙度扫掠 / 环境反射看得最清楚
  { name: 'IBL 球列', position: [0, 2.2, 9.5], target: [0, 1.0, 3.2] },
  // 全景：保留完整场景关系，模型顶部完整入画
  { name: '全景', position: [10, 6.8, 15.5], target: [0, 4.6, -3] },
  { name: '低角度', position: [-7, 2.4, 10], target: [0, 3.2, -2] },
]

// 室内 Sponza 接入前先不放进演示下拉，避免评审点到程序化占位房间。
const SCENE_OPTIONS: SelectOption<SceneId>[] = [
  { value: 'cornell', label: 'Cornell Box' },
  { value: 'outdoor', label: '户外' },
]

const DEBUG_OPTIONS: SelectOption<DebugView>[] = [
  { value: 'shaded', label: '最终着色' },
  { value: 'normals', label: '法线（中间量）' },
  { value: 'wireframe', label: '线框' },
]

type DemoParams = {
  speed: number
  roughness: number
  metalness: number
  scene: SceneId
  debug: DebugView
  autopilot: boolean
  /** 环境光（IBL）：gbuffer.frag 的 split-sum 环境项开关 */
  env: boolean
  /** 环境强度倍率 */
  envIntensity: number
  /** 白炉测试：环境视为纯白、直接光关闭，验证能量守恒 */
  furnace: boolean
  /** 演示模式：隐藏调试 HUD，只保留场景 / IBL / 白炉 */
  presentation: boolean
}

/** 注意：defaults 必须是显式标注类型的常量，否则 boolean 会被推断成字面量类型 */
const DEFAULTS: DemoParams = {
  speed: 0.5,
  roughness: 0.35,
  metalness: 0.1,
  scene: 'cornell',
  debug: 'shaded',
  autopilot: false,
  // 默认关闭：IBL 是可选档位（RoomEnvironment + CubeCamera 的近似），
  // 打开后可对比「IBL」与「占位环境项」；白炉测试单独开启。
  env: false,
  // 1K 纯天空 HDR 的亮度较高；0.7 让线性输出不把天空完全推到白色。
  // 白炉测试会强制归一为 1，不受这个默认值影响。
  envIntensity: 0.7,
  furnace: false,
  // 作品集默认干净画面；技术 HUD 一键切回。
  presentation: true,
}

/** 参数状态：MobX store，与 URL query 双向同步，链接可直接分享复现 */
const store = createDemoStore(DEFAULTS)

/** 着色探针物体：S2 起用自写 G-buffer 材质填充 MRT，调试视图切它的中间量 */
const ShadingProbe = observer(function ShadingProbe() {
  const { speed, roughness, metalness, debug, scene } = store.params
  const ref = useRef<THREE.Mesh>(null)

  // G-buffer 材质只建一次；roughness / metalness 改动时同步到 uniform。
  const gbufferMaterial = useMemo(() => createGBufferMaterial({ color: '#cbd5e4' }), [])
  gbufferMaterial.uniforms.uRoughness.value = roughness
  gbufferMaterial.uniforms.uMetalness.value = metalness
  // 调试视图不能换回 three 内建材质（meshBasicMaterial / meshNormalMaterial 只写 1 个
  // fragment output，MRT 下会触发 GL_INVALID_OPERATION 且该 draw 被丢弃），统一用
  // GBufferMaterial 的变体：线框 = 材质 wireframe 开关（渲染器级 GL 模式，与材质无关）；
  // 法线 = uDebugNormals 让 gAlbedo 输出编码法线。
  gbufferMaterial.wireframe = debug === 'wireframe'
  gbufferMaterial.uniforms.uDebugNormals.value = debug === 'normals' ? 1 : 0

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed
  })

  // Cornell：开口内侧左前角，避开两块方块；户外：前景右侧，避开球列/体块；
  // 室内占位：球/盒前方。
  const probePosition: [number, number, number] =
    scene === 'cornell'
      ? [1.8, 0.478, -2.0]
      : scene === 'outdoor'
        ? [5.5, 0.478, 5.5]
        : [0, 1.15, 1.9]

  return (
    <mesh ref={ref} position={probePosition} castShadow>
      <boxGeometry args={[0.95, 0.95, 0.95]} />
      <primitive object={gbufferMaterial} attach="material" />
    </mesh>
  )
})

/** demo 旋钮 → GBufferMaterial 的共享 uniform（环境开关 / 强度 / 白炉） */
const GBufferParamSync = observer(function GBufferParamSync() {
  const { env, envIntensity, furnace } = store.params
  useFrame(() => {
    // 环境贴图是异步加载的：HDR 还没就绪时不要打开 uHasEnv，
    // 否则 samplerCube 绑到 null，白炉/环境档位会先黑几帧。
    const envReady = gbufferShared.uEnvMap.value !== null
    // 白炉测试强制走环境路径（环境视为纯白），且强度归一
    gbufferShared.uHasEnv.value = (env || furnace) && envReady ? 1 : 0
    gbufferShared.uEnvIntensity.value = furnace ? 1 : envIntensity
    gbufferShared.uFurnace.value = furnace ? 1 : 0
  })
  return null
})

const DemoScene = observer(function DemoScene() {
  return (
    <group>
      <SceneAsset id={store.params.scene} />
      <ShadingProbe />
    </group>
  )
})

/** 白炉读数：中心亮度 / 全帧均值 / 相对 1.0 的偏差 */
const FurnaceReadout = observer(function FurnaceReadout() {
  const { furnace, roughness } = store.params
  if (!furnace) return null

  const center = hdrStore.centerLuminance
  const average = hdrStore.averageLuminance
  const deviation = (center - 1) * 100
  const within2 = Math.abs(deviation) <= 2

  return (
    <div className="furnace-readout" data-testid="furnace-readout" data-samples={hdrStore.meterSamples}>
      <div className="furnace-row">
        <span className="furnace-key">中心亮度</span>
        <span className="furnace-val" data-testid="furnace-center">
          {center.toFixed(3)}
        </span>
      </div>
      <div className="furnace-row">
        <span className="furnace-key">全帧几何均值</span>
        <span className="furnace-val">{average.toFixed(3)}</span>
      </div>
      <div className="furnace-row">
        <span className="furnace-key">偏差（目标 1.000）</span>
        <span
          className={`badge ${within2 ? 'badge-ok' : 'badge-warn'}`}
          data-testid="furnace-deviation"
        >
          {deviation >= 0 ? '+' : ''}
          {deviation.toFixed(1)}%
        </span>
      </div>
      <div className="furnace-note">
        粗糙度 {roughness.toFixed(2)} · 环境纯白 / 直接光关闭 / albedo 强制 1
      </div>
    </div>
  )
})

const DemoControls = observer(function DemoControls() {
  const {
    speed,
    roughness,
    metalness,
    scene,
    debug,
    autopilot,
    env,
    envIntensity,
    furnace,
    presentation,
  } = store.params
  return (
    <Panel title="参数" onReset={() => store.reset()}>
      <Slider
        label="旋转速度"
        min={0}
        max={3}
        step={0.05}
        value={speed}
        onChange={(value) => store.set({ speed: value })}
      />
      <Slider
        label="粗糙度"
        min={0.02}
        max={1}
        value={roughness}
        onChange={(value) => store.set({ roughness: value })}
      />
      <Slider
        label="金属度"
        min={0}
        max={1}
        value={metalness}
        onChange={(value) => store.set({ metalness: value })}
      />
      <Toggle
        label="环境光（IBL）"
        hint="split-sum 环境光照；户外场景加载 Poly Haven HDRI"
        value={env}
        onChange={(value) => store.set({ env: value })}
      />
      <Slider
        label="环境强度"
        min={0}
        max={3}
        step={0.1}
        digits={1}
        value={envIntensity}
        onChange={(value) => store.set({ envIntensity: value })}
      />
      <Toggle
        label="白炉测试"
        hint="环境视为纯白、直接光关闭；能量守恒验证"
        value={furnace}
        onChange={(value) => store.set({ furnace: value })}
      />
      <FurnaceReadout />
      <Select
        label="场景"
        value={scene}
        options={SCENE_OPTIONS}
        onChange={(value) => store.set({ scene: value })}
      />
      <Select
        label="调试视图"
        value={debug}
        options={DEBUG_OPTIONS}
        onChange={(value) => store.set({ debug: value })}
      />
      <Toggle
        label="自动巡航"
        value={autopilot}
        onChange={(value) => store.set({ autopilot: value })}
      />
      <Toggle
        label="演示模式"
        hint="隐藏调试面板，只留场景 / IBL / 白炉"
        value={presentation}
        onChange={(value) => store.set({ presentation: value })}
      />
    </Panel>
  )
})

/** 演示模式：只保留三件事——切场景、对比 IBL、看白炉读数 */
const PresentationControls = observer(function PresentationControls() {
  const { scene, env, envIntensity, furnace } = store.params
  return (
    <div data-testid="presentation-controls">
      <Panel title="演示控制">
        <Select
          label="场景"
          value={scene}
          options={SCENE_OPTIONS}
          onChange={(value) => store.set({ scene: value })}
        />
        <Toggle
          label="环境光（IBL）"
          hint="HDRI / RoomEnvironment 环境项"
          value={env}
          onChange={(value) => store.set({ env: value })}
        />
        <Slider
          label="环境强度"
          min={0}
          max={3}
          step={0.1}
          digits={1}
          value={envIntensity}
          onChange={(value) => store.set({ envIntensity: value })}
        />
        <Toggle
          label="白炉测试"
          hint="环境纯白 + 直接光关闭"
          value={furnace}
          onChange={(value) => store.set({ furnace: value })}
        />
        <FurnaceReadout />
      </Panel>
    </div>
  )
})

/** shadows 页面复用同一个 Stage，只改 HUD 文案与面板顺序 */
type StageVariant = 'default' | 'shadows'

const Stage = observer(function Stage({ variant = 'default' }: { variant?: StageVariant }) {
  const { scene, autopilot, presentation } = store.params
  const presets =
    scene === 'cornell' ? CORNELL_PRESETS : scene === 'outdoor' ? OUTDOOR_PRESETS : PLACEHOLDER_PRESETS
  // Cornell 的灯在开口内侧的上前方，才能照亮后墙与方块正面；
  // 户外降低直接光强度，让 HDRI 的 IBL 成为主要环境项；占位场景沿用右上前方。
  const keyLightPosition: [number, number, number] =
    scene === 'cornell' ? [3, 8, -6] : scene === 'outdoor' ? [8, 12, 6] : [4.5, 6, 3]
  const keyLightIntensity = scene === 'outdoor' ? 1.6 : 2.2

  const shadowVariant = variant === 'shadows'
  const presentationTitle = shadowVariant ? '实时阴影（骨架）' : '实时 PBR + IBL'
  const presentationSubtitle = shadowVariant
    ? '深度图集 + CSM 1–4 级已就位 · SM / PCF / PCSS 算法段待自写'
    : scene === 'outdoor'
      ? 'Poly Haven HDRI · split-sum IBL · LittlestTokyo（~171k tri）'
      : scene === 'cornell'
        ? 'Cornell Box · 白炉能量守恒 · 三附件 G-buffer'
        : '三附件 G-buffer · Cook-Torrance · HDR 链'
  const technicalTitle = shadowVariant ? '阴影全家桶（骨架）' : 'G-buffer MRT + 前向 PBR'
  const technicalSubtitle = shadowVariant
    ? '深度图集 / CSM / bias 参数已就位；可见性计算见 gbuffer.frag 的 shadowFactor TODO'
    : '三附件 G-buffer（着色 / 法线 / MRAO）→ 自写 Cook-Torrance → HDR 链；调试视图可看中间量'

  return (
    <div className="stage">
      <CanvasRoot shadows cameraPosition={presets[0].position}>
        <CameraRig
          presets={presets}
          autopilot={autopilot}
          onAutopilotChange={(value) => store.set({ autopilot: value })}
        />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={keyLightPosition}
          intensity={keyLightIntensity}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-4, 2.5, -3]} intensity={0.6} color="#8fb6ff" />
        {/* p1-pbr-ibl：场景灯光 → 材质 uniform；HDR / RoomEnvironment → 立方体贴图（IBL 原料） */}
        <GBufferLightSync />
        <GBufferEnvironment url={SCENES[scene].envUrl} />
        <GBufferParamSync />
        <DemoScene />
      </CanvasRoot>

      {presentation ? (
        <Hud
          topLeft={<HudTitle title={presentationTitle} subtitle={presentationSubtitle} />}
          topRight={
            <button
              type="button"
              className="btn"
              data-testid="presentation-exit"
              onClick={() => store.set({ presentation: false })}
            >
              技术模式
            </button>
          }
          bottomLeft={<PresentationControls />}
          bottomRight={<HudHint>拖拽旋转 · 数字键 1–4 切机位 · 空格切巡航</HudHint>}
        />
      ) : (
        <Hud
          topLeft={<HudTitle title={technicalTitle} subtitle={technicalSubtitle} />}
          topRight={<PerfPanel />}
          bottomLeft={
            shadowVariant ? (
              <>
                <ShadowPanel />
                <HDRPanel />
                <DemoControls />
              </>
            ) : (
              <>
                <HDRPanel />
                <ShadowPanel />
                <DemoControls />
              </>
            )
          }
          bottomRight={<HudHint>{CAMERA_HELP}</HudHint>}
        />
      )}
    </div>
  )
})

export const helloCubeDemo: DemoModule = { Stage }

/**
 * pbr-ibl 页面默认就是户外 hero + IBL + ACES：
 * 作品集评审打开页面时不应该先看到 Cornell + env=false 的「最朴素状态」。
 * 显式带 scene / env / tm query 时不覆盖，保证链接可复现。
 */
const PbrIblStage = observer(function PbrIblStage() {
  // 先完成默认值设置再挂 Stage：否则首帧会先渲染 Cornell + RoomEnvironment，
  // 再切到户外并让相机从 Cornell 机位飞过来，作品集首屏会闪一下。
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    // scene / env 分开判断：?env=0 仍应落到户外（只关 IBL），而不是退回 Cornell。
    if (!query.has('scene')) {
      store.set({ scene: 'outdoor' })
    }
    if (!query.has('env')) {
      store.set({ env: true })
    }
    if (!query.has('tm')) {
      hdrParams.set({ tm: 'aces' })
    }
    setReady(true)
  }, [])

  return ready ? <Stage /> : null
})

export const pbrIblDemo: DemoModule = { Stage: PbrIblStage }

/**
 * p1-shadow 页面：默认 Cornell + 实时阴影 + 技术模式。
 *
 * Cornell 是阴影验收的标准场景（单主光、尺寸已知、可用于对照 bias / acne）；
 * 技术模式直接展开 HDR / 阴影面板，评审打开就能切 SM / PCF / PCSS 与调试视图。
 * 显式带 scene / shadow / tm 参数时不覆盖，保证链接可复现。
 */
const ShadowsStage = observer(function ShadowsStage() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    if (!query.has('scene')) {
      store.set({ scene: 'cornell' })
    }
    if (!query.has('shadow')) {
      shadowParams.set({ shadow: true })
    }
    if (!query.has('tm')) {
      hdrParams.set({ tm: 'aces' })
    }
    if (!query.has('presentation')) {
      store.set({ presentation: false })
    }
    setReady(true)
  }, [])

  return ready ? <Stage variant="shadows" /> : null
})

export const shadowDemo: DemoModule = { Stage: ShadowsStage }
