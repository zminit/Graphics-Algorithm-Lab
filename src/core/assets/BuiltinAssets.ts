export const BuiltinAssets = {
  models: {
    cube: "/assets/builtin/models/cube.glb",
    plane: "/assets/builtin/models/plane.glb",
    sphere: "/assets/builtin/models/sphere.glb",
    materialTestSpheres: "/assets/builtin/models/material-test-spheres.glb",
  },
  textures: {
    checkerboard: "/assets/builtin/textures/checkerboard.png",
    uvGrid: "/assets/builtin/textures/uv-grid.png",
    white: "/assets/builtin/textures/white.png",
    black: "/assets/builtin/textures/black.png",
    gray: "/assets/builtin/textures/gray.png",
    flatNormal: "/assets/builtin/textures/flat-normal.png",
    blueNoise: "/assets/builtin/textures/blue-noise.png",
  },
  hdr: {
    studioSmall: "/assets/builtin/hdr/studio-small.placeholder.md",
    outdoorDay: "/assets/builtin/hdr/outdoor-day.placeholder.md",
    indoorSoft: "/assets/builtin/hdr/indoor-soft.placeholder.md",
  },
  scenes: {
    shadowTest: "/assets/builtin/scenes/shadow-test.json",
    pbrTest: "/assets/builtin/scenes/pbr-test.json",
    postprocessTest: "/assets/builtin/scenes/postprocess-test.json",
    raytracingCornell: "/assets/builtin/scenes/raytracing-cornell.json",
  },
} as const;

export type BuiltinAssetPath =
  | (typeof BuiltinAssets.models)[keyof typeof BuiltinAssets.models]
  | (typeof BuiltinAssets.textures)[keyof typeof BuiltinAssets.textures]
  | (typeof BuiltinAssets.hdr)[keyof typeof BuiltinAssets.hdr]
  | (typeof BuiltinAssets.scenes)[keyof typeof BuiltinAssets.scenes];
