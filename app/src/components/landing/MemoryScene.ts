import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/** Minimal frame timer — avoids the deprecated THREE.Clock and keeps zero deps. */
class FrameTimer {
  private last = 0;
  private elapsed = 0;
  private delta = 0;
  update(): void {
    const now = (typeof performance !== "undefined" ? performance.now() : 0) / 1000;
    if (this.last === 0) this.last = now;
    this.delta = Math.min(0.05, now - this.last); // clamp to avoid jumps after tab-switch
    this.last = now;
    this.elapsed += this.delta;
  }
  getDelta(): number {
    return this.delta;
  }
  getElapsed(): number {
    return this.elapsed;
  }
}

const PARTICLE_COUNT = 1200;
const HUB_COUNT = 10;
const TOKEN_COUNT = 12;

const COLOR_INDIGO = new THREE.Color(0x4a3aa8);
const COLOR_OCHRE = new THREE.Color(0xd9a653);
const COLOR_LILAC = new THREE.Color(0x8b7fc7);
const COLOR_ALERT = new THREE.Color(0xc2492f);
const COLOR_BG = new THREE.Color("#efe8d5");

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function actProgress(p: number, start: number, end: number): number {
  return Math.max(0, Math.min(1, (p - start) / (end - start)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MemoryScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private world!: THREE.Group; 
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private grainPass!: ShaderPass;
  private timer = new FrameTimer();

  // The main Volumetric Core particle system
  private coreParticles!: THREE.Points;
  private corePositionsBase = new Float32Array(PARTICLE_COUNT * 3);
  private corePositionsLattice = new Float32Array(PARTICLE_COUNT * 3);
  private corePositionsTunnel = new Float32Array(PARTICLE_COUNT * 3);
  private coreCurrentPositions = new Float32Array(PARTICLE_COUNT * 3);
  private coreVelocities = new Float32Array(PARTICLE_COUNT * 3);

  // Concentric wireframe orbital shells
  private shells: THREE.LineSegments[] = [];

  // Shockwave alert rings
  private shockwaveRings: THREE.Mesh[] = [];

  // Interaction
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2(-999, -999);
  private cameraOffset = new THREE.Vector3(0, 0, 0);
  private targetCameraOffset = new THREE.Vector3(0, 0, 0);
  public hoveredNodeIdx: number | null = null;
  private lastScrollY = 0;
  private scrollSpeed = 0;
  private vec = new THREE.Vector3();
  private mouseWorldPos = new THREE.Vector3();

  // HUD & Connections
  private hudGrid!: THREE.GridHelper;
  private scanningLine!: THREE.Mesh;
  private connectionsGeom = new THREE.BufferGeometry();
  private connectionsLine!: THREE.LineSegments;

  // Metadata labels mapped to index nodes
  readonly labels: { idx: number; text: string; detail?: string; kind: "self" | "person" | "category" | "episode" | "fact" | "source" }[] = [
    { idx: 0, text: "You", detail: "Active Brain Context", kind: "self" },
    { idx: 12, text: "Work", detail: "Category · 48 episodes", kind: "category" },
    { idx: 24, text: "Friends", detail: "Category · 12 contacts", kind: "category" },
    { idx: 36, text: "Family", detail: "Category · 5 contacts", kind: "category" },
    { idx: 48, text: "Project Aurora", detail: "Topic · 3 active loops", kind: "category" },
    { idx: 60, text: "Personal AI", detail: "Topic · 15 references", kind: "category" },
    
    // People
    { idx: 14, text: "Sara Lin", detail: "Contact · Realtor · 2× reinforced", kind: "person" },
    { idx: 27, text: "Priya Shah", detail: "Contact · Product Manager", kind: "person" },
    { idx: 41, text: "Marcus Reyes", detail: "Contact · Lead Designer", kind: "person" },
    { idx: 58, text: "Jane Okafor", detail: "Contact · Attorney", kind: "person" },
    { idx: 73, text: "Raju Mehta", detail: "Contact · Software Lead", kind: "person" },
    { idx: 96, text: "Mom", detail: "Contact · Family Loop", kind: "person" },
    { idx: 121, text: "Dr. Alvarez", detail: "Contact · Cardiologist", kind: "person" },
    
    // Sources / Connections
    { idx: 4, text: "Gmail Inbox", detail: "Connected · 1.2k emails", kind: "source" },
    { idx: 9, text: "GCal Sync", detail: "Connected · 85 meetings", kind: "source" },
    { idx: 20, text: "Local Notes", detail: "Syncing · 31 markdown files", kind: "source" },
    
    // Episodes
    { idx: 30, text: "Sync on Aurora", detail: "Meeting · 5 attendees · 12:15 PM", kind: "episode" },
    { idx: 45, text: "Dinner with Priya", detail: "Dinner · Aug 12 · 7:30 PM", kind: "episode" },
    { idx: 52, text: "Coffee w/ Marcus", detail: "Coffee · Aug 8 · 10:00 AM", kind: "episode" },
    { idx: 70, text: "Call w/ Elena", detail: "Call · Aug 14 · 11:30 AM", kind: "episode" },
    { idx: 88, text: "Weekly Review", detail: "Workspace Sync · Mondays", kind: "episode" },
    { idx: 104, text: "Design Handoff", detail: "Review · Wednesday", kind: "episode" },

    // Facts
    { idx: 22, text: "Aurora Due Wed", detail: "Commitment · confidence 0.88", kind: "fact" },
    { idx: 35, text: "Marcus = Realtor", detail: "Extracted fact · 5d ago", kind: "fact" },
    { idx: 50, text: "Sara's new phone", detail: "Updated contact attribute", kind: "fact" },
    { idx: 66, text: "Flight UA 244", detail: "Travel confirmation · Aug 24", kind: "fact" },
    { idx: 78, text: "Priya's new job", detail: "Extracted Fact · PM at Google", kind: "fact" },
    { idx: 90, text: "Owe Jane reply", detail: "Open loop · 3d overdue", kind: "fact" },
  ];
  labelScreens: { x: number; y: number; opacity: number }[] = [];

  // Mid-edge labels for actual data relationships (connected lines)
  readonly edgeLabels: { edgeIdx: number; text: string; kind: "email" | "meeting" | "system" | "conflict" }[] = [
    { edgeIdx: 12, text: "emailed", kind: "email" },
    { edgeIdx: 24, text: "met w/", kind: "meeting" },
    { edgeIdx: 36, text: "co-occurred", kind: "system" },
    { edgeIdx: 48, text: "owes draft", kind: "conflict" },
    { edgeIdx: 60, text: "referenced in", kind: "system" },
    { edgeIdx: 72, text: "collaborated", kind: "system" },
    { edgeIdx: 85, text: "contradicts", kind: "conflict" },
  ];
  edgeLabelScreens: { x: number; y: number; opacity: number }[] = [];

  // Meaning tokens traveling along pipeline conveyor belts
  private tokenEdge = new Int16Array(TOKEN_COUNT);
  private tokenT = new Float32Array(TOKEN_COUNT);
  private tokenSpeed = new Float32Array(TOKEN_COUNT);
  tokenScreens: { x: number; y: number; opacity: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.labelScreens = this.labels.map(() => ({ x: 0, y: 0, opacity: 0 }));
    this.edgeLabelScreens = this.edgeLabels.map(() => ({ x: 0, y: 0, opacity: 0 }));
    this.tokenScreens = Array.from({ length: TOKEN_COUNT }, () => ({ x: 0, y: 0, opacity: 0 }));
    const rand = mulberry32(53);
    for (let i = 0; i < TOKEN_COUNT; i++) {
      this.tokenEdge[i] = i % HUB_COUNT;
      this.tokenT[i] = rand();
      this.tokenSpeed[i] = 0.08 + rand() * 0.09;
    }
  }

  setMouse(x: number, y: number): void {
    this.mouse.set(x, y);
  }

  init(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(COLOR_BG, 0);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLOR_BG, 12, 45);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 120);
    this.camera.position.set(0, 0, 16);

    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 5, 6);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xc6b69a, 0.75));

    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.buildCoreParticles();
    this.buildConcentricShells();
    this.buildSonarRings();
    this.buildHUDAndConnections();
    this.buildComposer(w, h, dpr);
  }

  private buildHUDAndConnections(): void {
    // 1. HUD Grid
    this.hudGrid = new THREE.GridHelper(16, 16, 0x8b7fc7, 0x8b7fc7);
    this.hudGrid.position.set(0, -6, 0);
    (this.hudGrid.material as THREE.Material).transparent = true;
    (this.hudGrid.material as THREE.Material).opacity = 0;
    this.world.add(this.hudGrid);

    // 2. HUD Scanning Ring
    const laserGeom = new THREE.RingGeometry(0, 6, 64);
    const laserMat = new THREE.MeshBasicMaterial({
      color: COLOR_OCHRE,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.scanningLine = new THREE.Mesh(laserGeom, laserMat);
    this.scanningLine.rotation.x = Math.PI / 2;
    this.world.add(this.scanningLine);

    // 3. Dynamic Connections
    const connMat = new THREE.LineBasicMaterial({
      color: COLOR_LILAC,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.connectionsLine = new THREE.LineSegments(this.connectionsGeom, connMat);
    this.world.add(this.connectionsLine);
  }

  private buildCoreParticles(): void {
    const rand = mulberry32(88);
    const colors = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // 1. Target Base (swirling spherical nebula)
      const r = 1.2 + rand() * 2.8;
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      const bx = r * Math.sin(v) * Math.cos(u);
      const by = r * Math.sin(v) * Math.sin(u);
      const bz = r * Math.cos(v);

      this.corePositionsBase[i * 3 + 0] = bx;
      this.corePositionsBase[i * 3 + 1] = by;
      this.corePositionsBase[i * 3 + 2] = bz;

      this.coreCurrentPositions[i * 3 + 0] = bx;
      this.coreCurrentPositions[i * 3 + 1] = by;
      this.coreCurrentPositions[i * 3 + 2] = bz;

      // Random velocities for continuous drift
      this.coreVelocities[i * 3 + 0] = (rand() - 0.5) * 0.4;
      this.coreVelocities[i * 3 + 1] = (rand() - 0.5) * 0.4;
      this.coreVelocities[i * 3 + 2] = (rand() - 0.5) * 0.4;

      // 2. Target Lattice (geometric structures / clusters)
      // Hub nodes are clustered, other nodes align to polyhedral vertices
      const group = i % 8;
      const theta = (group / 8) * Math.PI * 2 + rand() * 0.4;
      const phi = (rand() - 0.5) * Math.PI * 0.8;
      const lr = 2.0 + (i % 3) * 0.8;
      this.corePositionsLattice[i * 3 + 0] = lr * Math.cos(phi) * Math.cos(theta);
      this.corePositionsLattice[i * 3 + 1] = lr * Math.cos(phi) * Math.sin(theta);
      this.corePositionsLattice[i * 3 + 2] = lr * Math.sin(phi);

      // 3. Target Tunnel (traveling viewport tunnel)
      const tAngle = rand() * Math.PI * 2;
      const tRadius = 1.5 + rand() * 1.5;
      const tz = (i / PARTICLE_COUNT) * 40.0 - 20.0; // spread from -20 to 20
      this.corePositionsTunnel[i * 3 + 0] = Math.cos(tAngle) * tRadius;
      this.corePositionsTunnel[i * 3 + 1] = Math.sin(tAngle) * tRadius;
      this.corePositionsTunnel[i * 3 + 2] = tz;

      // Colors: indigo, lilac, and ochre highlights
      const roll = rand();
      const col = roll > 0.85 ? COLOR_OCHRE : roll > 0.6 ? COLOR_LILAC : COLOR_INDIGO;
      colors[i * 3 + 0] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.coreCurrentPositions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.coreParticles = new THREE.Points(geom, mat);
    this.world.add(this.coreParticles);
  }

  private buildConcentricShells(): void {
    // Elegant concentric outer rings (wireframes) orbiting the memory core
    const shellRadii = [2.2, 3.5, 4.8];
    const segments = 32;

    shellRadii.forEach((r, idx) => {
      const geom = new THREE.BufferGeometry();
      const vertices: number[] = [];
      
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        vertices.push(Math.cos(theta) * r, Math.sin(theta) * r, 0);
      }
      
      geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      
      const mat = new THREE.LineBasicMaterial({
        color: idx === 1 ? COLOR_OCHRE : COLOR_LILAC,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(geom, mat);
      // Give them unique initial rotational angles
      line.rotation.x = Math.random() * Math.PI;
      line.rotation.y = Math.random() * Math.PI;
      
      this.world.add(line);
      this.shells.push(line as unknown as THREE.LineSegments); // store reference
    });
  }

  private buildSonarRings(): void {
    // Expanding rings representing proactive sonar sweeps in Act 5
    const ringGeom = new THREE.RingGeometry(1, 1.025, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: COLOR_ALERT,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(ringGeom, ringMat.clone());
      ring.rotation.x = Math.PI / 2; // Flat horizontal plane
      this.world.add(ring);
      this.shockwaveRings.push(ring);
    }
  }

  private buildComposer(w: number, h: number, dpr: number): void {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.95, 0.7, 0.15);
    this.composer.addPass(this.bloomPass);

    this.grainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uGrain: { value: 0.038 },
        uVignette: { value: 0.88 },
        uAberration: { value: 0.0002 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uAberration;
        varying vec2 vUv;
        float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          vec2 rUv = vUv + vec2(uAberration, 0.0);
          vec2 bUv = vUv - vec2(uAberration, 0.0);
          
          float r = texture2D(tDiffuse, rUv).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, bUv).b;
          float a = texture2D(tDiffuse, vUv).a;
          
          vec4 c = vec4(r, g, b, a);
          c.rgb += (rand(vUv * 800.0 + uTime * 35.0) - 0.5) * uGrain;
          float d = distance(vUv, vec2(0.5));
          c.rgb *= mix(1.0, smoothstep(uVignette, 0.25, d), 0.5);
          gl_FragColor = c;
        }
      `,
    });
    this.composer.addPass(this.grainPass);
  }

  update(progress: number): void {
    this.timer.update();
    const dt = this.timer.getDelta();
    const el = this.timer.getElapsed();
    this.grainPass.uniforms.uTime.value = el;

    // Scroll speed for horizontal chromatic aberration separator
    const currentScrollY = progress * (typeof document !== "undefined" ? document.documentElement.scrollHeight - window.innerHeight : 1000);
    const scrollDelta = Math.abs(currentScrollY - this.lastScrollY);
    this.lastScrollY = currentScrollY;
    this.scrollSpeed = lerp(this.scrollSpeed, scrollDelta * 0.005, 0.1);
    const aberrationAmount = Math.max(0.0, Math.min(0.016, this.scrollSpeed));
    this.grainPass.uniforms.uAberration.value = 0.0002 + aberrationAmount;

    // Mouse Parallax (smooth tilting)
    if (this.mouse.x > -900) {
      this.targetCameraOffset.set(this.mouse.x * 1.8, this.mouse.y * 1.8, 0);
    } else {
      this.targetCameraOffset.set(0, 0, 0);
    }
    this.cameraOffset.lerp(this.targetCameraOffset, 0.05);

    // ── Camera path across Acts ─────────
    const camPaths: [number, number, number][] = [
      [0, 0, 16],   // Act 1: distant nebula
      [0, 0.8, 13.5], // Act 2: connect / vortex
      [0, 0.4, 9.5],  // Act 3: lattice ignition
      [0, 0, 0.1],  // Act 4: inside fly-through portal (starts moving)
      [0, 0.5, 14.5], // Act 5: alert / supernova pullback
      [0, 0, 26],   // Act 6: starfield pullback
    ];

    const segs = camPaths.length - 1;
    const s = Math.min(progress * segs, segs - 0.0001);
    const idx = Math.floor(s);
    const eased = smoothstep(0, 1, s - idx);
    const a = camPaths[idx]!;
    const b = camPaths[idx + 1]!;

    const floatX = Math.sin(el * 0.2) * 0.22;
    const floatY = Math.cos(el * 0.18) * 0.2;

    this.camera.position.set(
      lerp(a[0], b[0], eased) + floatX + this.cameraOffset.x,
      lerp(a[1], b[1], eased) + floatY + this.cameraOffset.y,
      lerp(a[2], b[2], eased)
    );
    this.camera.lookAt(0, 0, 0);

    // Rotate shells on different axes
    this.shells.forEach((line, index) => {
      const dir = index % 2 === 0 ? 1 : -1;
      line.rotation.x += dt * 0.15 * (index + 1) * dir;
      line.rotation.y += dt * 0.2 * (index + 1) * dir;
      line.rotation.z += dt * 0.08 * (index + 1) * dir;
      const opacity = smoothstep(0.12, 0.35, progress) * (1.0 - smoothstep(0.82, 0.95, progress));
      (line.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    });

    // ── Particle layout states ─────────
    const act2 = actProgress(progress, 0.166, 0.333);
    const act3 = actProgress(progress, 0.333, 0.5);
    const act4 = actProgress(progress, 0.5, 0.666);
    const act5 = actProgress(progress, 0.666, 0.833);
    const act6 = actProgress(progress, 0.833, 1.0);

    const overallOpacity = smoothstep(0.04, 0.16, progress) * (1 - smoothstep(0.93, 1.0, progress) * 0.45);
    (this.coreParticles.material as THREE.PointsMaterial).opacity = overallOpacity * 0.9;

    // Render shockwave alert rings in Act 5
    const pulseStrength = act5 * overallOpacity;
    for (let r = 0; r < this.shockwaveRings.length; r++) {
      const ring = this.shockwaveRings[r]!;
      const mat = ring.material as THREE.MeshBasicMaterial;
      if (pulseStrength > 0.05) {
        const t = (el * 0.72 + r * 0.33) % 1.0;
        const ringScale = t * 13.0;
        ring.scale.set(ringScale, ringScale, ringScale);
        mat.opacity = (1.0 - t) * pulseStrength * 0.85;
      } else {
        mat.opacity = 0;
      }
    }

    // Cursor Gravity calculations
    let hasMouseIntersection = false;
    if (this.mouse.x > -900 && this.camera) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      this.raycaster.ray.intersectPlane(plane, this.mouseWorldPos);
      hasMouseIntersection = true;
    }

    // Update positions and velocities
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const idx = i * 3;
      const bx = this.corePositionsBase[idx + 0]!;
      const by = this.corePositionsBase[idx + 1]!;
      const bz = this.corePositionsBase[idx + 2]!;

      const lx = this.corePositionsLattice[idx + 0]!;
      const ly = this.corePositionsLattice[idx + 1]!;
      const lz = this.corePositionsLattice[idx + 2]!;

      const tx = this.corePositionsTunnel[idx + 0]!;
      const ty = this.corePositionsTunnel[idx + 1]!;
      const tz = this.corePositionsTunnel[idx + 2]!;

      // 1. Calculate base swirling position (Act 1 / fluid noise)
      const noiseX = Math.sin(el * 0.8 + i * 0.12) * 0.15;
      const noiseY = Math.cos(el * 0.6 + i * 0.08) * 0.15;
      const noiseZ = Math.sin(el * 0.5 + i * 0.22) * 0.12;

      let targetX = bx + noiseX;
      let targetY = by + noiseY;
      let targetZ = bz + noiseZ;

      // 2. Act 2: Vortex Ingestion (pull in/vortex curves)
      if (act2 > 0.01) {
        // Curve path: Spiral vortex inwards
        const t2 = smoothstep(0, 1, act2);
        const spiralAngle = el * 2.0 + (i * 0.05);
        const spiralRadius = lerp(5.0, 2.0, t2) + Math.sin(i) * 0.5;
        const spiralX = Math.cos(spiralAngle) * spiralRadius;
        const spiralY = Math.sin(spiralAngle) * spiralRadius;
        const spiralZ = lerp(-6.0, 0.0, t2) + (i % 5) * 0.4;
        
        targetX = lerp(targetX, spiralX, t2);
        targetY = lerp(targetY, spiralY, t2);
        targetZ = lerp(targetZ, spiralZ, t2);
      }

      // 3. Act 3: Core Ignition Lattice
      if (act3 > 0.01) {
        const t3 = smoothstep(0, 1, act3);
        targetX = lerp(targetX, lx, t3);
        targetY = lerp(targetY, ly, t3);
        targetZ = lerp(targetZ, lz, t3);
      }

      // 4. Act 4: Volumetric Grid Tunnel
      if (act4 > 0.01) {
        const t4 = smoothstep(0, 1, act4);
        targetX = lerp(targetX, tx, t4);
        targetY = lerp(targetY, ty, t4);
        targetZ = lerp(targetZ, tz, t4);
      }

      // 5. Act 5: Supernova Shockwave (explosive outward expansion)
      if (act5 > 0.01) {
        const t5 = smoothstep(0.0, 0.5, act5) - smoothstep(0.5, 1.0, act5);
        // Calculate radial direction vector
        const len = Math.sqrt(targetX * targetX + targetY * targetY + targetZ * targetZ);
        const nx = len > 0 ? targetX / len : 0;
        const ny = len > 0 ? targetY / len : 0;
        const nz = len > 0 ? targetZ / len : 0;

        const shockDist = t5 * 6.5 * (1.0 + (i % 4) * 0.25);
        targetX += nx * shockDist;
        targetY += ny * shockDist;
        targetZ += nz * shockDist;
      }

      // 6. Act 6: Cosmic Dissolve (wide starfield)
      if (act6 > 0.01) {
        const t6 = smoothstep(0, 1, act6);
        const dx = (this.coreVelocities[idx + 0]!) * t6 * 15.0;
        const dy = (this.coreVelocities[idx + 1]!) * t6 * 15.0;
        const dz = (this.coreVelocities[idx + 2]!) * t6 * 15.0;
        targetX += dx;
        targetY += dy;
        targetZ += dz;
      }

      // A. Scroll Warp / Stretch
      const warpZ = (Math.sin(i * 0.1) * this.scrollSpeed * 6.5);
      targetZ += warpZ * (i % 2 === 0 ? 1 : -1);

      // B. Cursor Gravity Repel/Attract Field
      if (hasMouseIntersection) {
        const dx = targetX - this.mouseWorldPos.x;
        const dy = targetY - this.mouseWorldPos.y;
        const dz = targetZ - this.mouseWorldPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 4.5) {
          const repelForce = (1.0 - smoothstep(0, 4.5, dist)) * 1.6;
          const angle = Math.atan2(dy, dx);
          targetX += Math.cos(angle) * repelForce;
          targetY += Math.sin(angle) * repelForce;
          targetZ += Math.sin(i) * repelForce * 0.5;
        }
      }

      this.coreCurrentPositions[idx + 0] = targetX;
      this.coreCurrentPositions[idx + 1] = targetY;
      this.coreCurrentPositions[idx + 2] = targetZ;
    }
    (this.coreParticles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // C. Sweep scanning line and update HUD
    const sweepY = Math.sin(el * 1.2) * 5.5;
    this.scanningLine.position.y = sweepY;
    const hudOpacity = smoothstep(0.24, 0.38, progress) * (1.0 - smoothstep(0.8, 0.95, progress));
    (this.hudGrid.material as THREE.Material).opacity = hudOpacity * 0.05;
    (this.scanningLine.material as THREE.Material).opacity = hudOpacity * 0.15 * (0.85 + Math.sin(el * 8.0) * 0.15);

    // D. Update 3D Line Connections dynamically between label nodes
    const connPositions: number[] = [];
    const hubIndices = this.labels.map(l => l.idx);
    for (let a = 0; a < hubIndices.length; a++) {
      const idxA = hubIndices[a]! * 3;
      const ax = this.coreCurrentPositions[idxA + 0]!;
      const ay = this.coreCurrentPositions[idxA + 1]!;
      const az = this.coreCurrentPositions[idxA + 2]!;

      for (let b = 1; b <= 2; b++) {
        const nextHub = hubIndices[(a + b) % hubIndices.length]!;
        const idxB = nextHub * 3;
        const bx = this.coreCurrentPositions[idxB + 0]!;
        const by = this.coreCurrentPositions[idxB + 1]!;
        const bz = this.coreCurrentPositions[idxB + 2]!;

        connPositions.push(ax, ay, az);
        connPositions.push(bx, by, bz);
      }
    }
    this.connectionsGeom.setAttribute("position", new THREE.Float32BufferAttribute(connPositions, 3));
    if (this.connectionsGeom.attributes.position) {
      this.connectionsGeom.attributes.position.needsUpdate = true;
    }
    const connOpacity = smoothstep(0.28, 0.42, progress) * (1.0 - smoothstep(0.8, 0.95, progress));
    (this.connectionsLine.material as THREE.LineBasicMaterial).opacity = connOpacity * 0.28;

    // ── Project HTML Metadata Labels to Screen Space ─────────
    this.world.updateMatrixWorld(true);
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const labelAppear = smoothstep(0.34, 0.46, progress) * (1 - smoothstep(0.80, 0.95, progress));

    for (let k = 0; k < this.labels.length; k++) {
      const idx = this.labels[k]!.idx * 3;
      this.vec.set(
        this.coreCurrentPositions[idx + 0]!,
        this.coreCurrentPositions[idx + 1]!,
        this.coreCurrentPositions[idx + 2]!
      );
      this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);
      const behind = this.vec.z > 1;
      const depthFade = 1 - smoothstep(0.55, 1.0, this.vec.z);
      const out = this.labelScreens[k]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;

      const isHovered = this.hoveredNodeIdx !== null && this.labels[k]!.idx === this.hoveredNodeIdx;
      out.opacity = behind ? 0 : (isHovered ? 1.0 : labelAppear * depthFade * overallOpacity);
    }

    // ── Project HTML Mid-Edge Labels ─────────
    const edgeLabelAppear = smoothstep(0.42, 0.54, progress) * (1 - smoothstep(0.80, 0.95, progress));
    for (let k = 0; k < this.edgeLabels.length; k++) {
      const eIdx = this.edgeLabels[k]!.edgeIdx;
      const f = eIdx * 3;
      const t = ((eIdx + 11) % HUB_COUNT) * 3; // map back to some other hub

      const mx = (this.coreCurrentPositions[f + 0]! + this.coreCurrentPositions[t + 0]!) * 0.5;
      const my = (this.coreCurrentPositions[f + 1]! + this.coreCurrentPositions[t + 1]!) * 0.5;
      const mz = (this.coreCurrentPositions[f + 2]! + this.coreCurrentPositions[t + 2]!) * 0.5;
      this.vec.set(mx, my, mz);
      this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);

      const behind = this.vec.z > 1;
      const depthFade = 1 - smoothstep(0.55, 1.0, this.vec.z);
      const out = this.edgeLabelScreens[k]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;
      out.opacity = behind ? 0 : edgeLabelAppear * depthFade * overallOpacity;
    }

    // ── Meaning-tokens: travel along edge projections ─────────
    const tokenAppear = smoothstep(0.34, 0.48, progress) * (1 - smoothstep(0.80, 0.95, progress));
    for (let i = 0; i < TOKEN_COUNT; i++) {
      this.tokenT[i]! += this.tokenSpeed[i]! * dt;
      if (this.tokenT[i]! > 1) {
        this.tokenT[i]! -= 1;
        this.tokenEdge[i] = (this.tokenEdge[i]! + 1) % HUB_COUNT;
      }
      const e = this.tokenEdge[i]!;
      const f = e * 3;
      const t = ((e + 3) % HUB_COUNT) * 3;
      const tt = this.tokenT[i]!;
      this.vec.set(
        lerp(this.coreCurrentPositions[f + 0]!, this.coreCurrentPositions[t + 0]!, tt),
        lerp(this.coreCurrentPositions[f + 1]!, this.coreCurrentPositions[t + 1]!, tt),
        lerp(this.coreCurrentPositions[f + 2]!, this.coreCurrentPositions[t + 2]!, tt)
      );
      this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);
      const behind = this.vec.z > 1;
      const depthFade = 1 - smoothstep(0.6, 1.0, this.vec.z);
      const endFade = smoothstep(0, 0.12, tt) * (1 - smoothstep(0.88, 1, tt));
      const out = this.tokenScreens[i]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;
      out.opacity = behind ? 0 : tokenAppear * depthFade * endFade * overallOpacity;
    }
  }

  render(): void {
    this.composer.render();
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  destroy(): void {
    this.coreParticles.geometry.dispose();
    (this.coreParticles.material as THREE.Material).dispose();
    this.shells.forEach(line => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.shockwaveRings.forEach(ring => {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    });
    this.hudGrid.geometry.dispose();
    (this.hudGrid.material as THREE.Material).dispose();
    this.scanningLine.geometry.dispose();
    (this.scanningLine.material as THREE.Material).dispose();
    this.connectionsGeom.dispose();
    (this.connectionsLine.material as THREE.Material).dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
