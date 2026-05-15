export type Vec3 = [number, number, number];
export type RgbaColor = [number, number, number, number];

export type SceneMaterial = {
  id: string;
  name: string;
  baseColor: RgbaColor;
  metallic?: number;
  roughness?: number;
  baseColorTexture?: string;
  normalTexture?: string;
};

export type SceneMesh = {
  id: string;
  name: string;
  model: string;
  material: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
};

export type SceneLight =
  | {
      type: "directional";
      name: string;
      direction: Vec3;
      color: Vec3;
      intensity: number;
    }
  | {
      type: "point";
      name: string;
      position: Vec3;
      color: Vec3;
      intensity: number;
      radius?: number;
    }
  | {
      type: "area";
      name: string;
      position: Vec3;
      rotation?: Vec3;
      size: Vec3;
      color: Vec3;
      intensity: number;
    };

export type SceneCamera = {
  position: Vec3;
  target: Vec3;
  fovYDegrees: number;
  near: number;
  far: number;
};

export type ScenePreset = {
  schema: "games-platform.scene-preset";
  version: 1;
  id: string;
  name: string;
  purpose: string;
  camera: SceneCamera;
  environment?: {
    color?: Vec3;
    hdr?: string;
  };
  materials: SceneMaterial[];
  meshes: SceneMesh[];
  lights: SceneLight[];
  notes?: string[];
};
