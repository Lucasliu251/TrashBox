import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import {
  CS2_AWP_2026_08,
  MAP_OBSTACLES,
  SIMULATION_DT,
  SIMULATION_HZ,
  SNAPSHOT_HZ,
  WORLD,
  degreesPerMouseCount,
  simulateMovement,
  sourceFovToVertical,
  type HitResult,
  type InputButtons,
  type InputCommand,
  type LimbPart,
  type PlayerSnapshot,
  type RoomSnapshot,
  type ServerMessage,
  type SimPlayerState,
} from '@trashbox/sniper-shared'
import type { GameConnection } from '../network'
import type { TrainingSettings } from '../settings'
import { RoundInputSequence } from './InputSequence'

THREE.Mesh.prototype.raycast = acceleratedRaycast
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree

export interface RuntimeInfo {
  pointerLocked: boolean
  rawInput: boolean
  role: 'sniper' | 'runner' | 'spectator'
  life: string
  health: number
  ammo: number
  reserveAmmo: number
  scopeLevel: 0 | 1 | 2
  roundTimeMs: number
  velocity: number
  hitText: string
}

interface EngineOptions {
  canvas: HTMLCanvasElement
  connection: GameConnection
  settings: TrainingSettings
  onRuntime: (runtime: RuntimeInfo) => void
}

interface PlayerVisual {
  group: THREE.Group
  parts: Record<'head' | 'torso' | LimbPart, THREE.Mesh>
  lastPosition: THREE.Vector3
  frames: Array<{ at: number; snapshot: PlayerSnapshot }>
  lastStepAt: number
}

interface Debris {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  expiresAt: number
}

const UP = new THREE.Vector3(0, 1, 0)
const clampPitch = (pitch: number) => THREE.MathUtils.clamp(pitch, -Math.PI * 0.494, Math.PI * 0.494)
const createShotId = () => typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
const cloneState = (player: PlayerSnapshot): SimPlayerState => ({
  position: { ...player.position },
  velocity: { ...player.velocity },
  yaw: player.yaw,
  pitch: player.pitch,
  grounded: player.grounded,
  crouching: player.crouching,
  role: player.role,
  body: { ...player.body, limbs: { ...player.body.limbs } },
  scopedLevel: player.scopedLevel,
})

function makeTextCanvas(text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.font = '600 24px Inter, sans-serif'
  context.textAlign = 'center'
  context.fillStyle = color
  context.fillText(text, 128, 38)
  return new THREE.CanvasTexture(canvas)
}

export class GameEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly connection: GameConnection
  private readonly settings: TrainingSettings
  private readonly onRuntime: EngineOptions['onRuntime']
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(73.74, 1, 0.04, 240)
  private readonly renderer: THREE.WebGLRenderer
  private readonly clock = new THREE.Clock()
  private readonly playerVisuals = new Map<string, PlayerVisual>()
  private readonly keys = new Set<string>()
  private readonly pendingInputs: InputCommand[] = []
  private readonly debris: Debris[] = []
  private readonly particles: Debris[] = []
  private readonly stains: Array<{ mesh: THREE.Mesh; expiresAt: number }> = []
  private readonly viewModel = new THREE.Group()
  private readonly muzzleLight = new THREE.PointLight(0xffd8a0, 0, 7, 2)
  private readonly weaponLight = new THREE.PointLight(0xffe0b0, 0, 2.6, 2)
  private readonly platformWeaponLight = new THREE.SpotLight(0xffd69b, 0, 4, Math.PI / 5, 0.5, 1.4)
  private readonly audio = new AudioContext()
  private room: RoomSnapshot | null = null
  private readonly inputSequence = new RoundInputSequence()
  private localState: SimPlayerState | null = null
  private latestOwn: PlayerSnapshot | null = null
  private pointerLocked = false
  private rawInput = false
  private inputAccumulator = 0
  private frameHandle = 0
  private disposed = false
  private localAmmo = 0
  private localReserve = 0
  private localNextShotAt = 0
  private localScope: 0 | 1 | 2 = 0
  private hitText = ''
  private hitTextUntil = 0
  private recoil = 0
  private walkPhase = 0
  private lastLocalStepAt = 0
  private messageOff: (() => void) | null = null
  private resizeObserver: ResizeObserver

  constructor(options: EngineOptions) {
    this.canvas = options.canvas
    this.connection = options.connection
    this.settings = options.settings
    this.onRuntime = options.onRuntime
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.canvas)
    this.buildWorld()
    this.buildViewModel()
    this.bindEvents()
    this.messageOff = this.connection.onMessage(message => this.receive(message))
    if (this.connection.room) this.applyRoom(this.connection.room, Date.now())
    this.animate()
  }

  requestPointerLock = async () => {
    if (this.pointerLocked) return
    await this.audio.resume().catch(() => undefined)
    if (!document.fullscreenElement) {
      await this.canvas.parentElement?.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined)
    }
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true })
      this.rawInput = true
    } catch {
      try {
        await this.canvas.requestPointerLock()
        this.rawInput = false
      } catch {
        this.rawInput = false
      }
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameHandle)
    this.messageOff?.()
    this.resizeObserver.disconnect()
    document.removeEventListener('pointerlockchange', this.pointerLockChanged)
    document.removeEventListener('mousemove', this.mouseMoved)
    window.removeEventListener('keydown', this.keyDown, true)
    window.removeEventListener('keyup', this.keyUp, true)
    window.removeEventListener('mousedown', this.mouseDown)
    window.removeEventListener('contextmenu', this.preventContext)
    window.removeEventListener('auxclick', this.preventContext)
    window.removeEventListener('wheel', this.preventWheel, true)
    window.removeEventListener('dragstart', this.preventContext)
    if (document.fullscreenElement === this.canvas.parentElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      }
    })
    this.renderer.dispose()
    void this.audio.close()
  }

  private buildWorld() {
    this.scene.background = new THREE.Color(0x040706)
    this.scene.fog = new THREE.FogExp2(0x0a1413, 0.009)
    this.scene.add(new THREE.HemisphereLight(0x91abb0, 0x111612, 0.72))
    this.scene.add(new THREE.AmbientLight(0x8ca39c, 0.14))

    const moon = new THREE.DirectionalLight(0xb9d6df, 1.65)
    moon.position.set(-24, 35, -25)
    moon.castShadow = true
    moon.shadow.mapSize.set(2048, 2048)
    moon.shadow.camera.left = -30
    moon.shadow.camera.right = 30
    moon.shadow.camera.top = 65
    moon.shadow.camera.bottom = -65
    this.scene.add(moon)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.width + 8, WORLD.length + 10, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x141918, roughness: 0.96, metalness: 0.02 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.z = 0
    ground.receiveShadow = true
    this.scene.add(ground)

    const laneMaterial = new THREE.MeshBasicMaterial({ color: 0x39453e, transparent: true, opacity: 0.42 })
    for (const x of [-4, 0, 4]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.08, WORLD.length - 6), laneMaterial)
      line.rotation.x = -Math.PI / 2
      line.position.set(x, 0.008, 0)
      this.scene.add(line)
    }

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x0f1514, roughness: 0.9 })
    for (const x of [-WORLD.width / 2 - 0.3, WORLD.width / 2 + 0.3]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, WORLD.wallHeight, WORLD.length), wallMaterial)
      wall.position.set(x, WORLD.wallHeight / 2, 0)
      wall.castShadow = wall.receiveShadow = true
      this.scene.add(wall)
    }

    const palette: Record<string, number> = {
      low: 0x4b514b,
      crate: 0x5b4b36,
      wall: 0x313837,
      container: 0x263e3d,
      vehicle: 0x353b34,
      platform: 0x232827,
    }
    const bvhParts: THREE.BufferGeometry[] = []
    for (const obstacle of MAP_OBSTACLES) {
      const geometry = new THREE.BoxGeometry(obstacle.size.x, obstacle.size.y, obstacle.size.z)
      const material = new THREE.MeshStandardMaterial({
        color: palette[obstacle.kind] ?? 0x3a4140,
        roughness: obstacle.kind === 'container' ? 0.58 : 0.88,
        metalness: obstacle.kind === 'container' ? 0.48 : 0.08,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(obstacle.center.x, obstacle.center.y, obstacle.center.z)
      mesh.castShadow = mesh.receiveShadow = true
      this.scene.add(mesh)
      const mergedPart = geometry.clone()
      mergedPart.translate(obstacle.center.x, obstacle.center.y, obstacle.center.z)
      bvhParts.push(mergedPart)
      this.addEdgeStripes(obstacle)
    }
    const collisionGeometry = mergeGeometries(bvhParts, false)
    collisionGeometry.computeBoundsTree()
    const collisionMesh = new THREE.Mesh(collisionGeometry, new THREE.MeshBasicMaterial({ visible: false }))
    collisionMesh.name = 'static-bvh'
    this.scene.add(collisionMesh)
    for (const geometry of bvhParts) geometry.dispose()

    this.addFinishLine()
    this.addPlatformWeaponLamp()
    this.addAtmosphere()
  }

  private addPlatformWeaponLamp() {
    const fixtureMaterial = new THREE.MeshStandardMaterial({ color: 0x2c312e, roughness: 0.45, metalness: 0.65 })
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.1, 8), fixtureMaterial)
    arm.position.set(0.9, 9.25, 22.4)
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 12, 1, true), fixtureMaterial)
    shade.position.set(0.9, 9.75, 22.1)
    shade.rotation.x = Math.PI * 0.42
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffdfad }))
    bulb.position.set(0.9, 9.64, 21.98)
    this.platformWeaponLight.position.set(0.9, 9.72, 22.02)
    this.platformWeaponLight.target.position.set(0.28, 9.15, 21.55)
    this.scene.add(arm, shade, bulb, this.platformWeaponLight, this.platformWeaponLight.target)
  }

  private addEdgeStripes(obstacle: (typeof MAP_OBSTACLES)[number]) {
    if (obstacle.kind === 'platform') return
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(obstacle.size.x * 0.7, 3), 0.035, 0.08),
      new THREE.MeshBasicMaterial({ color: obstacle.kind === 'container' ? 0xd59f34 : 0xa3b54b }),
    )
    marker.position.set(obstacle.center.x, obstacle.center.y + obstacle.size.y / 2 + 0.02, obstacle.center.z - obstacle.size.z / 2 - 0.01)
    this.scene.add(marker)
  }

  private addFinishLine() {
    const finish = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.width, 0.35),
      new THREE.MeshBasicMaterial({ color: 0xe4ff59, transparent: true, opacity: 0.65 }),
    )
    finish.rotation.x = -Math.PI / 2
    finish.position.set(0, 0.014, WORLD.exitZ)
    this.scene.add(finish)
    for (const x of [-5.2, 5.2]) {
      const light = new THREE.PointLight(0xff3e2e, 8, 4, 2)
      light.position.set(x, 2.5, WORLD.exitZ)
      this.scene.add(light)
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13), new THREE.MeshBasicMaterial({ color: 0xff3e2e }))
      bulb.position.copy(light.position)
      this.scene.add(bulb)
    }
  }

  private addAtmosphere() {
    const starsGeometry = new THREE.BufferGeometry()
    const values: number[] = []
    for (let index = 0; index < 240; index += 1) values.push((Math.random() - 0.5) * 180, 12 + Math.random() * 50, (Math.random() - 0.5) * 180)
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3))
    this.scene.add(new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xa9bdbe, size: 0.07, transparent: true, opacity: 0.55 })))

    const lampPositions = [-23, -19, -15, -11, -7, -3, 1, 5, 9, 13, 17]
    lampPositions.forEach((z, index) => {
      const x = index % 2 === 0 ? -5.2 : 5.2
      const color = index % 3 === 0 ? 0xffd6a0 : 0xb8e5dc
      const lamp = new THREE.SpotLight(color, 55, 14, Math.PI / 4.2, 0.58, 1.45)
      lamp.position.set(x, 6.8, z)
      lamp.target.position.set(index % 2 === 0 ? -1 : 1, 0, z + 1)
      if (index === 3 || index === 7) {
        lamp.castShadow = true
        lamp.shadow.mapSize.set(512, 512)
      }
      const fill = new THREE.PointLight(color, 9, 6, 2)
      fill.position.copy(lamp.position)
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 6.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x252c29, roughness: 0.7, metalness: 0.5 }),
      )
      pole.position.set(x, 3.4, z)
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.32), new THREE.MeshBasicMaterial({ color }))
      bulb.position.copy(lamp.position)
      this.scene.add(lamp, lamp.target, fill, pole, bulb)
    })
  }

  private buildViewModel() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x141817, roughness: 0.42, metalness: 0.72 })
    const accent = new THREE.MeshStandardMaterial({ color: 0x788260, roughness: 0.65, metalness: 0.2 })
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.72), dark)
    receiver.position.set(0.31, -0.23, -0.65)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.82, 12), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0.31, -0.2, -1.34)
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.48, 16), dark)
    scope.rotation.x = Math.PI / 2
    scope.position.set(0.31, -0.105, -0.67)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.44), accent)
    stock.position.set(0.35, -0.29, -0.22)
    this.viewModel.add(receiver, barrel, scope, stock, this.muzzleLight, this.weaponLight)
    this.muzzleLight.position.set(0.31, -0.2, -1.78)
    this.weaponLight.position.set(0.05, 0.08, -0.25)
    this.camera.add(this.viewModel)
    this.scene.add(this.camera)
  }

  private bindEvents() {
    document.addEventListener('pointerlockchange', this.pointerLockChanged)
    document.addEventListener('mousemove', this.mouseMoved)
    window.addEventListener('keydown', this.keyDown, true)
    window.addEventListener('keyup', this.keyUp, true)
    window.addEventListener('mousedown', this.mouseDown)
    window.addEventListener('contextmenu', this.preventContext)
    window.addEventListener('auxclick', this.preventContext)
    window.addEventListener('wheel', this.preventWheel, { passive: false, capture: true })
    window.addEventListener('dragstart', this.preventContext)
  }

  private pointerLockChanged = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas
  }

  private mouseMoved = (event: MouseEvent) => {
    if (!this.pointerLocked || !this.localState) return
    const degrees = degreesPerMouseCount(this.settings.sensitivity, this.localScope, this.settings.zoomSensitivity)
    this.localState.yaw -= THREE.MathUtils.degToRad(event.movementX * degrees)
    this.localState.pitch = clampPitch(this.localState.pitch + THREE.MathUtils.degToRad(event.movementY * degrees))
  }

  private keyDown = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    this.keys.add(event.code)
    if (!event.repeat && event.code === 'KeyR') this.connection.send({ type: 'weapon.reload', payload: {} })
  }

  private keyUp = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    this.keys.delete(event.code)
  }
  private preventContext = (event: MouseEvent) => event.preventDefault()
  private preventWheel = (event: WheelEvent) => event.preventDefault()

  private mouseDown = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!this.pointerLocked) return
    if (event.button === 2) this.cycleScope()
    else if (event.button === 0) this.fire()
  }

  private cycleScope() {
    if (this.latestOwn?.role !== 'sniper' || this.latestOwn.life !== 'alive') return
    this.localScope = ((this.localScope + 1) % 3) as 0 | 1 | 2
    if (this.localState) this.localState.scopedLevel = this.localScope
    this.connection.send({ type: 'weapon.scope', payload: { level: this.localScope } })
    this.playClick(this.localScope ? 430 : 260)
  }

  private fire() {
    const now = Date.now()
    if (this.latestOwn?.role !== 'sniper' || this.latestOwn.life !== 'alive' || this.localAmmo <= 0 || now < this.localNextShotAt) return
    this.localAmmo -= 1
    this.localNextShotAt = now + CS2_AWP_2026_08.cycleTimeMs
    this.localScope = 0
    if (this.localState) {
      this.localState.scopedLevel = 0
      this.localState.pitch = clampPitch(this.localState.pitch - THREE.MathUtils.degToRad(CS2_AWP_2026_08.recoilPitchDegrees))
    }
    this.recoil = 1
    this.muzzleLight.intensity = 45
    this.playShot()
    this.connection.send({
      type: 'shot.fire',
      payload: {
        shotId: createShotId(),
        inputSeq: this.inputSequence.current,
        clientTime: performance.timeOrigin + performance.now(),
        rttMs: this.connection.rttMs,
      },
    })
  }

  private playClick(frequency: number) {
    const oscillator = this.audio.createOscillator()
    const gain = this.audio.createGain()
    oscillator.frequency.setValueAtTime(frequency, this.audio.currentTime)
    gain.gain.setValueAtTime(0.035, this.audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, this.audio.currentTime + 0.045)
    oscillator.connect(gain).connect(this.audio.destination)
    oscillator.start()
    oscillator.stop(this.audio.currentTime + 0.05)
  }

  private playShot() {
    const duration = 0.42
    const sampleRate = this.audio.sampleRate
    const buffer = this.audio.createBuffer(1, sampleRate * duration, sampleRate)
    const values = buffer.getChannelData(0)
    for (let index = 0; index < values.length; index += 1) {
      const time = index / sampleRate
      values[index] = (Math.random() * 2 - 1) * Math.exp(-time * 15) * (0.8 + Math.sin(time * 110) * 0.2)
    }
    const source = this.audio.createBufferSource()
    const filter = this.audio.createBiquadFilter()
    const gain = this.audio.createGain()
    filter.type = 'lowpass'
    filter.frequency.value = 1700
    gain.gain.value = 0.32
    source.buffer = buffer
    source.connect(filter).connect(gain).connect(this.audio.destination)
    source.start()
  }

  private playFootstep(volume: number, pan = 0) {
    if (this.audio.state !== 'running' || volume <= 0.001) return
    const duration = 0.085
    const buffer = this.audio.createBuffer(1, Math.floor(this.audio.sampleRate * duration), this.audio.sampleRate)
    const values = buffer.getChannelData(0)
    for (let index = 0; index < values.length; index += 1) {
      const time = index / this.audio.sampleRate
      values[index] = ((Math.random() * 2 - 1) * 0.72 + Math.sin(time * 620) * 0.28) * Math.exp(-time * 42)
    }
    const source = this.audio.createBufferSource()
    const filter = this.audio.createBiquadFilter()
    const gain = this.audio.createGain()
    const stereo = this.audio.createStereoPanner()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.value = 260 + Math.random() * 80
    filter.Q.value = 0.75
    gain.gain.value = volume
    stereo.pan.value = THREE.MathUtils.clamp(pan, -1, 1)
    source.connect(filter).connect(gain).connect(stereo).connect(this.audio.destination)
    source.start()
  }

  private receive(message: ServerMessage) {
    if (message.type === 'room.state') this.applyRoom(message.payload, Date.now())
    else if (message.type === 'state.snapshot') this.applyRoom(message.payload.room, message.payload.serverTime)
    else if (message.type === 'round.result') this.applyRoom(message.payload.room, Date.now())
    else if (message.type === 'shot.result') this.showHit(message.payload)
  }

  private applyRoom(room: RoomSnapshot, serverTime: number) {
    this.room = room
    const nextRoundIndex = room.round?.index ?? -1
    const roundChanged = this.inputSequence.enterRound(nextRoundIndex)
    if (roundChanged) {
      this.pendingInputs.splice(0)
      this.keys.clear()
      this.lastLocalStepAt = 0
    }
    const own = room.players.find(player => player.id === this.connection.playerId) ?? null
    this.latestOwn = own
    if (own) {
      if (!this.localState || this.localState.role !== own.role || roundChanged) {
        this.localState = cloneState(own)
        this.localAmmo = own.ammo
        this.localReserve = own.reserveAmmo
        this.localScope = own.scopedLevel
      } else {
        const error = Math.hypot(
          this.localState.position.x - own.position.x,
          this.localState.position.y - own.position.y,
          this.localState.position.z - own.position.z,
        )
        const correction = error > 1.5 ? 1 : 0.22
        this.localState.position.x = THREE.MathUtils.lerp(this.localState.position.x, own.position.x, correction)
        this.localState.position.y = THREE.MathUtils.lerp(this.localState.position.y, own.position.y, correction)
        this.localState.position.z = THREE.MathUtils.lerp(this.localState.position.z, own.position.z, correction)
        this.localState.velocity = { ...own.velocity }
        this.localState.body = { ...own.body, limbs: { ...own.body.limbs } }
        this.localState.role = own.role
        this.localState.grounded = own.grounded
        this.localState.crouching = own.crouching
        if (own.lastProcessedInput >= this.inputSequence.current - 3) {
          this.localAmmo = own.ammo
          this.localReserve = own.reserveAmmo
        }
      }
    }
    this.updatePlayers(room.players, serverTime)
  }

  private updatePlayers(players: PlayerSnapshot[], serverTime: number) {
    const active = new Set(players.map(player => player.id))
    for (const player of players) {
      if (player.id === this.connection.playerId) continue
      let visual = this.playerVisuals.get(player.id)
      if (!visual) {
        visual = this.createPlayerVisual(player)
        this.playerVisuals.set(player.id, visual)
        this.scene.add(visual.group)
      }
      visual.group.userData.snapshot = player
      const lastFrame = visual.frames.at(-1)
      if (!lastFrame || serverTime > lastFrame.at) visual.frames.push({ at: serverTime, snapshot: structuredClone(player) })
      while (visual.frames.length > 12) visual.frames.shift()
      visual.parts.leftArm.visible = player.body.limbs.leftArm === 'intact'
      visual.parts.rightArm.visible = player.body.limbs.rightArm === 'intact'
      visual.parts.leftLeg.visible = player.body.limbs.leftLeg === 'intact'
      visual.parts.rightLeg.visible = player.body.limbs.rightLeg === 'intact'
      visual.group.visible = player.life !== 'escaped'
    }
    for (const [id, visual] of this.playerVisuals) {
      if (!active.has(id)) {
        this.scene.remove(visual.group)
        this.playerVisuals.delete(id)
      }
    }
  }

  private createPlayerVisual(player: PlayerSnapshot): PlayerVisual {
    const group = new THREE.Group()
    const uniform = new THREE.MeshStandardMaterial({ color: player.role === 'sniper' ? 0x746441 : 0x4c5953, roughness: 0.84 })
    const armor = new THREE.MeshStandardMaterial({ color: 0x171d1b, roughness: 0.74, metalness: 0.12 })
    const skin = new THREE.MeshStandardMaterial({ color: 0x816c5e, roughness: 0.92 })
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), skin)
    head.position.y = 1.64
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.3), armor)
    torso.position.y = 1.14
    const makeLimb = (radius: number, length: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 8), uniform)
      mesh.position.set(x, y, 0)
      return mesh
    }
    const leftArm = makeLimb(0.11, 0.55, -0.4, 1.13)
    const rightArm = makeLimb(0.11, 0.55, 0.4, 1.13)
    const leftLeg = makeLimb(0.135, 0.58, -0.18, 0.45)
    const rightLeg = makeLimb(0.135, 0.58, 0.18, 0.45)
    group.add(head, torso, leftArm, rightArm, leftLeg, rightLeg)
    for (const child of group.children) if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = true

    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeTextCanvas(player.name, player.role === 'sniper' ? '#ffd76a' : '#dce9df'),
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    }))
    marker.position.y = 2.18
    marker.scale.set(1.8, 0.45, 1)
    group.add(marker)
    return {
      group,
      parts: { head, torso, leftArm, rightArm, leftLeg, rightLeg },
      lastPosition: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
      frames: [],
      lastStepAt: 0,
    }
  }

  private showHit(result: HitResult) {
    if (result.shooterId === this.connection.playerId) {
      this.hitText = result.targetId
        ? (result.fatal ? `目标终止 · -${result.damage}` : `${this.partLabel(result.bodyPart)} -${result.damage} · ${result.remainingHealth} HP`)
        : (result.blocked ? '掩体拦截' : '未命中')
      this.hitTextUntil = performance.now() + 850
    }
    if (!result.point || !result.targetId) return
    const visual = this.playerVisuals.get(result.targetId)
    if (result.detachedPart && visual) this.detachLimb(visual, result.detachedPart, result.point)
    this.spawnImpact(result.point, result.fatal)
  }

  private partLabel(part: HitResult['bodyPart']) {
    return ({ head: '头部', torso: '躯干', leftArm: '左臂', rightArm: '右臂', leftLeg: '左腿', rightLeg: '右腿' } as const)[part ?? 'torso']
  }

  private detachLimb(visual: PlayerVisual, part: LimbPart, point: { x: number; y: number; z: number }) {
    visual.parts[part].visible = false
    if (this.settings.reducedViolence) return
    const source = visual.parts[part]
    const debris = new THREE.Mesh(source.geometry.clone(), (source.material as THREE.Material).clone())
    source.getWorldPosition(debris.position)
    debris.quaternion.copy(visual.group.quaternion)
    debris.castShadow = true
    this.scene.add(debris)
    this.debris.push({
      mesh: debris,
      velocity: new THREE.Vector3((debris.position.x - point.x) * 3 + (Math.random() - 0.5) * 2, 2.2, (Math.random() - 0.5) * 2),
      expiresAt: performance.now() + 6500,
    })
  }

  private spawnImpact(point: { x: number; y: number; z: number }, fatal: boolean) {
    const count = this.settings.reducedViolence ? 4 : fatal ? 28 : 16
    const color = this.settings.reducedViolence ? 0xe4ff59 : 0x75160f
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(this.settings.reducedViolence ? 0.018 : 0.025, 5, 4), new THREE.MeshBasicMaterial({ color }))
      mesh.position.set(point.x, point.y, point.z)
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4.5, Math.random() * 3.8, (Math.random() - 0.5) * 4.5),
        expiresAt: performance.now() + 700 + Math.random() * 700,
      })
    }
    if (!this.settings.reducedViolence) {
      const stain = new THREE.Mesh(
        new THREE.CircleGeometry(fatal ? 0.34 : 0.18, 18),
        new THREE.MeshBasicMaterial({ color: 0x3e0a08, transparent: true, opacity: 0.58, depthWrite: false }),
      )
      stain.rotation.x = -Math.PI / 2
      stain.position.set(point.x, 0.016, point.z)
      stain.scale.y = 0.55 + Math.random() * 0.35
      this.scene.add(stain)
      this.stains.push({ mesh: stain, expiresAt: performance.now() + 30_000 })
    }
  }

  private animate = () => {
    if (this.disposed) return
    this.frameHandle = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    this.inputAccumulator += dt
    while (this.inputAccumulator >= SIMULATION_DT) {
      this.inputAccumulator -= SIMULATION_DT
      this.stepInput()
    }
    this.updateCamera(dt)
    this.animatePlayers(dt)
    this.updateEffects(dt)
    this.resize()
    this.renderer.render(this.scene, this.camera)
    this.emitRuntime()
  }

  private stepInput() {
    if (!this.localState || !this.latestOwn || this.room?.phase !== 'active') return
    const buttons: InputButtons = {
      forward: this.keys.has('KeyW'),
      back: this.keys.has('KeyS'),
      left: this.keys.has('KeyA'),
      right: this.keys.has('KeyD'),
      walk: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('ControlRight'),
      jump: this.keys.has('Space'),
    }
    const command: InputCommand = {
      seq: this.inputSequence.next(),
      clientTime: performance.timeOrigin + performance.now(),
      yaw: this.localState.yaw,
      pitch: this.localState.pitch,
      buttons,
    }
    simulateMovement(this.localState, command, SIMULATION_DT)
    this.pendingInputs.push(command)
    if (this.pendingInputs.length >= Math.max(1, SIMULATION_HZ / SNAPSHOT_HZ)) {
      this.connection.send({ type: 'input.batch', payload: { commands: this.pendingInputs.splice(0) } })
    }
  }

  private updateCamera(dt: number) {
    if (!this.localState) return
    const state = this.localState
    const eye = state.crouching ? 1.05 : 1.64
    const speed = Math.hypot(state.velocity.x, state.velocity.z)
    this.walkPhase += dt * speed * 6
    const bob = state.grounded ? Math.sin(this.walkPhase) * Math.min(speed * 0.0025, 0.012) : 0
    this.camera.position.set(state.position.x, state.position.y + eye + bob, state.position.z)
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y = state.yaw
    this.camera.rotation.x = -state.pitch
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 13, dt)
    this.viewModel.rotation.x = -this.recoil * 0.08
    this.viewModel.position.y = -this.recoil * 0.04
    this.viewModel.visible = state.role === 'sniper' && this.latestOwn?.life === 'alive' && this.localScope === 0
    this.weaponLight.intensity = state.role === 'sniper' && this.latestOwn?.life === 'alive' ? 3.2 : 0
    this.platformWeaponLight.intensity = state.role === 'sniper' && this.latestOwn?.life === 'alive' ? 30 : 0
    const targetFov = sourceFovToVertical(this.localScope === 0 ? CS2_AWP_2026_08.baseFov : CS2_AWP_2026_08.zoomFovs[this.localScope - 1]!)
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, this.localScope ? 14 : 18, dt)
    this.camera.updateProjectionMatrix()
    const now = performance.now()
    const quietStep = state.crouching || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const stepInterval = quietStep ? 620 : Math.max(285, 535 - speed * 48)
    if (state.role === 'runner' && this.latestOwn?.life === 'alive' && state.grounded && speed > 0.65 && now - this.lastLocalStepAt >= stepInterval) {
      this.lastLocalStepAt = now
      this.playFootstep(quietStep ? 0.025 : 0.07)
    }
  }

  private animatePlayers(dt: number) {
    for (const visual of this.playerVisuals.values()) {
      const latest = visual.group.userData.snapshot as PlayerSnapshot | undefined
      if (!latest) continue
      const interpolationDelay = THREE.MathUtils.clamp(this.connection.rttMs * 0.5 + 20, 45, 100)
      const renderAt = Date.now() - interpolationDelay
      let older = visual.frames[0]
      let newer = visual.frames.at(-1)
      for (let index = 1; index < visual.frames.length; index += 1) {
        const candidate = visual.frames[index]!
        if (candidate.at >= renderAt) {
          newer = candidate
          older = visual.frames[index - 1]!
          break
        }
      }
      const oldSnapshot = older?.snapshot ?? latest
      const newSnapshot = newer?.snapshot ?? latest
      const frameDuration = Math.max(1, (newer?.at ?? renderAt) - (older?.at ?? renderAt))
      const alpha = THREE.MathUtils.clamp((renderAt - (older?.at ?? renderAt)) / frameDuration, 0, 1)
      const target = new THREE.Vector3(
        THREE.MathUtils.lerp(oldSnapshot.position.x, newSnapshot.position.x, alpha),
        THREE.MathUtils.lerp(oldSnapshot.position.y, newSnapshot.position.y, alpha),
        THREE.MathUtils.lerp(oldSnapshot.position.z, newSnapshot.position.z, alpha),
      )
      const snapshot = alpha < 0.5 ? oldSnapshot : newSnapshot
      visual.group.position.lerp(target, 1 - Math.exp(-dt * 14))
      const yawDelta = Math.atan2(Math.sin(newSnapshot.yaw - oldSnapshot.yaw), Math.cos(newSnapshot.yaw - oldSnapshot.yaw))
      visual.group.rotation.y = oldSnapshot.yaw + yawDelta * alpha
      visual.group.scale.y = THREE.MathUtils.lerp(visual.group.scale.y, snapshot.crouching ? 0.69 : 1, 1 - Math.exp(-dt * 15))
      const moving = Math.hypot(snapshot.velocity.x, snapshot.velocity.z)
      const now = performance.now()
      const remoteQuiet = snapshot.crouching || moving < 3
      const remoteStepInterval = remoteQuiet ? 620 : Math.max(285, 535 - moving * 48)
      if (snapshot.role === 'runner' && snapshot.life === 'alive' && snapshot.grounded && moving > 0.65 && now - visual.lastStepAt >= remoteStepInterval) {
        visual.lastStepAt = now
        const distance = this.camera.position.distanceTo(target)
        if (distance < 28) this.playFootstep((remoteQuiet ? 0.025 : 0.065) * (1 - distance / 28), (target.x - this.camera.position.x) / 10)
      }
      const phase = performance.now() * 0.009 * Math.max(moving, 0.2)
      if (snapshot.life === 'dead' || snapshot.life === 'incapacitated') {
        visual.group.rotation.z = THREE.MathUtils.lerp(visual.group.rotation.z, Math.PI / 2, 1 - Math.exp(-dt * 5))
      } else {
        visual.group.rotation.z = THREE.MathUtils.lerp(visual.group.rotation.z, 0, 1 - Math.exp(-dt * 8))
        visual.parts.leftLeg.rotation.x = Math.sin(phase) * Math.min(moving * 0.14, 0.65)
        visual.parts.rightLeg.rotation.x = -visual.parts.leftLeg.rotation.x
        visual.parts.leftArm.rotation.x = -visual.parts.leftLeg.rotation.x * 0.65
        visual.parts.rightArm.rotation.x = -visual.parts.rightLeg.rotation.x * 0.65
      }
      visual.lastPosition.copy(target)
    }
  }

  private updateEffects(dt: number) {
    this.muzzleLight.intensity = THREE.MathUtils.damp(this.muzzleLight.intensity, 0, 38, dt)
    const now = performance.now()
    const update = (items: Debris[], gravity: number) => {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index]!
        item.velocity.y -= gravity * dt
        item.mesh.position.addScaledVector(item.velocity, dt)
        item.mesh.rotateOnWorldAxis(UP, dt * 2)
        if (item.mesh.position.y < 0.03) {
          item.mesh.position.y = 0.03
          item.velocity.multiplyScalar(0.2)
        }
        if (now >= item.expiresAt) {
          this.scene.remove(item.mesh)
          item.mesh.geometry.dispose()
          ;(item.mesh.material as THREE.Material).dispose()
          items.splice(index, 1)
        }
      }
    }
    update(this.debris, 9.8)
    update(this.particles, 6.5)
    for (let index = this.stains.length - 1; index >= 0; index -= 1) {
      const stain = this.stains[index]!
      if (now < stain.expiresAt) continue
      this.scene.remove(stain.mesh)
      stain.mesh.geometry.dispose()
      ;(stain.mesh.material as THREE.Material).dispose()
      this.stains.splice(index, 1)
    }
  }

  private emitRuntime() {
    const now = performance.now()
    if (now >= this.hitTextUntil) this.hitText = ''
    this.onRuntime({
      pointerLocked: this.pointerLocked,
      rawInput: this.rawInput,
      role: this.latestOwn?.role ?? 'spectator',
      life: this.latestOwn?.life ?? 'spectator',
      health: this.latestOwn?.body.health ?? 0,
      ammo: this.localAmmo,
      reserveAmmo: this.localReserve,
      scopeLevel: this.localScope,
      roundTimeMs: this.room?.round ? Math.max(0, this.room.round.endsAt - Date.now()) : 0,
      velocity: this.localState ? Math.hypot(this.localState.velocity.x, this.localState.velocity.z) : 0,
      hitText: this.hitText,
    })
  }

  private resize() {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height || (this.canvas.width === Math.floor(width * this.renderer.getPixelRatio()) && this.canvas.height === Math.floor(height * this.renderer.getPixelRatio()))) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }
}
