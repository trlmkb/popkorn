// GLSL for the faithful port of the Codrops "Grid Displacement Texture" effect.
//
// The simulation shader runs inside GPUComputationRenderer, which automatically
// injects the `uGrid` sampler (the variable's own previous frame) and a
// `resolution` define — so neither is declared here.

export const simulationFragmentShader = /* glsl */ `
  uniform vec2 uMouse;
  uniform vec2 uDeltaMouse;
  uniform float uMouseMove;
  uniform float uGridSize;
  uniform float uRelaxation;
  uniform float uDistance;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    vec4 color = texture2D(uGrid, uv);

    // Falloff around the cursor, sized by uDistance / uGridSize.
    float dist = distance(uv, uMouse);
    dist = 1.0 - smoothstep(0.0, uDistance / uGridSize, dist);

    // Inject this frame's mouse movement, then relax back toward rest.
    color.rg += uDeltaMouse * dist;
    color.rg *= min(uRelaxation, uMouseMove);

    gl_FragColor = color;
  }
`;

export const displayVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const displayFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uGrid;
  uniform vec2 uContainerResolution;
  uniform vec2 uImageResolution;

  varying vec2 vUv;

  // Replicates CSS background-size: cover.
  vec2 coverUvs(vec2 imageRes, vec2 containerRes) {
    float imageAspectX = imageRes.x / imageRes.y;
    float imageAspectY = imageRes.y / imageRes.x;

    float containerAspectX = containerRes.x / containerRes.y;
    float containerAspectY = containerRes.y / containerRes.x;

    vec2 ratio = vec2(
      min(containerAspectX / imageAspectX, 1.0),
      min(containerAspectY / imageAspectY, 1.0)
    );

    return vec2(
      vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
      vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
    );
  }

  void main() {
    vec2 imageUvs = coverUvs(uImageResolution, uContainerResolution);
    vec2 squareUvs = coverUvs(vec2(1.0), uContainerResolution);

    vec4 displacement = texture2D(uGrid, squareUvs);

    // Primary warp.
    vec2 finalUvs = imageUvs - displacement.rg * 0.01;
    vec4 finalImage = texture2D(uTexture, finalUvs);

    // Chromatic aberration that scales with displacement strength.
    vec2 shift = displacement.rg * 0.001;
    float strength = clamp(length(displacement.rg), 0.0, 2.0);

    vec2 redUvs = finalUvs + shift * (1.0 + strength * 0.25);
    vec2 greenUvs = finalUvs + shift * (1.0 + strength * 2.0);
    vec2 blueUvs = finalUvs + shift * (1.0 + strength * 1.5);

    finalImage.r = texture2D(uTexture, redUvs).r;
    finalImage.g = texture2D(uTexture, greenUvs).g;
    finalImage.b = texture2D(uTexture, blueUvs).b;

    gl_FragColor = finalImage;
  }
`;
