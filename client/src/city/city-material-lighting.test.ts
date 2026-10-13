import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Fog, Group, Mesh, ShaderMaterial, Texture } from "three";
import { createBasicTextureMaterial, type BasicTextureProperties } from "../resources/basic-texture-material";
import { CityAtmosphere } from "./city-atmosphere";
import { skyStateAt } from "./city-clock";
import { createCityLightUniforms, installCityMaterialLighting, updateCityLightUniforms } from "./city-material-lighting";

const properties: BasicTextureProperties = {
  texture: { value: { textureOp: 1 } },
  fog: { value: { selector: 0 } },
  material: { value: { mode: 0, diffuse: 0xffffffff, emissive: 0xffffffff } },
  alpha: { value: { alphaTestEnable: 1, compare: 5, alphaRef: 127,
    blendEnable: 1, srcBlend: 5, dstBlend: 6 } },
  zbuffer: { value: { zWrite: 1, zFunc: 4 } },
  backface: { value: { cull: 3 } },
};
const clock = { serverTick: 0, timeOfDay: (8 + 50 / 60) / 24,
  dayLengthMs: 2880000, weather: "clear" as const, weatherUntilTick: 0 };

test("city lighting shares live controls only inside its scene and restores native material programs", () => {
  const texture = new Texture();
  const city = createBasicTextureMaterial(texture, properties, false, true);
  const sky = createBasicTextureMaterial(texture, properties);
  const race = createBasicTextureMaterial(texture, properties, false, true);
  const original = { vertex: city.vertexShader, fragment: city.fragmentShader,
    uniforms: city.uniforms, version: city.version, defines: city.defines };
  const originalSky = { uniforms: sky.uniforms, fog: sky.fog };
  const raceUniforms = race.uniforms, textureVersion = texture.version;
  const alpha = city.uniforms.textureAlpha;
  alpha!.value = .6;
  const uniforms = createCityLightUniforms();
  const restoreCity = installCityMaterialLighting(city, uniforms);
  const restoreSky = installCityMaterialLighting(sky, uniforms, true);
  assert.ok(restoreCity && restoreSky);
  assert.equal(city.version, original.version + 1);
  assert.notEqual(city.vertexShader, original.vertex);
  assert.notEqual(city.fragmentShader, original.fragment);
  assert.strictEqual(city.defines, original.defines);
  assert.strictEqual(city.uniforms.textureAlpha, alpha);
  assert.equal(alpha!.value, .6);
  assert.equal(sky.fog, false);

  const state = skyStateAt(clock, 0);
  updateCityLightUniforms(uniforms, state);
  assert.strictEqual(city.uniforms.cityLightTint, sky.uniforms.cityLightTint);
  assert.deepEqual(city.uniforms.cityLightTint!.value.toArray(), state.lightTint);
  assert.deepEqual(sky.uniforms.citySunDirection!.value.toArray(), state.sunDirection);
  assert.equal(sky.uniforms.cityDaylight!.value, state.daylight);
  assert.strictEqual(race.uniforms, raceUniforms);
  assert.equal(race.uniforms.cityLightTint, undefined);
  assert.equal(race.vertexShader, original.vertex);
  assert.equal(race.fragmentShader, original.fragment);
  assert.equal(texture.version, textureVersion);

  restoreCity();
  restoreSky();
  assert.equal(city.vertexShader, original.vertex);
  assert.equal(city.fragmentShader, original.fragment);
  assert.strictEqual(city.uniforms, original.uniforms);
  assert.strictEqual(sky.uniforms, originalSky.uniforms);
  assert.equal(sky.fog, originalSky.fog);
  assert.equal(city.version, original.version + 2);
  for (const material of [city, sky, race]) material.dispose();
  texture.dispose();
});

test("city atmosphere deduplicates map materials, keeps HUD untouched and restores fog on disposal", () => {
  const texture = new Texture(), geometry = new BoxGeometry();
  const map = createBasicTextureMaterial(texture, properties);
  const sky = createBasicTextureMaterial(texture, properties);
  const hud = createBasicTextureMaterial(texture, properties);
  const unsupported = new ShaderMaterial();
  const trackRoot = new Group(), skydomeRoot = new Group();
  trackRoot.add(new Mesh(geometry, map), new Mesh(geometry, map), new Mesh(geometry, unsupported));
  skydomeRoot.add(new Mesh(geometry, sky));
  const fog = new Fog(0xabcdef, 1100, 2000), color = fog.color.clone();
  const before = { vertex: map.vertexShader, fragment: map.fragmentShader,
    uniforms: map.uniforms, version: map.version, unsupportedVersion: unsupported.version };
  let textureDisposals = 0;
  texture.addEventListener("dispose", () => textureDisposals++);
  const atmosphere = new CityAtmosphere({ library: { files: [] }, scene: { fog },
    trackRoot, skydomeRoot, serverTick: now => now });
  assert.equal(map.version, before.version + 1);
  assert.equal(unsupported.version, before.unsupportedVersion);
  atmosphere.setClock(clock);
  atmosphere.update(0);
  assert.deepEqual(fog.color.toArray(), atmosphere.state!.fogColor);
  assert.equal(fog.near, atmosphere.state!.fogNear);
  assert.equal(fog.far, atmosphere.state!.fogFar);
  assert.equal(hud.uniforms.cityLightTint, undefined);
  assert.strictEqual(map.uniforms.cityDaylight, sky.uniforms.cityDaylight);
  assert.strictEqual(sky.uniforms.baseMap!.value, texture);

  atmosphere.dispose();
  assert.deepEqual(fog.color, color);
  assert.equal(fog.near, 1100);
  assert.equal(fog.far, 2000);
  assert.equal(map.vertexShader, before.vertex);
  assert.equal(map.fragmentShader, before.fragment);
  assert.strictEqual(map.uniforms, before.uniforms);
  assert.equal(sky.fog, true);
  const disposedVersion = map.version;
  atmosphere.dispose();
  atmosphere.setClock({ ...clock, timeOfDay: .5 });
  atmosphere.update(1000);
  assert.equal(map.version, disposedVersion);
  assert.deepEqual(fog.color, color);
  assert.equal(textureDisposals, 0);
  for (const material of [map, sky, hud, unsupported]) material.dispose();
  geometry.dispose();
  texture.dispose();
});
