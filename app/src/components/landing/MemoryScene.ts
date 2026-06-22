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

const HUB_COUNT = 10;
const TOKEN_COUNT = 12;

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

export class MemoryScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private world!: THREE.Group; 
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private grainPass!: ShaderPass;
  private timer = new FrameTimer();

  // 3D Cybernetic Grid Highway
  private gridGeom!: THREE.PlaneGeometry;
  private gridBasePositions!: Float32Array;
  private gridMesh!: THREE.LineSegments;

  // Holographic Monoliths (Rising Data Towers)
  private monoliths: THREE.Mesh[] = [];

  // Interaction
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2(-999, -999);
  private cameraOffset = new THREE.Vector3(0, 0, 0);
  private targetCameraOffset = new THREE.Vector3(0, 0, 0);
  public hoveredNodeIdx: number | null = null;
  private lastScrollY = 0;
  private scrollSpeed = 0;
  private vec = new THREE.Vector3();

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
  tokenScreens: { x: number; y: number; opacity: number }[] = [];

  // Web Audio Context & Nodes
  private audioCtx: AudioContext | null = null;
  private droneOsc: OscillatorNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;

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
    this.scene.fog = new THREE.Fog(COLOR_BG, 15, 95);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 150);
    this.camera.position.set(0, 2, 10);

    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 10, 6);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xc6b69a, 0.65));

    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.buildGridHighway();
    this.buildMonoliths();
    this.buildComposer(w, h, dpr);
  }

  private buildGridHighway(): void {
    // Large plane geometry with height segments to allow smooth horizon bending
    this.gridGeom = new THREE.PlaneGeometry(60, 200, 24, 80);
    this.gridGeom.rotateX(-Math.PI / 2); // Lay flat on ground

    // Save base coordinates to compute dynamic curved horizon relative offsets
    const baseAttrib = this.gridGeom.attributes.position as THREE.BufferAttribute;
    this.gridBasePositions = new Float32Array(baseAttrib.count * 3);
    for (let i = 0; i < baseAttrib.count; i++) {
      this.gridBasePositions[i * 3 + 0] = baseAttrib.getX(i);
      this.gridBasePositions[i * 3 + 1] = baseAttrib.getY(i);
      this.gridBasePositions[i * 3 + 2] = baseAttrib.getZ(i);
    }

    const wiregeom = new THREE.WireframeGeometry(this.gridGeom);
    this.gridMesh = new THREE.LineSegments(
      wiregeom,
      new THREE.LineBasicMaterial({
        color: COLOR_LILAC,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
      })
    );
    this.world.add(this.gridMesh);
  }

  private buildMonoliths(): void {
    const boxGeom = new THREE.BoxGeometry(2, 6, 2);
    boxGeom.translate(0, 3, 0); // bottom face as anchor pivot

    // Premium refractive glass material
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: COLOR_LILAC,
      transparent: true,
      opacity: 0.85,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 1.0,
      thickness: 1.4,
      ior: 1.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      side: THREE.DoubleSide,
    });

    this.labels.forEach((label) => {
      const mesh = new THREE.Mesh(boxGeom, glassMat.clone());
      
      // Cyber wireframe cage overlay
      const wireGeom = new THREE.BoxGeometry(2.05, 6.05, 2.05);
      wireGeom.translate(0, 3, 0);
      const wireMat = new THREE.MeshBasicMaterial({
        color: COLOR_OCHRE,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
      });
      const wire = new THREE.Mesh(wireGeom, wireMat);
      mesh.add(wire);

      this.world.add(mesh);
      this.monoliths.push(mesh);
    });
  }

  private initAudio(): void {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      this.audioCtx = new AudioContextClass();
      
      this.droneOsc = this.audioCtx.createOscillator();
      this.droneOsc.type = "sawtooth";
      this.droneOsc.frequency.setValueAtTime(55, this.audioCtx.currentTime);
      
      this.droneFilter = this.audioCtx.createBiquadFilter();
      this.droneFilter.type = "lowpass";
      this.droneFilter.frequency.setValueAtTime(120, this.audioCtx.currentTime);
      this.droneFilter.Q.setValueAtTime(5.0, this.audioCtx.currentTime);
      
      this.droneGain = this.audioCtx.createGain();
      this.droneGain.gain.setValueAtTime(0.001, this.audioCtx.currentTime);
      
      this.droneOsc.connect(this.droneFilter);
      this.droneFilter.connect(this.droneGain);
      this.droneGain.connect(this.audioCtx.destination);
      
      this.droneOsc.start();
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

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.75, 0.7, 0.25);
    this.composer.addPass(this.bloomPass);

    this.grainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uGrain: { value: 0.035 },
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

    // Scroll Speed calculation
    const currentScrollY = progress * (typeof document !== "undefined" ? document.documentElement.scrollHeight - window.innerHeight : 1000);
    const scrollDelta = Math.abs(currentScrollY - this.lastScrollY);
    this.lastScrollY = currentScrollY;
    this.scrollSpeed = lerp(this.scrollSpeed, scrollDelta * 0.005, 0.1);
    const aberrationAmount = Math.max(0.0, Math.min(0.016, this.scrollSpeed));
    this.grainPass.uniforms.uAberration.value = 0.0002 + aberrationAmount;

    // Mouse Parallax
    if (this.mouse.x > -900) {
      this.targetCameraOffset.set(this.mouse.x * 1.5, this.mouse.y * 1.2, 0);
    } else {
      this.targetCameraOffset.set(0, 0, 0);
    }
    this.cameraOffset.lerp(this.targetCameraOffset, 0.05);

    // Audio modulations
    if (!this.audioCtx && (this.mouse.x > -900 || progress > 0.001)) {
      this.initAudio();
    }
    if (this.audioCtx && this.droneOsc && this.droneFilter && this.droneGain) {
      if (this.audioCtx.state === "suspended") this.audioCtx.resume();
      const now = this.audioCtx.currentTime;
      this.droneOsc.frequency.setTargetAtTime(55 + progress * 55, now, 0.15);
      this.droneFilter.frequency.setTargetAtTime(110 + this.scrollSpeed * 900 + progress * 200, now, 0.1);
      this.droneGain.gain.setTargetAtTime(Math.min(0.06, 0.015 + this.scrollSpeed * 0.15), now, 0.25);
    }

    // Camera sits static relative to Z loop while landscape rolls
    const floatY = Math.sin(el * 0.2) * 0.15;
    this.camera.position.set(this.cameraOffset.x, 2.5 + floatY + this.cameraOffset.y, 10);
    this.camera.lookAt(0, -1.0, -18);

    // Dynamic grid highway scroll and curved horizon distortion
    const gridPos = this.gridGeom.attributes.position as THREE.BufferAttribute;
    const basePos = this.gridBasePositions;
    const totalHighwayLen = 420;
    const scrollOffset = (progress * totalHighwayLen) % 20;

    for (let i = 0; i < gridPos.count; i++) {
      const bx = basePos[i * 3 + 0]!;
      const by = basePos[i * 3 + 1]!;
      const bz = basePos[i * 3 + 2]!;

      // Scroll grid backwards
      let z = bz - scrollOffset;

      // Horizon bend calculations
      let y = by;
      if (z < -15) {
        const dz = z + 15;
        y += -0.04 * dz * dz;
      }
      gridPos.setXYZ(i, bx, y - 5, z);
    }
    gridPos.needsUpdate = true;
    this.gridGeom.computeVertexNormals();

    // Position and Rise Monoliths along the grid landscape
    this.world.updateMatrixWorld(true);
    const overallOpacity = smoothstep(0.04, 0.16, progress) * (1 - smoothstep(0.93, 1.0, progress) * 0.45);
    const hudOpacity = smoothstep(0.24, 0.38, progress) * (1.0 - smoothstep(0.8, 0.95, progress));

    const totalMonoliths = this.labels.length;
    let hasMouseIntersection = false;
    if (this.mouse.x > -900) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      hasMouseIntersection = true;
    }

    this.labels.forEach((label, i) => {
      const mesh = this.monoliths[i]!;
      const side = i % 2 === 0 ? -12 : 12;
      const initialZ = -10 - i * 15;

      // Wrap monolith coordinates loop seamlessly
      let z = initialZ + (progress * totalHighwayLen);
      z = ((z + 100) % totalHighwayLen) - 320; // wrap between -320 and 100

      // Calculate ground curve height at Z
      let groundY = -5;
      if (z < -15) {
        const dz = z + 15;
        groundY += -0.04 * dz * dz;
      }

      // Rise factor based on distance
      const distToCam = Math.abs(z);
      const rise = 1.0 - smoothstep(15, 80, distToCam);
      const targetY = groundY + (rise * 5.0);

      mesh.position.set(side, groundY, z);
      mesh.scale.set(1.0, rise + 0.01, 1.0); // scale pivot up

      const glassMat = mesh.material as THREE.MeshPhysicalMaterial;
      glassMat.opacity = hudOpacity * 0.85;

      const wire = mesh.children[0] as THREE.Mesh;
      if (wire) {
        const wireMat = wire.material as THREE.MeshBasicMaterial;
        wireMat.opacity = hudOpacity * 0.28;
      }
    });

    // Raycast hover updates
    let currentHoverIdx: number | null = null;
    if (hasMouseIntersection && this.monoliths.length > 0) {
      const intersects = this.raycaster.intersectObjects(this.monoliths);
      if (intersects.length > 0) {
        const hitMesh = intersects[0]!.object;
        const index = this.monoliths.indexOf(hitMesh as THREE.Mesh);
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

    // Project HTML labels to coordinates on top of the rising towers
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const labelAppear = smoothstep(0.34, 0.46, progress) * (1 - smoothstep(0.80, 0.95, progress));

    this.labels.forEach((label, i) => {
      const side = i % 2 === 0 ? -12 : 12;
      const initialZ = -10 - i * 15;

      let z = initialZ + (progress * totalHighwayLen);
      z = ((z + 100) % totalHighwayLen) - 320;

      let groundY = -5;
      if (z < -15) {
        const dz = z + 15;
        groundY += -0.04 * dz * dz;
      }

      const distToCam = Math.abs(z);
      const rise = 1.0 - smoothstep(15, 80, distToCam);
      const topY = groundY + (rise * 5.5);

      this.vec.set(side, topY, z);
      this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);

      const behind = this.vec.z > 1 || z > 0 || z < -90; // hide if behind camera or too far
      const depthFade = 1.0 - smoothstep(0.3, 0.9, this.vec.z);
      const out = this.labelScreens[i]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;

      const isHovered = this.hoveredNodeIdx !== null && label.idx === this.hoveredNodeIdx;
      out.opacity = behind ? 0 : (isHovered ? 1.0 : labelAppear * depthFade * overallOpacity);
    });

    // Meaning tokens flowing along the highway lanes
    const tokenAppear = smoothstep(0.34, 0.48, progress) * (1 - smoothstep(0.80, 0.95, progress));
    for (let i = 0; i < TOKEN_COUNT; i++) {
      let tz = -10 - i * 18 + (el * 12.0); // animate forward
      tz = ((tz + 100) % 200) - 100; // wrap Z

      let groundY = -5;
      if (tz < -15) {
        const dz = tz + 15;
        groundY += -0.04 * dz * dz;
      }

      const laneX = ((i % 3) - 1) * 5.0; // lane offset
      this.vec.set(laneX, groundY + 0.5, tz);
      this.vec.applyMatrix4(this.world.matrixWorld).project(this.camera);

      const behind = this.vec.z > 1 || tz > 0 || tz < -90;
      const depthFade = 1.0 - smoothstep(0.4, 0.95, this.vec.z);
      const out = this.tokenScreens[i]!;
      out.x = (this.vec.x * 0.5 + 0.5) * cw;
      out.y = (-this.vec.y * 0.5 + 0.5) * ch;
      out.opacity = behind ? 0 : tokenAppear * depthFade * overallOpacity;
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
    this.gridGeom.dispose();
    (this.gridMesh.material as THREE.Material).dispose();
    this.monoliths.forEach(mesh => {
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
    this.composer.dispose();
    this.renderer.dispose();
  }
}
