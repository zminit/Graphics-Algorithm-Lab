import type { ScenePreset } from "./ScenePreset";

export async function loadScenePreset(url: string): Promise<ScenePreset> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load scene preset: ${url}`);
  }

  const data = (await response.json()) as Partial<ScenePreset>;

  if (data.schema !== "games-platform.scene-preset" || data.version !== 1) {
    throw new Error(`Unsupported scene preset format: ${url}`);
  }

  if (!data.id || !data.name || !data.camera || !data.materials || !data.meshes) {
    throw new Error(`Invalid scene preset: ${url}`);
  }

  return data as ScenePreset;
}
