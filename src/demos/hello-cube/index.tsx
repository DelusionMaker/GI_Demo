import { useFrame } from '@react-three/fiber'
import { observer } from 'mobx-react-lite'
import { useRef } from 'react'
import * as THREE from 'three'
import { CAMERA_HELP, CameraRig, type CameraPreset } from '@/core/camera/CameraRig'
import { Panel, Select, Slider, Toggle, type SelectOption } from '@/core/controls/ControlPanel'
import { createDemoStore } from '@/core/controls/demoStore'
import { Hud, HudHint, HudTitle } from '@/core/hud/Hud'
import { PerfPanel } from '@/core/perf/PerfPanel'
import { CanvasRoot } from '@/core/renderer/CanvasRoot'
import { SceneAsset } from '@/core/scene/SceneAsset'
import type { SceneId } from '@/core/scene/scenes'
import type { DemoModule } from '../types'

type DebugView = 'shaded' | 'normals' | 'wireframe'

const PRESETS: CameraPreset[] = [
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
}

/** 注意：defaults 必须是显式标注类型的常量，否则 boolean 会被推断成字面量类型 */
const DEFAULTS: DemoParams = {
  speed: 0.5,
  roughness: 0.35,
  metalness: 0.1,
  scene: 'cornell',
  debug: 'shaded',
  autopilot: false,
}

/** 参数状态：MobX store，与 URL query 双向同步，链接可直接分享复现 */
const store = createDemoStore(DEFAULTS)

/** 着色探针物体：后续把材质换成自写 BRDF，调试视图切它的中间量 */
const ShadingProbe = observer(function ShadingProbe() {
  const { speed, roughness, metalness, debug } = store.params
  const ref = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed
  })

  return (
    <mesh ref={ref} position={[0, 1.15, 1.9]} castShadow>
      <boxGeometry args={[0.95, 0.95, 0.95]} />
      {debug === 'wireframe' ? (
        <meshBasicMaterial wireframe color="#5c9dff" />
      ) : debug === 'normals' ? (
        <meshNormalMaterial />
      ) : (
        <meshStandardMaterial color="#cbd5e4" roughness={roughness} metalness={metalness} />
      )}
    </mesh>
  )
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
  const { speed, roughness, metalness, scene, debug, autopilot } = store.params
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
  const { autopilot } = store.params
  return (
    <div className="stage">
      <CanvasRoot shadows cameraPosition={PRESETS[0].position}>
        <CameraRig
          presets={PRESETS}
          autopilot={autopilot}
          onAutopilotChange={(value) => store.set({ autopilot: value })}
        />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[4.5, 6, 3]}
          intensity={2.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-4, 2.5, -3]} intensity={0.6} color="#8fb6ff" />
        <DemoScene />
      </CanvasRoot>

      <Hud
        topLeft={<HudTitle title="hello-cube" subtitle="p0-base 冒烟测试：验证骨架全链路" />}
        topRight={<PerfPanel />}
        bottomLeft={<DemoControls />}
        bottomRight={<HudHint>{CAMERA_HELP}</HudHint>}
      />
    </div>
  )
})

export const helloCubeDemo: DemoModule = { Stage }
