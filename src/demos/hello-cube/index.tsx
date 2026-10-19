import { useFrame } from '@react-three/fiber'
import { observer } from 'mobx-react-lite'
import { useMemo, useRef } from 'react'
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
import { SceneAsset } from '@/core/scene/SceneAsset'
import type { SceneId } from '@/core/scene/scenes'
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

/** 占位场景（室内 / 户外）仍沿用原来的机位，等真实资产接入后再按包围盒适配 */
const PLACEHOLDER_PRESETS: CameraPreset[] = [
  { name: '正视', position: [0, 1.7, 5.6], target: [0, 0.9, 0] },
  { name: '斜俯视', position: [4.2, 3.4, 4.2], target: [0, 0.6, 0] },
]

const SCENE_OPTIONS: SelectOption<SceneId>[] = [
  { value: 'cornell', label: 'Cornell Box' },
  { value: 'indoor', label: '室内' },
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
  envIntensity: 1,
  furnace: false,
}

/** 参数状态：MobX store，与 URL query 双向同步，链接可直接分享复现 */
const store = createDemoStore(DEFAULTS)

/** 着色探针物体：S2 起用自写 G-buffer 材质填充 MRT，调试视图切它的中间量 */
const ShadingProbe = observer(function ShadingProbe() {
  const { speed, roughness, metalness, debug, scene } = store.params
  const ref = useRef<THREE.Mesh>(null)
  const isCornell = scene === 'cornell'

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

  // Cornell 场景：探针放到开口内侧的左前角（画面左下方），
  // 落地且避开两块 165 方块（含绕 y 旋转后的扫掠范围），不遮挡参考几何。
  return (
    <mesh ref={ref} position={isCornell ? [1.8, 0.478, -2.0] : [0, 1.15, 1.9]} castShadow>
      <boxGeometry args={[0.95, 0.95, 0.95]} />
      <primitive object={gbufferMaterial} attach="material" />
    </mesh>
  )
})

/** demo 旋钮 → GBufferMaterial 的共享 uniform（环境开关 / 强度 / 白炉） */
const GBufferParamSync = observer(function GBufferParamSync() {
  const { env, envIntensity, furnace } = store.params
  useFrame(() => {
    // 白炉测试强制走环境路径（环境视为纯白），且强度归一
    gbufferShared.uHasEnv.value = env || furnace ? 1 : 0
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

const DemoControls = observer(function DemoControls() {
  const { speed, roughness, metalness, scene, debug, autopilot, env, envIntensity, furnace } =
    store.params
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
        hint="split-sum 环境光照；gbuffer.frag 的 ibl* 算法段实现后生效"
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
        hint="环境视为纯白、直接光关闭；能量守恒验证（算法段实现后生效）"
        value={furnace}
        onChange={(value) => store.set({ furnace: value })}
      />
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
    </Panel>
  )
})

const Stage = observer(function Stage() {
  const { scene, autopilot } = store.params
  const presets = scene === 'cornell' ? CORNELL_PRESETS : PLACEHOLDER_PRESETS
  // Cornell 的灯在开口内侧的上前方，才能照亮后墙与方块正面；
  // 占位场景沿用原来的右上前方主光。
  const keyLightPosition: [number, number, number] = scene === 'cornell' ? [3, 8, -6] : [4.5, 6, 3]
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
          intensity={2.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-4, 2.5, -3]} intensity={0.6} color="#8fb6ff" />
        {/* p1-pbr-ibl：场景灯光 → 材质 uniform；程序化环境 → 立方体贴图（IBL 原料） */}
        <GBufferLightSync />
        <GBufferEnvironment />
        <GBufferParamSync />
        <DemoScene />
      </CanvasRoot>

      <Hud
        topLeft={
          <HudTitle
            title="G-buffer MRT + 前向 PBR"
            subtitle="三附件 G-buffer（着色 / 法线 / MRAO）→ 自写 Cook-Torrance → HDR 链；调试视图可看中间量"
          />
        }
        topRight={<PerfPanel />}
        bottomLeft={
          <>
            <HDRPanel />
            <DemoControls />
          </>
        }
        bottomRight={<HudHint>{CAMERA_HELP}</HudHint>}
      />
    </div>
  )
})

export const helloCubeDemo: DemoModule = { Stage }
