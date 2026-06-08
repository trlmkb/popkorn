import * as THREE from 'three';
import {
  GPUComputationRenderer,
  type Variable,
} from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import {
  displayFragmentShader,
  displayVertexShader,
  simulationFragmentShader,
} from './shaders';

// Exact parameters from the Codrops "Grid Displacement Texture" demo.
const PARAMS = {
  relaxation: 0.965,
  size: 700,
  distance: 0.6,
  strength: 0.8,
} as const;

// 700 grid points -> a 27x27 simulation texture: ceil(sqrt(700)) = 27.
const GRID_SIZE = Math.ceil(Math.sqrt(PARAMS.size));

const MAX_PIXEL_RATIO = 2;

interface ViewSize {
  width: number;
  height: number;
}

/**
 * Renders an image full-screen and warps it with a GPU-simulated grid
 * displacement field that follows the pointer, with a chromatic RGB shift.
 */
export class GridDistortion {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly material: THREE.ShaderMaterial;

  private readonly gpgpu: GPUComputationRenderer;
  private readonly gridVariable: Variable;

  private readonly mouse = new THREE.Vector2(0, 0);
  private readonly deltaScratch = new THREE.Vector2(0, 0);

  private readonly reducedMotion: boolean;
  private frameId = 0;
  private running = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly imageUrl: string,
  ) {
    this.reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio));
    this.renderer.setSize(width, height);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
    this.camera.position.z = 10;

    // --- GPGPU displacement field ---
    this.gpgpu = new GPUComputationRenderer(GRID_SIZE, GRID_SIZE, this.renderer);
    const initialTexture = this.gpgpu.createTexture();
    this.gridVariable = this.gpgpu.addVariable(
      'uGrid',
      simulationFragmentShader,
      initialTexture,
    );
    this.gpgpu.setVariableDependencies(this.gridVariable, [this.gridVariable]);

    const sim = this.gridVariable.material.uniforms;
    sim.uMouse = { value: new THREE.Vector2(0, 0) };
    sim.uDeltaMouse = { value: new THREE.Vector2(0, 0) };
    sim.uMouseMove = { value: 0 };
    sim.uGridSize = { value: GRID_SIZE };
    sim.uRelaxation = { value: PARAMS.relaxation };
    sim.uDistance = { value: PARAMS.distance * 10 };

    const error = this.gpgpu.init();
    if (error !== null) {
      console.error('GridDistortion: GPGPU init failed —', error);
    }

    // --- Display plane ---
    this.material = new THREE.ShaderMaterial({
      vertexShader: displayVertexShader,
      fragmentShader: displayFragmentShader,
      uniforms: {
        uTexture: { value: null },
        uGrid: {
          value: this.gpgpu.getCurrentRenderTarget(this.gridVariable).texture,
        },
        uContainerResolution: { value: new THREE.Vector2(width, height) },
        uImageResolution: { value: new THREE.Vector2(1, 1) },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.scene.add(this.mesh);
    this.resizeMesh();

    this.loadTexture();
  }

  /** World-space size visible at z = 0, used to fit the plane to the viewport. */
  private viewSize(): ViewSize {
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(fovRad / 2) * this.camera.position.z;
    return { width: height * this.camera.aspect, height };
  }

  private resizeMesh(): void {
    const { width, height } = this.viewSize();
    this.mesh.scale.set(width, height, 1);
  }

  private loadTexture(): void {
    new THREE.TextureLoader().load(this.imageUrl, (texture) => {
      const image = texture.image as HTMLImageElement;
      this.material.uniforms.uTexture.value = texture;
      (this.material.uniforms.uImageResolution.value as THREE.Vector2).set(
        image.naturalWidth,
        image.naturalHeight,
      );
      if (!this.running) this.renderFrame();
    });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const uvX = event.clientX / window.innerWidth;
    const uvY = 1 - event.clientY / window.innerHeight;

    const sim = this.gridVariable.material.uniforms;
    sim.uMouseMove.value = 1;
    this.deltaScratch
      .set(uvX - this.mouse.x, uvY - this.mouse.y)
      .multiplyScalar(PARAMS.strength * 100);
    (sim.uDeltaMouse.value as THREE.Vector2).copy(this.deltaScratch);
    this.mouse.set(uvX, uvY);
    (sim.uMouse.value as THREE.Vector2).copy(this.mouse);
  };

  private readonly onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio));
    this.renderer.setSize(width, height);
    (this.material.uniforms.uContainerResolution.value as THREE.Vector2).set(
      width,
      height,
    );
    this.resizeMesh();
    if (!this.running) this.renderFrame();
  };

  private stepSimulation(): void {
    const sim = this.gridVariable.material.uniforms;
    sim.uMouseMove.value = (sim.uMouseMove.value as number) * 0.95;
    (sim.uDeltaMouse.value as THREE.Vector2).multiplyScalar(
      sim.uRelaxation.value as number,
    );
    this.gpgpu.compute();
    this.material.uniforms.uGrid.value = this.gpgpu.getCurrentRenderTarget(
      this.gridVariable,
    ).texture;
  }

  private renderFrame(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private readonly tick = (): void => {
    this.stepSimulation();
    this.renderFrame();
    this.frameId = requestAnimationFrame(this.tick);
  };

  /** Begin rendering. Honors prefers-reduced-motion by showing a static image. */
  start(): void {
    window.addEventListener('resize', this.onResize);

    if (this.reducedMotion) {
      this.renderFrame();
      return;
    }

    window.addEventListener('pointermove', this.onPointerMove);
    this.running = true;
    this.tick();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.onResize);

    const texture = this.material.uniforms.uTexture.value as THREE.Texture | null;
    texture?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.gpgpu.dispose();
    this.renderer.dispose();
  }
}
