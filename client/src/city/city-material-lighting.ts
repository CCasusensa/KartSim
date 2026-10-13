import { Color, Vector3, type ShaderMaterial } from "three";
import type { SkyState } from "./city-clock";

/** Shared only by materials belonging to this city instance. Colors are display RGB,
 * like the native texture-stage output (which has no Three tone-mapping pass). */
export function createCityLightUniforms() {
  return {
    cityLightTint: { value: new Color(1, 1, 1) },
    citySunDirection: { value: new Vector3(0, 1, 0) },
    citySunStrength: { value: 0 },
    citySkyColor: { value: new Color() },
    cityHorizonColor: { value: new Color() },
    cityDaylight: { value: 1 },
  };
}
export type CityLightUniforms = ReturnType<typeof createCityLightUniforms>;

export function updateCityLightUniforms(uniforms: CityLightUniforms, state: SkyState): void {
  uniforms.cityLightTint.value.setRGB(...state.lightTint);
  uniforms.citySunDirection.value.set(...state.sunDirection);
  uniforms.citySunStrength.value = state.sunStrength;
  uniforms.citySkyColor.value.setRGB(...state.skyColor);
  uniforms.cityHorizonColor.value.setRGB(...state.horizonColor);
  uniforms.cityDaylight.value = state.daylight;
}

const nativeColor = "gl_FragColor = vec4(clamp(source.rgb * lightFactor, 0.0, 1.0), source.a);";
const nativePosition = "gl_Position = projectionMatrix * mvPosition;";
const worldPosition = `
  #ifdef BAKED_NODES
    vCityWorldPosition = (modelMatrix * vec4(clientPosition, 1.0)).xyz;
  #else
    vCityWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  #endif
`;
const surfaceLight = `
  // Screen derivatives work for the imported city's baked geometry as well as
  // meshes without normal attributes. Existing texture/vertex shadows remain.
  vec3 cityNormal = cross(dFdx(vCityWorldPosition), dFdy(vCityWorldPosition));
  cityNormal /= max(length(cityNormal), 0.00001);
  float sunFacing = max(dot(cityNormal, citySunDirection), 0.0);
  float sunlight = 1.0 + citySunStrength * (sunFacing * 1.7 - 0.9);
  vec3 lit = source.rgb * lightFactor * cityLightTint * sunlight;
  // A restrained contrast curve preserves dark palm leaves and cream highlights.
  lit = (lit - 0.5) * 1.06 + 0.5;
  gl_FragColor = vec4(clamp(lit, 0.0, 1.0), source.a);
`;
const skyLight = `
  vec3 skyDirection = normalize(vCityWorldPosition - cameraPosition);
  float altitude = smoothstep(-0.06, 0.65, skyDirection.y);
  vec3 sky = mix(cityHorizonColor, citySkyColor, altitude);
  float sun = max(dot(skyDirection, citySunDirection), 0.0);
  float haze = pow(sun, 24.0) * 0.12 + pow(sun, 512.0) * 0.32;
  sky += vec3(1.0, 0.79, 0.42) * haze * citySunStrength;
  // Preserve the imported night sky and its stars as the sun goes down.
  sky = mix(source.rgb * lightFactor, sky, cityDaylight);
  gl_FragColor = vec4(clamp(sky, 0.0, 1.0), source.a);
`;

/** Patch the city copy of the native basic shader, never the shared race factory. */
export function installCityMaterialLighting(material: ShaderMaterial,
  uniforms: CityLightUniforms, sky = false): (() => void) | undefined {
  if (!material.fragmentShader?.includes(nativeColor) ||
      !material.vertexShader?.includes(nativePosition)) return undefined;
  const vertexShader = material.vertexShader, fragmentShader = material.fragmentShader;
  const originalUniforms = material.uniforms;
  const originalFog = material.fog;
  // The sky itself supplies the horizon haze; scene distance fog would flatten
  // the entire dome into one color at the city's shorter visibility distance.
  if (sky) material.fog = false;
  material.uniforms = { ...originalUniforms, ...uniforms };
  material.vertexShader = `varying vec3 vCityWorldPosition;\n${vertexShader}`
    .replace(nativePosition, `${worldPosition}\n${nativePosition}`);
  material.fragmentShader = `
    varying vec3 vCityWorldPosition;
    uniform vec3 cityLightTint;
    uniform vec3 citySunDirection;
    uniform float citySunStrength;
    uniform vec3 citySkyColor;
    uniform vec3 cityHorizonColor;
    uniform float cityDaylight;
    ${fragmentShader}
  `.replace(nativeColor, sky ? skyLight : surfaceLight);
  material.needsUpdate = true;
  return () => {
    material.vertexShader = vertexShader;
    material.fragmentShader = fragmentShader;
    material.uniforms = originalUniforms;
    material.fog = originalFog;
    material.needsUpdate = true;
  };
}
