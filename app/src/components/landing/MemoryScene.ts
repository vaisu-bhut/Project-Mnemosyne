import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

class FrameTimer {
  private last = 0;
  private elapsed = 0;
  private delta = 0;
  update(): void {
    const now = (typeof performance !== "undefined" ? performance.now() : 0) / 1000;
    if (this.last === 0) this.last = now;
    this.delta = Math.min(0.05, now - this.last);
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

const TOKEN_COUNT = 18;

const COLOR_INDIGO = new THREE.Color(0x4a3aa8);
const COLOR_OCHRE = new THREE.Color(0xd9a653);
const COLOR_LILAC = new THREE.Color(0x8b7fc7);
const COLOR_BG = new THREE.Color("#efe8d5");

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface TokenData {
  edgeIdx: number;
  progress: number;
  speed: number;
}

interface Keyframe {
  cam: THREE.Vector3;
  look: THREE.Vector3;
}

// Logical semantic connections between neural nodes
const edgePairs: [number, number][] = [
  // You to Categories
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  // You to Sources
  [0, 13], [0, 14], [0, 15],
  // Work to People
  [1, 6], [1, 7], [1, 8], [1, 10],
  // Friends to People
  [2, 7], [2, 9], [2, 11],
  // Family to People
  [3, 11], [3, 12],
  // Project Aurora connections
  [4, 6], [4, 16], [4, 22], [4, 10],
  // Personal AI
  [5, 15], [5, 19], [5, 0],
  // Episodes to People / Categories
  [16, 6], [16, 7],
  [17, 7],
  [18, 8],
  [19, 9],
  [20, 1],
  [21, 8],
  // Facts to People
  [22, 6],
  [23, 8],
  [24, 6],
  [25, 0],
  [26, 7],
  [27, 9],
  // Cross-links for density
  [6, 8], [7, 10], [8, 9], [9, 11], [10, 12],
  [1, 4], [2, 3], [13, 1], [14, 4],
  // Filler node connections (indices 28-47)
  [28, 0], [28, 1], [29, 2], [29, 7],
  [30, 1], [30, 6], [31, 3], [31, 11],
  [32, 4], [32, 22], [33, 5], [33, 15],
  [34, 0], [34, 13], [35, 1], [35, 8],
  [36, 2], [36, 9], [37, 3], [37, 12],
  [38, 4], [38, 16], [39, 5], [39, 19],
  [40, 6], [40, 7], [41, 8], [41, 10],
  [42, 9], [42, 11], [43, 12], [43, 0],
  [44, 13], [44, 14], [45, 15], [45, 1],
  [46, 16], [46, 17], [47, 18], [47, 20],
  [28, 30], [29, 31], [32, 33], [34, 35],
  [36, 37], [38, 39], [40, 41], [42, 43],
  [44, 45], [46, 47], [28, 34], [30, 35],
  [29, 36], [31, 37], [32, 38], [33, 39],
];

// Orchestrated camera sweep keyframes for Acts 1-6
const keyframes: Keyframe[] = [
  { cam: new THREE.Vector3(0, 1.8, 8.2), look: new THREE.Vector3(0, 0.3, 0) },     // Act 1: Overview (zoomed in)
  { cam: new THREE.Vector3(2.8, -1.0, 5.0), look: new THREE.Vector3(0, -1.5, 0) },  // Act 2: Sources
  { cam: new THREE.Vector3(-4.8, 1.8, 6.0), look: new THREE.Vector3(0, 0.4, 0) },   // Act 3: Graph (closer)
  { cam: new THREE.Vector3(4.2, 1.2, 1.6), look: new THREE.Vector3(2.5, 0.8, -1.2) }, // Act 4: Cites (focus Sara Lin)
  { cam: new THREE.Vector3(-0.6, 2.6, 3.2), look: new THREE.Vector3(1.8, 1.4, -0.6) }, // Act 5: Interrupts (focus Aurora Commitment)
  { cam: new THREE.Vector3(0, 6.5, 9.5), look: new THREE.Vector3(0, -0.4, 0) }     // Act 6: Outro / Thesis
];


export class MemoryScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private world!: THREE.Group; 
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private grainPass!: ShaderPass;
  private timer = new FrameTimer();

  // Living Elements
  private brainGroup!: THREE.Group;
  private nodeMeshes: THREE.Mesh[] = [];
  private connectionLines!: THREE.LineSegments;
  private radarGrid!: THREE.PolarGridHelper;
  private ring1!: THREE.LineLoop;
  private ring2!: THREE.LineLoop;
  private nodePositions: THREE.Vector3[] = [];
  private tokensData: TokenData[] = [];

  // Interaction
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2(-999, -999);
  private cameraOffset = new THREE.Vector3(0, 0, 0);
  private targetCameraOffset = new THREE.Vector3(0, 0, 0);
  public hoveredNodeIdx: number | null = null;
  private lastScrollY = 0;
  private scrollSpeed = 0;
  private vec = new THREE.Vector3();

  // Drag-to-Rotate Variables
  private isDragging = false;
  private previousMousePosition = { x: 0, y: 0 };
  private userRotationY = 0;
  private userRotationX = 0;
  private targetUserRotationY = 0;
  private targetUserRotationX = 0;

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

    // Filler nodes for density (indices 28-47)
    { idx: 200, text: "Team Standup", detail: "Recurring · Daily", kind: "episode" },
    { idx: 201, text: "Book Club", detail: "Category · 4 members", kind: "category" },
    { idx: 202, text: "Sprint Planning", detail: "Meeting · Biweekly", kind: "episode" },
    { idx: 203, text: "Dad", detail: "Contact · Family", kind: "person" },
    { idx: 204, text: "Patent Filing", detail: "Topic · In review", kind: "fact" },
    { idx: 205, text: "Notion Sync", detail: "Source · 42 pages", kind: "source" },
    { idx: 206, text: "Slack DMs", detail: "Source · 320 threads", kind: "source" },
    { idx: 207, text: "1:1 w/ Manager", detail: "Meeting · Fridays", kind: "episode" },
    { idx: 208, text: "Lisa Chen", detail: "Contact · Recruiter", kind: "person" },
    { idx: 209, text: "Yoga Class", detail: "Recurring · Mon/Wed", kind: "episode" },
    { idx: 210, text: "Rent Due", detail: "Commitment · Monthly", kind: "fact" },
    { idx: 211, text: "API Docs", detail: "Reference · v2.4", kind: "fact" },
    { idx: 212, text: "Dentist Appt", detail: "Scheduled · Sep 3", kind: "episode" },
    { idx: 213, text: "Side Project", detail: "Topic · 8 commits", kind: "category" },
    { idx: 214, text: "Newsletter", detail: "Source · Weekly", kind: "source" },
    { idx: 215, text: "Tom Park", detail: "Contact · Mentor", kind: "person" },
    { idx: 216, text: "Retro Notes", detail: "Meeting · Q3", kind: "episode" },
    { idx: 217, text: "Lunch Plan", detail: "Commitment · Thu", kind: "fact" },
    { idx: 218, text: "Board Prep", detail: "Topic · 5 slides", kind: "fact" },
    { idx: 219, text: "Gym Session", detail: "Recurring · Tue/Thu", kind: "episode" },
  ];
  labelScreens: { x: number; y: number; opacity: number }[] = [];

  // Mid-edge labels for actual data relationships
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

  // Meaning tokens traveling along neural synapses
  tokenScreens: { x: number; y: number; opacity: number }[] = [];

  // Web Audio Context (hover tick only)
  private audioCtx: AudioContext | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.labelScreens = this.labels.map(() => ({ x: 0, y: 0, opacity: 0 }));
    this.edgeLabelScreens = this.edgeLabels.map(() => ({ x: 0, y: 0, opacity: 0 }));
    this.tokenScreens = Array.from({ length: TOKEN_COUNT }, () => ({ x: 0, y: 0, opacity: 0 }));
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
    this.scene.fog = new THREE.Fog(COLOR_BG, 12, 75);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 150);
    this.camera.position.copy(keyframes[0]!.cam);

    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(5, 12, 8);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xc6b69a, 0.7));

    this.world = new THREE.Group();
    this.scene.add(this.world);

    // Setup Brain/Neural Node Positions
    this.generateNodePositions();

    // Create rotating neural network group
    this.brainGroup = new THREE.Group();
    this.world.add(this.brainGroup);

    this.buildRadarFloor();
    this.buildHUDRings();
    this.buildNeuralNetwork();
    this.buildComposer(w, h, dpr);

    // Initialize flowing synaptic tokens metadata
    for (let i = 0; i < TOKEN_COUNT; i++) {
      this.tokensData.push({
        edgeIdx: Math.floor(Math.random() * edgePairs.length),
        progress: Math.random(),
        speed: 0.22 + Math.random() * 0.25
      });
    }

    // Attach drag-to-rotate event listeners
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);

    this.canvas.addEventListener("touchstart", this.onTouchStart, { passive: true });
    window.addEventListener("touchmove", this.onTouchMove, { passive: false });
    window.addEventListener("touchend", this.onTouchEnd);
  }

  // Mouse Drag Handlers
  private onMouseDown = (e: MouseEvent): void => {
    // Ignore drag if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("input") || target.closest(".trace-card") || target.closest(".nudge-card")) {
      return;
    }
    this.isDragging = true;
    this.previousMousePosition = { x: e.clientX, y: e.clientY };
    if (typeof document !== "undefined") {
      document.body.style.cursor = "grabbing";
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isDragging) return;
    const deltaX = e.clientX - this.previousMousePosition.x;
    const deltaY = e.clientY - this.previousMousePosition.y;
    
    this.targetUserRotationY += deltaX * 0.007;
    this.targetUserRotationX += deltaY * 0.007;
    
    // Clamp X rotation to avoid flipping
    this.targetUserRotationX = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, this.targetUserRotationX));
    
    this.previousMousePosition = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (): void => {
    this.isDragging = false;
    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
  };

  // Touch Handlers
  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 1) {
      const target = e.target as HTMLElement;
      if (target.closest("button") || target.closest("a") || target.closest("input") || target.closest(".trace-card") || target.closest(".nudge-card")) {
        return;
      }
      this.isDragging = true;
      this.previousMousePosition = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (!this.isDragging || e.touches.length !== 1) return;
    const deltaX = e.touches[0]!.clientX - this.previousMousePosition.x;
    const deltaY = e.touches[0]!.clientY - this.previousMousePosition.y;
    
    this.targetUserRotationY += deltaX * 0.009;
    this.targetUserRotationX += deltaY * 0.009;
    this.targetUserRotationX = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, this.targetUserRotationX));
    
    this.previousMousePosition = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
  };

  private onTouchEnd = (): void => {
    this.isDragging = false;
  };

  private generateNodePositions(): void {
    const total = this.labels.length;
    const totalSources = this.labels.filter(l => l.kind === "source").length;
    let sourceCount = 0;

    this.labels.forEach((label, i) => {
      // Create double hemisphere brain layout
      const isLeft = i % 2 === 0;
      const sideSign = isLeft ? 1 : -1;
      
      const phi = Math.acos(-1 + (2 * i) / total);
      const theta = Math.sqrt(total * Math.PI) * phi;
      
      const r = 2.2 + 0.3 * Math.sin(theta * 2.5); // Tighter organic globe
      let x = r * Math.sin(phi) * Math.cos(theta) * sideSign * 0.9;
      let y = r * Math.sin(phi) * Math.sin(theta) * 0.6 + 0.3;
      let z = r * Math.cos(phi) * 0.7;
      
      // Shape adjustments for tighter globe
      if (z > 1.0) { x *= 0.75; y *= 0.85; } 
      if (z < -1.0) { x *= 0.7; y *= 0.8; }

      // Fixed positioning for prominent architectural nodes
      if (label.kind === "self") {
        this.nodePositions.push(new THREE.Vector3(0, 0.4, 0));
      } else if (label.text === "Work") {
        this.nodePositions.push(new THREE.Vector3(1.8, 1.2, -0.6));
      } else if (label.text === "Friends") {
        this.nodePositions.push(new THREE.Vector3(-1.8, 1.0, 0.4));
      } else if (label.text === "Family") {
        this.nodePositions.push(new THREE.Vector3(-1.4, -0.4, -1.4));
      } else if (label.text === "Project Aurora") {
        this.nodePositions.push(new THREE.Vector3(2.0, 0.2, -1.2));
      } else if (label.text === "Personal AI") {
        this.nodePositions.push(new THREE.Vector3(0, 1.6, -0.8));
      } else if (label.kind === "source") {
        const sourceIdx = sourceCount;
        sourceCount++;
        const spacing = 1.1;
        const offset = (sourceIdx - (totalSources - 1) / 2) * spacing;
        this.nodePositions.push(new THREE.Vector3(offset, -2.0, -0.5));
      } else {
        this.nodePositions.push(new THREE.Vector3(x, y, z));
      }
    });
  }

  private buildRadarFloor(): void {
    // 3D Polar Diagnostic Grid Floor
    this.radarGrid = new THREE.PolarGridHelper(24, 16, 8, 64);
    this.radarGrid.position.y = -3.8;
    
    // Style materials with transparent colors
    const material = this.radarGrid.material as THREE.LineBasicMaterial;
    material.color = new THREE.Color(0x9a9590);
    material.transparent = true;
    material.opacity = 0.16;
    material.blending = THREE.AdditiveBlending;

    this.world.add(this.radarGrid);
  }

  private buildHUDRings(): void {
    // Elegant concentric scanner HUD rings orbiting the neural network
    const ringGeom1 = new THREE.BufferGeometry();
    const ringPoints1: THREE.Vector3[] = [];
    const rad1 = 5.2;
    for (let theta = 0; theta <= Math.PI * 2; theta += Math.PI / 40) {
      ringPoints1.push(new THREE.Vector3(Math.cos(theta) * rad1, 0.4, Math.sin(theta) * rad1));
    }
    ringGeom1.setFromPoints(ringPoints1);
    this.ring1 = new THREE.LineLoop(
      ringGeom1,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(0xa09888),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending
      })
    );
    this.world.add(this.ring1);

    const ringGeom2 = new THREE.BufferGeometry();
    const ringPoints2: THREE.Vector3[] = [];
    const rad2 = 6.4;
    for (let theta = 0; theta <= Math.PI * 2; theta += Math.PI / 40) {
      ringPoints2.push(new THREE.Vector3(Math.cos(theta) * rad2, Math.sin(theta) * rad2, 0));
    }
    ringGeom2.setFromPoints(ringPoints2);
    this.ring2 = new THREE.LineLoop(
      ringGeom2,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(0x8a8078),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending
      })
    );
    this.world.add(this.ring2);
  }

  private buildNeuralNetwork(): void {
    const sphereGeom = new THREE.SphereGeometry(0.12, 16, 16);

    // Create 3D Node Meshes — monochrome palette
    const NODE_COLOR = new THREE.Color(0x8a8078); // warm stone
    const SELF_COLOR = new THREE.Color(0xddd8ce); // light cream for center

    this.labels.forEach((label, i) => {
      const pos = this.nodePositions[i]!;
      
      let size = 0.10;
      
      if (label.kind === "self") {
        size = 0.22;
      } else if (label.kind === "category") {
        size = 0.16;
      } else if (label.kind === "source") {
        size = 0.13;
      } else if (label.kind === "episode") {
        size = 0.08;
      } else if (label.kind === "fact") {
        size = 0.06;
      }

      const mat = new THREE.MeshPhysicalMaterial({
        color: label.kind === "self" ? SELF_COLOR : NODE_COLOR,
        transparent: true,
        opacity: 0.92,
        roughness: 0.35,
        metalness: 0.4,
        transmission: 0.3,
        thickness: 0.5,
        ior: 1.4,
        clearcoat: 0.8,
      });

      const mesh = new THREE.Mesh(sphereGeom, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(size / 0.12);
      
      // Decorative HUD brackets around key category nodes
      if (label.kind === "self" || label.kind === "category") {
        const ringGeom = new THREE.RingGeometry(0.3, 0.32, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xa09888),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
        });
        const rMesh = new THREE.Mesh(ringGeom, ringMat);
        rMesh.rotation.x = Math.PI / 2;
        mesh.add(rMesh);
      }

      this.brainGroup.add(mesh);
      this.nodeMeshes.push(mesh);
    });

    // Create 3D Synaptic Connections (Edges)
    const linePositions: number[] = [];
    edgePairs.forEach((pair) => {
      const p1 = this.nodePositions[pair[0]]!;
      const p2 = this.nodePositions[pair[1]]!;
      linePositions.push(p1.x, p1.y, p1.z);
      linePositions.push(p2.x, p2.y, p2.z);
    });

    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    
    this.connectionLines = new THREE.LineSegments(
      lineGeom,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(0x8a8078),
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
      })
    );
    this.brainGroup.add(this.connectionLines);
  }

  private initAudio(): void {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      this.audioCtx = new AudioContextClass();
    } catch (err) {
      console.warn("Web Audio Context could not initialize", err);
    }
  }

  public playHoverTick(): void {
    if (!this.audioCtx) this.initAudio();
    if (!this.audioCtx) return;
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
    
    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(320 + Math.random() * 450, now);
    
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start();
    osc.stop(now + 0.13);
  }

  private buildComposer(w: number, h: number, dpr: number): void {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.75, 0.2);
    this.composer.addPass(this.bloomPass);

    this.grainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uGrain: { value: 0.032 },
        uVignette: { value: 0.85 },
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

  // Linear interpolation through keyframes
  private interpolateKeyframes(progress: number): { cam: THREE.Vector3; look: THREE.Vector3 } {
    const n = keyframes.length - 1;
    const rawVal = progress * n;
    const index = Math.floor(rawVal);
    const fraction = rawVal - index;
    
    if (index >= n) {
      return { cam: keyframes[n]!.cam.clone(), look: keyframes[n]!.look.clone() };
    }
    if (index < 0) {
      return { cam: keyframes[0]!.cam.clone(), look: keyframes[0]!.look.clone() };
    }
    
    const k1 = keyframes[index]!;
    const k2 = keyframes[index + 1]!;
    
    const cam = new THREE.Vector3().lerpVectors(k1.cam, k2.cam, fraction);
    const look = new THREE.Vector3().lerpVectors(k1.look, k2.look, fraction);
    return { cam, look };
  }

  update(progress: number): void {
    this.timer.update();
    const dt = this.timer.getDelta();
    const el = this.timer.getElapsed();
    this.grainPass.uniforms.uTime.value = el;

    // Scroll Speed calculation for chromatic aberration pulses
    const currentScrollY = progress * (typeof document !== "undefined" ? document.documentElement.scrollHeight - window.innerHeight : 1000);
    const scrollDelta = Math.abs(currentScrollY - this.lastScrollY);
    this.lastScrollY = currentScrollY;
    this.scrollSpeed = lerp(this.scrollSpeed, scrollDelta * 0.005, 0.1);
    const aberrationAmount = Math.max(0.0, Math.min(0.018, this.scrollSpeed));
    this.grainPass.uniforms.uAberration.value = 0.0002 + aberrationAmount;

    // Mouse Parallax Offset (ignored during manual drag)
    if (!this.isDragging) {
      if (this.mouse.x > -900) {
        this.targetCameraOffset.set(this.mouse.x * 1.8, this.mouse.y * 1.4, 0);
      } else {
        this.targetCameraOffset.set(0, 0, 0);
      }
      this.cameraOffset.lerp(this.targetCameraOffset, 0.05);
    } else {
      this.cameraOffset.lerp(new THREE.Vector3(0, 0, 0), 0.1);
    }



    // Dynamic camera sweep path based on scroll progress
    const { cam: targetCam, look: targetLook } = this.interpolateKeyframes(progress);
    
    // Apply mouse parallax offset to camera position
    this.camera.position.copy(targetCam).add(this.cameraOffset);
    this.camera.lookAt(targetLook);

    // Smoothly apply manual user drag rotation to the brain network
    this.userRotationY = lerp(this.userRotationY, this.targetUserRotationY, 0.1);
    this.userRotationX = lerp(this.userRotationX, this.targetUserRotationX, 0.1);

    // Combine ambient rotation with drag rotation
    this.brainGroup.rotation.y = el * 0.045 + this.userRotationY;
    this.brainGroup.rotation.x = this.userRotationX;
    
    // Rotate scanner HUD rings
    if (this.ring1) {
      this.ring1.rotation.y = el * 0.18;
    }
    if (this.ring2) {
      this.ring2.rotation.z = -el * 0.14;
      this.ring2.rotation.x = el * 0.09;
    }

    // Update coordinates and opacity for HTML Labels
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const labelAppear = smoothstep(0.04, 0.15, progress) * (1.0 - smoothstep(0.92, 1.0, progress) * 0.5);
    const overallOpacity = smoothstep(0.04, 0.16, progress) * (1 - smoothstep(0.93, 1.0, progress) * 0.45);

    // Check Raycast hovers
    let hasMouseIntersection = false;
    if (this.mouse.x > -900 && !this.isDragging) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      hasMouseIntersection = true;
    }

    let currentHoverIdx: number | null = null;
    if (hasMouseIntersection && this.nodeMeshes.length > 0) {
      const intersects = this.raycaster.intersectObjects(this.nodeMeshes);
      if (intersects.length > 0) {
        const hitMesh = intersects[0]!.object;
        const index = this.nodeMeshes.indexOf(hitMesh as THREE.Mesh);
        if (index !== -1) {
          currentHoverIdx = this.labels[index]!.idx;
        }
      }
    }
    if (currentHoverIdx !== this.hoveredNodeIdx) {
      this.hoveredNodeIdx = currentHoverIdx;
      if (currentHoverIdx !== null) {
        this.playHoverTick();
      }
    }

    // Project HTML labels on top of the rotating 3D neurons
    this.labels.forEach((label, i) => {
      const mesh = this.nodeMeshes[i]!;
      mesh.getWorldPosition(this.vec);
      
      const distToCam = this.camera.position.distanceTo(this.vec);
      this.vec.project(this.camera);

      const behind = this.vec.z > 1 || distToCam > 32; // Clip if behind or too far
      const depthFade = 1.0 - smoothstep(10, 32, distToCam);
      const out = this.labelScreens[i]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;

      const isHovered = this.hoveredNodeIdx !== null && label.idx === this.hoveredNodeIdx;
      
      // Show labels dynamically based on camera scroll height and node position
      out.opacity = behind ? 0 : (isHovered ? 1.0 : labelAppear * depthFade * overallOpacity);
    });

    // Project HTML Synaptic Tokens flowing between 3D nodes
    const tokenAppear = smoothstep(0.18, 0.32, progress) * (1 - smoothstep(0.85, 0.98, progress));
    this.tokensData.forEach((token, i) => {
      token.progress += dt * token.speed;
      if (token.progress >= 1.0) {
        token.progress = 0.0;
        token.edgeIdx = Math.floor(Math.random() * edgePairs.length);
        token.speed = 0.22 + Math.random() * 0.25;
      }
      
      const pair = edgePairs[token.edgeIdx]!;
      const posA = this.nodePositions[pair[0]]!;
      const posB = this.nodePositions[pair[1]]!;
      
      // Lerp position inside the rotating brain group space
      const tPos = new THREE.Vector3().lerpVectors(posA, posB, token.progress);
      
      // Project to world coordinates
      tPos.applyMatrix4(this.brainGroup.matrixWorld);
      const distToCam = this.camera.position.distanceTo(tPos);
      this.vec.copy(tPos).project(this.camera);
      
      const behind = this.vec.z > 1 || distToCam > 32;
      const depthFade = 1.0 - smoothstep(12, 32, distToCam);
      const out = this.tokenScreens[i]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;
      out.opacity = behind ? 0 : tokenAppear * depthFade * overallOpacity;
    });
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
    this.radarGrid.dispose();
    (this.radarGrid.material as THREE.Material).dispose();
    this.ring1.geometry.dispose();
    (this.ring1.material as THREE.Material).dispose();
    this.ring2.geometry.dispose();
    (this.ring2.material as THREE.Material).dispose();
    this.connectionLines.geometry.dispose();
    (this.connectionLines.material as THREE.Material).dispose();
    this.nodeMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      const wire = mesh.children[0] as THREE.Mesh;
      if (wire) {
        wire.geometry.dispose();
        (wire.material as THREE.Material).dispose();
      }
    });
    if (this.audioCtx) {
      this.audioCtx.close();
    }
    
    // Remove drag-to-rotate event listeners
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);

    this.canvas.removeEventListener("touchstart", this.onTouchStart);
    window.removeEventListener("touchmove", this.onTouchMove);
    window.removeEventListener("touchend", this.onTouchEnd);

    this.composer.dispose();
    this.renderer.dispose();
  }
}
