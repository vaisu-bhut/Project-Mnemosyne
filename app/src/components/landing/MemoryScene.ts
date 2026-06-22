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

/**
 * The Mnemosyne memory graph as a scroll-driven 3D scene.
 *
 * Driven by a single `progress` value in [0..1] (the page's scroll fraction).
 * Six acts, each 1/6 of the range:
 *   0.00–0.166  Cold open — quiet particle dust, no graph yet.
 *   0.166–0.333 Ingestion — nodes stream in from the right, pile into a cluster.
 *   0.333–0.500 Graph forms — nodes snap to graph positions, edges draw in,
 *                signal pulses begin firing along the edges.
 *   0.500–0.666 Signature — camera locks on one focused node (ochre highlight).
 *   0.666–0.833 Interrupts — a cluster of edges pulses orange-red (stale loop).
 *   0.833–1.000 Thesis — camera pulls way out, whole graph drifts, dust returns.
 *
 * Elements: ~160 instanced node spheres, ~260 edges, ~700 dust particles, and
 * ~48 signal pulses that travel node→node (memory "firing"). Post-processing:
 * render → bloom → film-grain + vignette.
 */

const NODE_COUNT = 160;
const HUB_COUNT = 10;
const EDGE_COUNT = 260;
const DUST_COUNT = 700;
const SIGNAL_COUNT = 48;
const TOKEN_COUNT = 12; // labeled "meaning" tokens that travel the edges (HTML overlay)

const COLOR_INDIGO = new THREE.Color(0x4a3aa8);
const COLOR_OCHRE = new THREE.Color(0xd9a653);
const COLOR_LILAC = new THREE.Color(0x8b7fc7);
const COLOR_ALERT = new THREE.Color(0xc2492f);
const COLOR_DUST = new THREE.Color(0x9b8fc0);
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

interface NodeAnchors {
  ingest: THREE.Vector3;
  cluster: THREE.Vector3;
  graph: THREE.Vector3;
}

export class MemoryScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private world!: THREE.Group; // graph contents — shifted right so text gets a clean column
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private grainPass!: ShaderPass;
  private timer = new FrameTimer();

  private nodes!: THREE.InstancedMesh;
  private nodeAnchors: NodeAnchors[] = [];
  private nodeBaseColor: THREE.Color[] = [];
  private nodeCurrent = new Float32Array(NODE_COUNT * 3); // live positions, reused by edges + signals

  // Sub-nodes orbiting around hubs to represent details/facts visually
  private subNodes!: THREE.InstancedMesh;
  private subNodeOffset = new Float32Array(30 * 3); // phase, radius, speed
  private subNodeParent = new Int16Array(30);       // parent hub node index

  private edges!: THREE.LineSegments;
  private edgeFrom = new Int16Array(EDGE_COUNT);
  private edgeTo = new Int16Array(EDGE_COUNT);
  private edgePositions!: Float32Array;
  private edgeColors!: Float32Array;
  private alertEdges = new Set<number>();

  private dust!: THREE.Points;
  private signals!: THREE.Points;
  private signalPositions!: Float32Array;
  private signalEdge = new Int16Array(SIGNAL_COUNT);
  private signalT = new Float32Array(SIGNAL_COUNT);
  private signalSpeed = new Float32Array(SIGNAL_COUNT);

  private matrix = new THREE.Matrix4();
  private vec = new THREE.Vector3();
  private color = new THREE.Color();
  private focusNodeIndex = 14; // "Sara Lin" — the highlighted node in the trace act

  // New interactive properties
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2(-999, -999);
  private cameraOffset = new THREE.Vector3(0, 0, 0);
  private targetCameraOffset = new THREE.Vector3(0, 0, 0);
  public hoveredNodeIdx: number | null = null;
  private lastScrollY = 0;
  private scrollSpeed = 0;

  /**
   * Curated labels — the "live data" overlay. Each maps a node index to a name
   * or category. Person nodes get names; a few hubs are category clusters; one
   * is "You". The React layer reads `labelScreens` each frame to position chips.
   */
  readonly labels: { idx: number; text: string; detail?: string; kind: "self" | "person" | "category" | "episode" | "fact" | "source" }[] = [
    { idx: 0, text: "You", detail: "Active Brain Context", kind: "self" },
    { idx: 1, text: "Work", detail: "Category · 48 episodes", kind: "category" },
    { idx: 2, text: "Friends", detail: "Category · 12 contacts", kind: "category" },
    { idx: 3, text: "Family", detail: "Category · 5 contacts", kind: "category" },
    { idx: 5, text: "Project Aurora", detail: "Topic · 3 active loops", kind: "category" },
    { idx: 8, text: "Personal AI", detail: "Topic · 15 references", kind: "category" },
    
    // People
    { idx: 14, text: "Sara Lin", detail: "Contact · Realtor · 2× reinforced", kind: "person" },
    { idx: 27, text: "Priya Shah", detail: "Contact · Product Manager", kind: "person" },
    { idx: 41, text: "Marcus Reyes", detail: "Contact · Lead Designer", kind: "person" },
    { idx: 58, text: "Jane Okafor", detail: "Contact · Attorney", kind: "person" },
    { idx: 73, text: "Raju Mehta", detail: "Contact · Software Lead", kind: "person" },
    { idx: 96, text: "Mom", detail: "Contact · Family Loop", kind: "person" },
    { idx: 121, text: "Dr. Alvarez", detail: "Contact · Cardiologist", kind: "person" },
    { idx: 15, text: "David Cho", detail: "Contact · Co-author", kind: "person" },
    { idx: 33, text: "Elena Rostova", detail: "Contact · Operations", kind: "person" },
    { idx: 48, text: "Tom Miller", detail: "Contact · Architect", kind: "person" },
    { idx: 62, text: "Amina Diop", detail: "Contact · Consultant", kind: "person" },
    { idx: 85, text: "Kofi Mensah", detail: "Contact · Investor", kind: "person" },
    
    // Sources / Connections
    { idx: 4, text: "Gmail Inbox", detail: "Connected · 1.2k emails", kind: "source" },
    { idx: 9, text: "GCal Sync", detail: "Connected · 85 meetings", kind: "source" },
    { idx: 12, text: "Outlook Mail", detail: "Linked · 420 items", kind: "source" },
    { idx: 20, text: "Local Notes", detail: "Syncing · 31 markdown files", kind: "source" },
    
    // Episodes (events/meetings/conversations)
    { idx: 30, text: "Sync on Aurora", detail: "Meeting · 5 attendees · 12:15 PM", kind: "episode" },
    { idx: 45, text: "Dinner with Priya", detail: "Dinner · Aug 12 · 7:30 PM", kind: "episode" },
    { idx: 52, text: "Coffee w/ Marcus", detail: "Coffee · Aug 8 · 10:00 AM", kind: "episode" },
    { idx: 70, text: "Call w/ Elena", detail: "Call · Aug 14 · 11:30 AM", kind: "episode" },
    { idx: 88, text: "Weekly Review", detail: "Workspace Sync · Mondays", kind: "episode" },
    { idx: 104, text: "Design Handoff", detail: "Review · Wednesday", kind: "episode" },
    { idx: 115, text: "Gmail: Aurora Contract", detail: "Email ingestion · 2d ago", kind: "episode" },
    { idx: 130, text: "Cal: Dentist appt", detail: "Calendar Event · Aug 22", kind: "episode" },
    { idx: 142, text: "Drafting Memo", detail: "Local note ingestion · 1d ago", kind: "episode" },

    // Facts / Commitments / Conflicts
    { idx: 22, text: "Aurora Due Wed", detail: "Commitment · confidence 0.88", kind: "fact" },
    { idx: 36, text: "Marcus = Realtor", detail: "Extracted fact · 5d ago", kind: "fact" },
    { idx: 50, text: "Sara's new phone", detail: "Updated contact attribute", kind: "fact" },
    { idx: 66, text: "Flight UA 244", detail: "Travel confirmation · Aug 24", kind: "fact" },
    { idx: 78, text: "Priya's new job", detail: "Extracted Fact · PM at Google", kind: "fact" },
    { idx: 90, text: "Owe Jane reply", detail: "Open loop · 3d overdue", kind: "fact" },
    { idx: 110, text: "Elena in Berlin", detail: "Extracted fact · Location", kind: "fact" },
    { idx: 125, text: "Rent due July 1", detail: "Commitment · Monthly loop", kind: "fact" },
    { idx: 138, text: "Aurora budget: $50k", detail: "Extracted Fact · Financial", kind: "fact" },
    { idx: 150, text: "Call Dr. A on Fri", detail: "Commitment · Pending call", kind: "fact" },
  ];
  /** Per-label screen position + opacity, recomputed each frame in update(). */
  labelScreens: { x: number; y: number; opacity: number }[] = [];

  // Mid-edge labels for actual data relationships
  readonly edgeLabels: { edgeIdx: number; text: string; kind: "email" | "meeting" | "system" | "conflict" }[] = [
    { edgeIdx: 12, text: "emailed", kind: "email" },
    { edgeIdx: 24, text: "met w/", kind: "meeting" },
    { edgeIdx: 35, text: "co-occurred", kind: "system" },
    { edgeIdx: 48, text: "owes draft", kind: "conflict" },
    { edgeIdx: 60, text: "calls", kind: "email" },
    { edgeIdx: 72, text: "referenced in", kind: "system" },
    { edgeIdx: 85, text: "collaborated", kind: "system" },
    { edgeIdx: 98, text: "contradicts", kind: "conflict" },
    { edgeIdx: 110, text: "shared file", kind: "system" },
    { edgeIdx: 125, text: "mentioned in", kind: "email" },
    { edgeIdx: 140, text: "assigned", kind: "system" },
    { edgeIdx: 155, text: "scheduled", kind: "meeting" },
    { edgeIdx: 172, text: "follows", kind: "system" },
    { edgeIdx: 190, text: "discussed", kind: "meeting" },
    { edgeIdx: 210, text: "works with", kind: "system" },
  ];
  edgeLabelScreens: { x: number; y: number; opacity: number }[] = [];

  // Meaning-tokens: small chips that travel along edges carrying real content
  // (an episode, a fact, a briefing…). The React layer renders the chips; here
  // we just animate their position along edges and project to screen.
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
      this.tokenEdge[i] = i; // spread across the first edges initially
      this.tokenT[i] = rand();
      this.tokenSpeed[i] = 0.05 + rand() * 0.07; // slow enough to read
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
    this.scene.fog = new THREE.Fog(COLOR_BG, 12, 40);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 120);
    this.camera.position.set(0, 0, 16);

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2, 4, 5);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xc6b69a, 0.7));

    // Graph contents live in a group we shift right (so the left text column
    // stays clean) and rotate in place.
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.buildNodes();
    this.buildEdges();
    this.buildDust();
    this.buildSignals();
    this.buildComposer(w, h, dpr);
  }

  private buildNodes(): void {
    const geom = new THREE.SphereGeometry(0.12, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: false,
      emissiveIntensity: 0.6,
      metalness: 0.15,
      roughness: 0.5,
      transparent: true,
    });
    this.nodes = new THREE.InstancedMesh(geom, mat, NODE_COUNT);
    this.world.add(this.nodes);

    const rand = mulberry32(7);
    for (let i = 0; i < NODE_COUNT; i++) {
      const ingest = new THREE.Vector3(20 + rand() * 10, (rand() - 0.5) * 12, (rand() - 0.5) * 5);
      const cluster = new THREE.Vector3((rand() - 0.5) * 7, (rand() - 0.5) * 7, (rand() - 0.5) * 7);

      const isHub = i < HUB_COUNT;
      const radius = isHub ? 1.0 + rand() * 0.9 : 3.0 + rand() * 4.0;
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      const graph = new THREE.Vector3(
        radius * Math.sin(v) * Math.cos(u),
        radius * Math.sin(v) * Math.sin(u),
        radius * Math.cos(v),
      );
      this.nodeAnchors.push({ ingest, cluster, graph });

      // Color variety: hubs + ~12% are ochre, ~20% lilac, rest indigo.
      const roll = rand();
      let base: THREE.Color;
      if (isHub || roll > 0.88) base = COLOR_OCHRE.clone();
      else if (roll > 0.68) base = COLOR_LILAC.clone();
      else base = COLOR_INDIGO.clone();
      this.nodeBaseColor.push(base);

      this.matrix.makeTranslation(ingest.x, ingest.y, ingest.z);
      this.nodes.setMatrixAt(i, this.matrix);
      this.nodes.setColorAt(i, base);
    }
    this.nodes.instanceMatrix.needsUpdate = true;
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;

    // Build orbiting sub-nodes (30 tiny details orbiting around the 10 hubs)
    const subGeom = new THREE.SphereGeometry(0.045, 8, 8);
    const subMat = new THREE.MeshStandardMaterial({
      color: COLOR_LILAC,
      metalness: 0.1,
      roughness: 0.8,
      transparent: true,
      opacity: 0.6,
    });
    this.subNodes = new THREE.InstancedMesh(subGeom, subMat, 30);
    this.world.add(this.subNodes);

    const subRand = mulberry32(42);
    for (let i = 0; i < 30; i++) {
      this.subNodeParent[i] = i % HUB_COUNT;
      this.subNodeOffset[i * 3 + 0] = subRand() * Math.PI * 2; // phase angle
      this.subNodeOffset[i * 3 + 1] = 0.35 + subRand() * 0.45; // radius
      this.subNodeOffset[i * 3 + 2] = 0.5 + subRand() * 1.5;   // speed factor
    }
  }

  private buildEdges(): void {
    const rand = mulberry32(11);
    for (let i = 0; i < EDGE_COUNT; i++) {
      const from = Math.floor(rand() * HUB_COUNT);
      let to = Math.floor(HUB_COUNT + rand() * (NODE_COUNT - HUB_COUNT));
      if (to === from) to = (to + 1) % NODE_COUNT;
      this.edgeFrom[i] = from;
      this.edgeTo[i] = to;
    }
    // A small cluster of edges around the focus node = the "stale loop" alert.
    for (let i = 0; i < EDGE_COUNT; i++) {
      if (this.edgeFrom[i] === this.focusNodeIndex || this.edgeTo[i] === this.focusNodeIndex) {
        this.alertEdges.add(i);
      }
    }
    if (this.alertEdges.size === 0) this.alertEdges.add(0);

    this.edgePositions = new Float32Array(EDGE_COUNT * 6);
    this.edgeColors = new Float32Array(EDGE_COUNT * 6);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.edgePositions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(this.edgeColors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 });
    this.edges = new THREE.LineSegments(geom, mat);
    this.world.add(this.edges);
  }

  private buildDust(): void {
    const rand = mulberry32(23);
    const pos = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      const r = 6 + rand() * 22;
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      pos[i * 3 + 0] = r * Math.sin(v) * Math.cos(u);
      pos[i * 3 + 1] = r * Math.sin(v) * Math.sin(u);
      pos[i * 3 + 2] = r * Math.cos(v);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: COLOR_DUST,
      size: 0.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.dust = new THREE.Points(geom, mat);
    this.world.add(this.dust);
  }

  private buildSignals(): void {
    const rand = mulberry32(31);
    this.signalPositions = new Float32Array(SIGNAL_COUNT * 3);
    const colors = new Float32Array(SIGNAL_COUNT * 3);
    for (let i = 0; i < SIGNAL_COUNT; i++) {
      this.signalEdge[i] = Math.floor(rand() * EDGE_COUNT);
      this.signalT[i] = rand();
      this.signalSpeed[i] = 0.25 + rand() * 0.55;
      const c = rand() > 0.5 ? COLOR_OCHRE : COLOR_INDIGO;
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.signalPositions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.signals = new THREE.Points(geom, mat);
    this.world.add(this.signals);
  }

  private buildComposer(w: number, h: number, dpr: number): void {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.6, 0.2);
    this.composer.addPass(this.bloomPass);

    this.grainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uGrain: { value: 0.04 },
        uVignette: { value: 0.9 },
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

    // Scroll speed for chromatic aberration
    const currentScrollY = progress * (typeof document !== "undefined" ? document.documentElement.scrollHeight - window.innerHeight : 1000);
    const scrollDelta = Math.abs(currentScrollY - this.lastScrollY);
    this.lastScrollY = currentScrollY;
    this.scrollSpeed = lerp(this.scrollSpeed, scrollDelta * 0.005, 0.1);
    const aberrationAmount = Math.max(0.0, Math.min(0.015, this.scrollSpeed));
    this.grainPass.uniforms.uAberration.value = 0.0002 + aberrationAmount;

    // ── Mouse Parallax offset ──────────────────────────────────────────
    if (this.mouse.x > -900) {
      this.targetCameraOffset.set(this.mouse.x * 1.6, this.mouse.y * 1.6, 0);
    } else {
      this.targetCameraOffset.set(0, 0, 0);
    }
    this.cameraOffset.lerp(this.targetCameraOffset, 0.05);

    // ── Camera path (mostly dolly; horizontal placement is done by shifting
    //    the world group right, so the left text column stays clean). ────────
    const cam: [number, number, number][] = [
      [0, 0, 17],
      [0, 1.2, 12],
      [0, 2.2, 10],
      [0.6, 1, 7.2],
      [0, 1, 9],
      [0, 0, 25],
    ];
    const segs = cam.length - 1;
    const s = Math.min(progress * segs, segs - 0.0001);
    const idx = Math.floor(s);
    const eased = smoothstep(0, 1, s - idx);
    const a = cam[idx]!;
    const b = cam[idx + 1]!;
    const floatX = Math.sin(el * 0.25) * 0.2;
    const floatY = Math.cos(el * 0.2) * 0.18;
    this.camera.position.set(
      lerp(a[0], b[0], eased) + floatX + this.cameraOffset.x,
      lerp(a[1], b[1], eased) + floatY + this.cameraOffset.y,
      lerp(a[2], b[2], eased),
    );
    this.camera.lookAt(0, 0, 0);

    // World group: shift right (desktop) so text owns the left; rotate in place.
    // On narrow viewports keep it centered (text overlays with a stronger scrim).
    const vw = this.canvas.clientWidth || window.innerWidth;
    const wide = vw >= 900;
    const baseOffset = wide ? 3.6 : 0;
    const offset =
      baseOffset *
      smoothstep(0.1, 0.3, progress) *
      (1 - smoothstep(0.86, 1.0, progress) * 0.8); // recenter in the thesis act
    this.world.position.x = offset;
    this.world.rotation.y = progress * Math.PI * 0.8;
    this.dust.rotation.y = -progress * Math.PI * 0.3 + el * 0.01;

    const overall =
      smoothstep(0.04, 0.16, progress) * (1 - smoothstep(0.93, 1.0, progress) * 0.4);

    // ── Raycasting for Node Hover ──────────────────────────────────────
    if (this.mouse.x > -900 && overall > 0.1) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.nodes);
      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        this.hoveredNodeIdx = intersects[0].instanceId;
      } else {
        this.hoveredNodeIdx = null;
      }
    } else {
      this.hoveredNodeIdx = null;
    }

    // ── Node transitions ───────────────────────────────────────────────
    const act2 = actProgress(progress, 0.166, 0.333);
    const act3 = actProgress(progress, 0.333, 0.5);
    const focusBlend = smoothstep(0.5, 0.62, progress) - smoothstep(0.78, 0.92, progress);

    (this.nodes.material as THREE.MeshStandardMaterial).opacity = overall;

    for (let i = 0; i < NODE_COUNT; i++) {
      const an = this.nodeAnchors[i]!;
      const stagger = i / NODE_COUNT;
      const t2 = smoothstep(0, 1, Math.max(0, Math.min(1, (act2 - stagger * 0.5) / 0.5)));
      const t3 = smoothstep(0, 1, act3);
      this.vec.copy(an.ingest).lerp(an.cluster, t2).lerp(an.graph, t3);

      const drift = 0.025 * (1 - act3);
      this.vec.x += Math.sin(el * 0.4 + i) * drift;
      this.vec.y += Math.cos(el * 0.35 + i * 1.3) * drift;

      this.nodeCurrent[i * 3 + 0] = this.vec.x;
      this.nodeCurrent[i * 3 + 1] = this.vec.y;
      this.nodeCurrent[i * 3 + 2] = this.vec.z;

      const isFocus = i === this.focusNodeIndex;
      const isHovered = i === this.hoveredNodeIdx;
      // Gentle twinkle on every node; the focus node swells in Act 4, hovered node swells on hover.
      const twinkle = 1 + Math.sin(el * 1.5 + i * 2.1) * 0.06;
      let scale = (isFocus ? 1 + focusBlend * 1.3 : 1) * twinkle;
      if (isHovered) {
        scale *= 1.8;
      }
      this.matrix.makeScale(scale, scale, scale);
      this.matrix.setPosition(this.vec);
      this.nodes.setMatrixAt(i, this.matrix);

      // Instanced emissive / glow variety via color scaling (>1.0 color values bloom)
      let glowMultiplier = isHovered ? 4.0 : 1.0;
      if (isFocus) {
        this.color.copy(this.nodeBaseColor[i]!).lerp(COLOR_OCHRE, focusBlend);
        glowMultiplier += focusBlend * 1.5;
      } else {
        this.color.copy(this.nodeBaseColor[i]!);
      }
      this.color.multiplyScalar(glowMultiplier);
      this.nodes.setColorAt(i, this.color);
    }
    this.nodes.instanceMatrix.needsUpdate = true;
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;

    // ── Sub-nodes Orbiting Animation ──────────────────────────────────
    (this.subNodes.material as THREE.MeshStandardMaterial).opacity = overall * 0.75;
    for (let i = 0; i < 30; i++) {
      const pIdx = this.subNodeParent[i]!;
      const px = this.nodeCurrent[pIdx * 3 + 0]!;
      const py = this.nodeCurrent[pIdx * 3 + 1]!;
      const pz = this.nodeCurrent[pIdx * 3 + 2]!;

      const phase = this.subNodeOffset[i * 3 + 0]!;
      const radius = this.subNodeOffset[i * 3 + 1]!;
      const speed = this.subNodeOffset[i * 3 + 2]!;

      const angle = phase + el * speed;
      // Orbit in a tilted plane
      this.vec.set(
        px + Math.cos(angle) * radius,
        py + Math.sin(angle) * radius,
        pz + Math.sin(angle * 0.5) * radius * 0.5
      );

      // Subnode visual multiplier
      const isHovered = pIdx === this.hoveredNodeIdx;
      const subScale = isHovered ? 1.5 : 1.0;
      this.matrix.makeScale(subScale, subScale, subScale);
      this.matrix.setPosition(this.vec);
      this.subNodes.setMatrixAt(i, this.matrix);
    }
    this.subNodes.instanceMatrix.needsUpdate = true;

    // ── Edges ──────────────────────────────────────────────────────────
    const edgeAppear = actProgress(progress, 0.36, 0.56);
    const visibleEdges = Math.floor(EDGE_COUNT * edgeAppear);
    const pulseBlend = smoothstep(0.66, 0.74, progress) - smoothstep(0.86, 0.95, progress);
    const pulseT = pulseBlend * (0.5 + 0.5 * Math.sin(el * 5.0));
    (this.edges.material as THREE.LineBasicMaterial).opacity = 0.5 * overall;

    for (let e = 0; e < EDGE_COUNT; e++) {
      const f = this.edgeFrom[e]!;
      const t = this.edgeTo[e]!;
      const base = e * 6;
      const visible = e < visibleEdges;
      if (visible) {
        this.edgePositions[base + 0] = this.nodeCurrent[f * 3 + 0]!;
        this.edgePositions[base + 1] = this.nodeCurrent[f * 3 + 1]!;
        this.edgePositions[base + 2] = this.nodeCurrent[f * 3 + 2]!;
        this.edgePositions[base + 3] = this.nodeCurrent[t * 3 + 0]!;
        this.edgePositions[base + 4] = this.nodeCurrent[t * 3 + 1]!;
        this.edgePositions[base + 5] = this.nodeCurrent[t * 3 + 2]!;
      } else {
        for (let k = 0; k < 6; k++) this.edgePositions[base + k] = 0;
      }

      // If connected to hovered node, make the edge glow amber
      const isHoverEdge = this.hoveredNodeIdx !== null && (f === this.hoveredNodeIdx || t === this.hoveredNodeIdx);
      if (isHoverEdge) {
        this.color.copy(COLOR_OCHRE).multiplyScalar(2.5);
      } else if (this.alertEdges.has(e)) {
        this.color.copy(COLOR_INDIGO).lerp(COLOR_ALERT, pulseT);
      } else {
        this.color.copy(COLOR_INDIGO).multiplyScalar(0.45);
      }
      for (let k = 0; k < 2; k++) {
        this.edgeColors[base + k * 3 + 0] = this.color.r;
        this.edgeColors[base + k * 3 + 1] = this.color.g;
        this.edgeColors[base + k * 3 + 2] = this.color.b;
      }
    }
    (this.edges.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.edges.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // ── Signal pulses (memory firing along edges) ──────────────────────
    const signalsOn = smoothstep(0.4, 0.55, progress) * overall;
    (this.signals.material as THREE.PointsMaterial).opacity = signalsOn * 0.95;
    for (let i = 0; i < SIGNAL_COUNT; i++) {
      let speedMult = 1.0;
      const e = Math.min(this.signalEdge[i]!, EDGE_COUNT - 1);
      const f = this.edgeFrom[e]!;
      const t = this.edgeTo[e]!;

      // Speed up pulses passing through hovered nodes to make it look active
      if (this.hoveredNodeIdx !== null && (f === this.hoveredNodeIdx || t === this.hoveredNodeIdx)) {
        speedMult = 2.5;
      }

      this.signalT[i]! += this.signalSpeed[i]! * dt * speedMult;
      if (this.signalT[i]! > 1) {
        this.signalT[i]! -= 1;
        this.signalEdge[i] = Math.floor((el * 13 + i * 7) % Math.max(1, visibleEdges));
      }
      
      const tt = this.signalT[i]!;
      this.signalPositions[i * 3 + 0] = lerp(this.nodeCurrent[f * 3 + 0]!, this.nodeCurrent[t * 3 + 0]!, tt);
      this.signalPositions[i * 3 + 1] = lerp(this.nodeCurrent[f * 3 + 1]!, this.nodeCurrent[t * 3 + 1]!, tt);
      this.signalPositions[i * 3 + 2] = lerp(this.nodeCurrent[f * 3 + 2]!, this.nodeCurrent[t * 3 + 2]!, tt);
    }
    (this.signals.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // ── Dust + bloom ───────────────────────────────────────────────────
    (this.dust.material as THREE.PointsMaterial).opacity = 0.18 + 0.22 * (1 - act3);
    
    // Add extra bloom strength if hovering to make the glows pop
    const hoverBloomBoost = this.hoveredNodeIdx !== null ? 0.35 : 0;
    this.bloomPass.strength = 0.45 + 0.5 * overall + pulseBlend * 0.5 + hoverBloomBoost;

    // ── Project label positions to screen for the HTML overlay. ─────────
    this.world.updateMatrixWorld(true);
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const labelAppear = smoothstep(0.34, 0.46, progress) * (1 - smoothstep(0.84, 0.95, progress));
    for (let k = 0; k < this.labels.length; k++) {
      const idx = this.labels[k]!.idx;
      this.vec.set(
        this.nodeCurrent[idx * 3 + 0]!,
        this.nodeCurrent[idx * 3 + 1]!,
        this.nodeCurrent[idx * 3 + 2]!,
      );
      this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);
      const behind = this.vec.z > 1;
      const depthFade = 1 - smoothstep(0.55, 1.0, this.vec.z);
      const out = this.labelScreens[k]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;
      
      // If this specific node is hovered, force full opacity so it's readable
      const isThisNodeHovered = this.hoveredNodeIdx !== null && idx === this.hoveredNodeIdx;
      out.opacity = behind ? 0 : (isThisNodeHovered ? 1.0 : labelAppear * depthFade * overall);
    }

    // ── Mid-Edge Labels ────────────────────────────────────────────────
    const edgeLabelAppear = smoothstep(0.42, 0.54, progress) * (1 - smoothstep(0.82, 0.95, progress));
    for (let k = 0; k < this.edgeLabels.length; k++) {
      const eIdx = this.edgeLabels[k]!.edgeIdx;
      if (eIdx < visibleEdges) {
        const f = this.edgeFrom[eIdx]!;
        const t = this.edgeTo[eIdx]!;
        const mx = (this.nodeCurrent[f * 3 + 0]! + this.nodeCurrent[t * 3 + 0]!) * 0.5;
        const my = (this.nodeCurrent[f * 3 + 1]! + this.nodeCurrent[t * 3 + 1]!) * 0.5;
        const mz = (this.nodeCurrent[f * 3 + 2]! + this.nodeCurrent[t * 3 + 2]!) * 0.5;
        this.vec.set(mx, my, mz);
        this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);

        const behind = this.vec.z > 1;
        const depthFade = 1 - smoothstep(0.55, 1.0, this.vec.z);
        const out = this.edgeLabelScreens[k]!;
        out.x = (this.vec.x * 0.5 + 0.5) * cw;
        out.y = (-this.vec.y * 0.5 + 0.5) * ch;
        out.opacity = behind ? 0 : edgeLabelAppear * depthFade * overall;
      } else {
        this.edgeLabelScreens[k]!.opacity = 0;
      }
    }

    // ── Meaning-tokens: travel along edges + project to screen. ─────────
    const tokenAppear =
      smoothstep(0.34, 0.48, progress) * (1 - smoothstep(0.84, 0.95, progress));
    for (let i = 0; i < TOKEN_COUNT; i++) {
      this.tokenT[i]! += this.tokenSpeed[i]! * dt;
      if (this.tokenT[i]! > 1) {
        this.tokenT[i]! -= 1;
        // Roam to a fresh visible edge so tokens traverse the whole graph.
        this.tokenEdge[i] = Math.floor((el * 7 + i * 53) % Math.max(1, visibleEdges));
      }
      const e = Math.min(this.tokenEdge[i]!, EDGE_COUNT - 1);
      const f = this.edgeFrom[e]!;
      const t = this.edgeTo[e]!;
      const tt = this.tokenT[i]!;
      this.vec.set(
        lerp(this.nodeCurrent[f * 3 + 0]!, this.nodeCurrent[t * 3 + 0]!, tt),
        lerp(this.nodeCurrent[f * 3 + 1]!, this.nodeCurrent[t * 3 + 1]!, tt),
        lerp(this.nodeCurrent[f * 3 + 2]!, this.nodeCurrent[t * 3 + 2]!, tt),
      );
      this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);
      const behind = this.vec.z > 1;
      const depthFade = 1 - smoothstep(0.6, 1.0, this.vec.z);
      // Fade near the ends of an edge so tokens "arrive" and "depart" softly.
      const endFade = smoothstep(0, 0.12, tt) * (1 - smoothstep(0.88, 1, tt));
      const out = this.tokenScreens[i]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;
      out.opacity = behind ? 0 : tokenAppear * depthFade * endFade * overall;
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
    this.nodes.geometry.dispose();
    (this.nodes.material as THREE.Material).dispose();
    this.subNodes.geometry.dispose();
    (this.subNodes.material as THREE.Material).dispose();
    this.edges.geometry.dispose();
    (this.edges.material as THREE.Material).dispose();
    this.dust.geometry.dispose();
    (this.dust.material as THREE.Material).dispose();
    this.signals.geometry.dispose();
    (this.signals.material as THREE.Material).dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
