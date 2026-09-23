import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react'
import * as THREE from 'three'

export interface CameraPreset {
  name: string
  position: [number, number, number]
  target?: [number, number, number]
}

export interface CameraRigProps {
  /** 文档要求：至少 2 个预设视角 */
  presets: CameraPreset[]
  /** 自动巡航开关，由外层 HUD 持有，便于按钮与 URL 同步 */
  autopilot?: boolean
  onAutopilotChange?: (value: boolean) => void
  autoRotateSpeed?: number
  /** 相机飞向预设的收敛速度，越大越快 */
  damping?: number
}

/**
 * 统一相机装置：预设视角（数字键 1..n）+ 自动巡航（空格）+ 轨道操作（鼠标 / 触控）。
 * 相机位姿插值只在这里实现一次，所有 demo 复用。
 */
export function CameraRig({
  presets,
  autopilot = false,
  onAutopilotChange,
  autoRotateSpeed = 0.25,
  damping = 4,
}: CameraRigProps) {
  const camera = useThree((state) => state.camera)
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const [index, setIndex] = useState(0)
  const desiredPosition = useRef(new THREE.Vector3())
  const desiredTarget = useRef(new THREE.Vector3())
  const orbitHeight = useRef(2)
  const flying = useRef(true)
  const angle = useRef(0)

  useEffect(() => {
    const preset = presets[index]
    if (!preset) return
    desiredPosition.current.set(...preset.position)
    desiredTarget.current.set(...(preset.target ?? [0, 0, 0]))
    orbitHeight.current = preset.position[1]
    angle.current = 0
    flying.current = true
  }, [index, presets])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (/^[1-9]$/.test(event.key)) {
        const next = Number(event.key) - 1
        if (next < presets.length) setIndex(next)
      } else if (event.code === 'Space') {
        event.preventDefault()
        onAutopilotChange?.(!autopilot)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [presets.length, autopilot, onAutopilotChange])

  const handleStart = useCallback(() => {
    flying.current = false
    if (autopilot) onAutopilotChange?.(false)
  }, [autopilot, onAutopilotChange])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!controls) return
    const step = Math.min(delta, 0.1)
    const k = 1 - Math.exp(-damping * step)

    if (autopilot) {
      const dx = camera.position.x - controls.target.x
      const dz = camera.position.z - controls.target.z
      const radius = Math.hypot(dx, dz) || 4
      angle.current += step * autoRotateSpeed
      desiredPosition.current.set(
        controls.target.x + Math.sin(angle.current) * radius,
        orbitHeight.current,
        controls.target.z + Math.cos(angle.current) * radius,
      )
      camera.position.lerp(desiredPosition.current, k)
      return
    }

    if (flying.current) {
      camera.position.lerp(desiredPosition.current, k)
      controls.target.lerp(desiredTarget.current, k)
      if (camera.position.distanceTo(desiredPosition.current) < 1e-3) {
        flying.current = false
      }
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={0.5}
      maxDistance={80}
      onStart={handleStart}
    />
  )
}

export const CAMERA_HELP = '数字键切预设 · 空格切巡航 · 拖拽旋转 · 滚轮缩放'
