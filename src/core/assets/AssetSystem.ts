import { loadGLB, type CpuMesh } from "./GLBLoader";
import { loadScenePreset } from "./loadScene";
import type { ScenePreset } from "./ScenePreset";

export class AssetSystem {
  private readonly sceneCache = new Map<string, Promise<ScenePreset>>();
  private readonly meshCache = new Map<string, Promise<CpuMesh[]>>();

  loadScene(url: string): Promise<ScenePreset> {
    let scene = this.sceneCache.get(url);

    if (!scene) {
      scene = loadScenePreset(url);
      this.sceneCache.set(url, scene);
    }

    return scene;
  }

  loadGLB(url: string): Promise<CpuMesh[]> {
    let meshes = this.meshCache.get(url);

    if (!meshes) {
      meshes = loadGLB(url);
      this.meshCache.set(url, meshes);
    }

    return meshes;
  }
}
