import type { JSX, PointerEvent } from "react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Geometry3DSolveResultV1 } from "../kernels/geometry3dKernel";
import type { Geometry3DSpecV1 } from "../visualizationArtifact.types";

type Geometry3DCanvasProps = {
  onFailure: (diagnostic: string) => void;
  onReady: () => void;
  onSelect: (objectId: string) => void;
  resetToken: number;
  result: Geometry3DSolveResultV1;
  selectedObjectId: string | null;
  spec: Geometry3DSpecV1;
};

const objectColors = [0x2563eb, 0x0f766e, 0x7c3aed, 0xb45309];
const backgroundColor = new THREE.Color(0xf8fafc);

export function Geometry3DCanvas({
  onFailure,
  onReady,
  onSelect,
  resetToken,
  result,
  selectedObjectId,
  spec
}: Geometry3DCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: false,
        antialias: true,
        canvas,
        powerPreference: "default",
        precision: "mediump",
        preserveDrawingBuffer: true
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      rendererRef.current = renderer;
      renderer.setClearColor(backgroundColor, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      const scene = new THREE.Scene();
      scene.background = backgroundColor;
      sceneRef.current = scene;
      const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.01, Math.max(spec.camera.maxDistance * 20, 100));
      camera.position.set(...spec.camera.position);
      cameraRef.current = camera;

      controls = new OrbitControls(camera, canvas);
      controlsRef.current = controls;
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.minDistance = spec.camera.minDistance;
      controls.maxDistance = spec.camera.maxDistance;
      controls.target.set(...spec.camera.target);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 1.8));
      const directional = new THREE.DirectionalLight(0xffffff, 2.2);
      directional.position.set(4, 6, 5);
      scene.add(directional);
      scene.add(new THREE.AxesHelper(1.25));
      const grid = new THREE.GridHelper(4, 8, 0x94a3b8, 0xe2e8f0);
      grid.position.y = -0.02;
      scene.add(grid);

      spec.objects.forEach((object, index) => {
        const group = createObjectGroup(object, index, selectedObjectId === object.id);
        scene.add(group);
      });
      result.sections.forEach((section) => {
        scene.add(createSectionGroup(section, selectedObjectId === section.id));
      });

      const renderScene = () => renderer?.render(scene, camera);
      controls.addEventListener("change", renderScene);
      const resize = () => {
        if (!renderer) return;
        const cssWidth = Math.max(canvas.clientWidth, 1);
        const cssHeight = Math.max(canvas.clientHeight, 1);
        camera.aspect = cssWidth / cssHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(cssWidth, cssHeight, false);
        renderScene();
      };
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
      } else {
        window.addEventListener("resize", resize);
      }
      controls.update();
      resize();
      renderScene();

      requestAnimationFrame(() => {
        if (disposed || !renderer) return;
        if (hasRenderedPixels(renderer)) onReady();
        else onFailure("geometry_webgl_pixels_blank");
      });

      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        window.removeEventListener("resize", resize);
        controls?.removeEventListener("change", renderScene);
        controls?.dispose();
        disposeScene(scene);
        renderer?.dispose();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
        controlsRef.current = null;
      };
    } catch (error) {
      renderer?.dispose();
      onFailure(error instanceof Error ? error.message : "geometry_webgl_initialization_failed");
      return;
    }
  }, [onFailure, onReady, result, spec]);

  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!scene || !renderer || !camera) return;
    applySelection(scene, selectedObjectId);
    renderer.render(scene, camera);
  }, [selectedObjectId]);

  useEffect(() => {
    if (resetToken === 0) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!camera || !controls || !renderer || !scene) return;
    camera.position.set(...spec.camera.position);
    controls.target.set(...spec.camera.target);
    controls.update();
    renderer.render(scene, camera);
  }, [resetToken, spec.camera.position, spec.camera.target]);

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!canvas || !scene || !camera) return;
    const bounds = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(scene.children, true);
    const selected = intersections.map((intersection) => findObjectId(intersection.object)).find(Boolean);
    if (selected) onSelect(selected);
  }

  return (
    <canvas
      aria-label="可交互三维几何"
      className="visualization-geometry-3d__canvas"
      data-testid="geometry-3d-canvas"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      ref={canvasRef}
    />
  );
}

function createObjectGroup(
  object: Geometry3DSpecV1["objects"][number],
  colorIndex: number,
  selected: boolean
): THREE.Group {
  const group = new THREE.Group();
  group.userData.objectId = object.id;
  group.userData.visualKind = "object";
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(object.vertices.flat(), 3));
  const indices = (object.faces ?? []).flatMap((face) => triangulateFace(face));
  if (indices.length > 0) {
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: objectColors[colorIndex % objectColors.length],
      emissive: selected ? 0x172554 : 0x000000,
      emissiveIntensity: selected ? 0.7 : 0,
      metalness: 0.05,
      opacity: selected ? 0.9 : 0.66,
      roughness: 0.72,
      side: THREE.DoubleSide,
      transparent: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.objectId = object.id;
    group.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: selected ? 0x0f172a : 0x1e3a8a, linewidth: 1 })
    );
    edges.userData.objectId = object.id;
    group.add(edges);
  } else {
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: objectColors[colorIndex % objectColors.length], size: selected ? 0.1 : 0.07 })
    );
    points.userData.objectId = object.id;
    group.add(points);
  }
  return group;
}

function createSectionGroup(section: Geometry3DSolveResultV1["sections"][number], selected: boolean): THREE.Group {
  const group = new THREE.Group();
  group.userData.objectId = section.id;
  group.userData.visualKind = "section";
  if (section.vertices.length < 3) return group;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(section.vertices.flat(), 3));
  geometry.setIndex(Array.from({ length: section.vertices.length - 2 }, (_, index) => [0, index + 1, index + 2]).flat());
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: selected ? 0x991b1b : 0xdc2626,
      opacity: selected ? 0.62 : 0.34,
      side: THREE.DoubleSide,
      transparent: true
    })
  );
  mesh.userData.objectId = section.id;
  group.add(mesh);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute([...section.vertices, section.vertices[0]].flat(), 3));
  const outline = new THREE.Line(
    lineGeometry,
    new THREE.LineBasicMaterial({ color: selected ? 0x450a0a : 0xb91c1c })
  );
  outline.userData.objectId = section.id;
  group.add(outline);
  return group;
}

function triangulateFace(face: readonly number[]): number[] {
  return Array.from({ length: face.length - 2 }, (_, index) => [face[0], face[index + 1], face[index + 2]]).flat();
}

function hasRenderedPixels(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width <= 0 || height <= 0) return false;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let nonBackgroundPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) {
      nonBackgroundPixels += 1;
      if (nonBackgroundPixels > 100) return true;
    }
  }
  return false;
}

function findObjectId(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.objectId === "string") return current.userData.objectId;
    current = current.parent;
  }
  return null;
}

function applySelection(scene: THREE.Scene, selectedObjectId: string | null): void {
  scene.traverse((object) => {
    if (!("material" in object)) return;
    const owner = findVisualOwner(object);
    if (!owner) return;
    const selected = owner.objectId === selectedObjectId;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.setHex(selected ? 0x172554 : 0x000000);
        material.emissiveIntensity = selected ? 0.7 : 0;
        material.opacity = selected ? 0.9 : 0.66;
      } else if (material instanceof THREE.MeshBasicMaterial) {
        material.color.setHex(selected ? 0x991b1b : 0xdc2626);
        material.opacity = selected ? 0.62 : 0.34;
      } else if (material instanceof THREE.LineBasicMaterial) {
        const baseColor = owner.visualKind === "section" ? 0xb91c1c : 0x1e3a8a;
        const selectedColor = owner.visualKind === "section" ? 0x450a0a : 0x0f172a;
        material.color.setHex(selected ? selectedColor : baseColor);
      } else if (material instanceof THREE.PointsMaterial) {
        material.size = selected ? 0.1 : 0.07;
      }
      material.needsUpdate = true;
    }
  });
}

function findVisualOwner(object: THREE.Object3D): { objectId: string; visualKind: "object" | "section" } | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.objectId === "string" && (current.userData.visualKind === "object" || current.userData.visualKind === "section")) {
      return { objectId: current.userData.objectId, visualKind: current.userData.visualKind };
    }
    current = current.parent;
  }
  return null;
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) object.geometry.dispose();
    if (!("material" in object)) return;
    const material = object.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  });
}
