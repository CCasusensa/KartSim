/**
 * Day/night and weather in 卡丁城: fog colour, the basic materials' light
 * factor, the skydome texture (day/dusk/night) and the rain/snow effects,
 * driven by the node's city clock.
 */
import { Color, SRGBColorSpace, Texture, TextureLoader, type Object3D, type ShaderMaterial } from "three";
import type { CityClock } from "./city-protocol";
import { skyStateAt, type SkyState } from "./city-clock";
import { createCityLightUniforms, installCityMaterialLighting, updateCityLightUniforms } from "./city-material-lighting";

interface LibraryFile { virtualPath: string; bytes(): Promise<Uint8Array> }
interface Library { files: readonly LibraryFile[] }

export interface CityAtmosphereHost {
  library: Library;
  scene: { fog?: { color: Color; near?: number; far?: number } | null };
  trackRoot: Object3D;
  skydomeRoot?: Object3D;
  rain?: { setEnabled(enabled: boolean): void };
  rainAudio?: { setRainEnabled(enabled: boolean): void };
  snow?: { setEnabled(enabled: boolean): void };
  /** Local → server tick. */
  serverTick(now: number): number;
}

type SkyKind = "day" | "dusk" | "night";

export class CityAtmosphere {
  clock?: CityClock;
  private materials: Array<{ uniforms: Record<string, { value: unknown }> }> = [];
  private skyMaterials: Array<{ uniforms: Record<string, { value: unknown }> }> = [];
  private dayTexture?: unknown;
  private readonly skyTextures = new Map<SkyKind, Promise<Texture | undefined>>();
  private currentSky?: SkyKind;
  private lastApplied = -Infinity;
  private rainOn = false;
  private snowOn = false;
  private disposed = false;
  private readonly lightUniforms = createCityLightUniforms();
  private readonly restoreMaterials: Array<() => void> = [];
  private readonly originalFog;
  state?: SkyState;

  constructor(readonly host: CityAtmosphereHost) {
    const fog = host.scene.fog;
    this.originalFog = fog ? { color: fog.color.clone(), near: fog.near, far: fog.far } : undefined;
    this.collect();
    for (const [materials, sky] of [[this.materials, false], [this.skyMaterials, true]] as const) {
      for (const material of materials) {
        const restore = installCityMaterialLighting(material as ShaderMaterial, this.lightUniforms, sky);
        if (restore) this.restoreMaterials.push(restore);
      }
    }
  }

  private collect(): void {
    const seen = new Set<unknown>();
    const grab = (root: Object3D | undefined, into: typeof this.materials) => {
      root?.traverse((object: any) => {
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of materials) {
          if (!material?.uniforms || seen.has(material)) continue;
          seen.add(material);
          into.push(material);
        }
      });
    };
    grab(this.host.trackRoot, this.materials);
    grab(this.host.skydomeRoot, this.skyMaterials);
    const sky = this.skyMaterials.find(material => material.uniforms.baseMap);
    this.dayTexture = sky?.uniforms.baseMap?.value;
  }

  setClock(clock: CityClock): void { this.clock = clock; this.lastApplied = -Infinity; }

  update(now: number): void {
    if (this.disposed || !this.clock || now - this.lastApplied < 250) return;
    this.lastApplied = now;
    const state = skyStateAt(this.clock, this.host.serverTick(now));
    this.state = state;
    const fog = this.host.scene.fog;
    if (fog) {
      fog.color.setRGB(...state.fogColor);
      if (fog.near !== undefined) fog.near = state.fogNear;
      if (fog.far !== undefined) fog.far = state.fogFar;
    }
    updateCityLightUniforms(this.lightUniforms, state);
    for (const material of this.materials) {
      const uniform = material.uniforms.lightFactor;
      if (uniform) uniform.value = state.lightFactor;
    }
    const skyLight = Math.max(0.35, state.lightFactor);
    for (const material of this.skyMaterials) {
      const uniform = material.uniforms.lightFactor;
      if (uniform) uniform.value = skyLight;
    }
    const kind: SkyKind = state.daylight > 0.7 ? "day" : state.daylight > 0.15 ? "dusk" : "night";
    if (kind !== this.currentSky) { this.currentSky = kind; void this.applySky(kind); }
    const rain = state.weather === "rain" && state.precipitation > 0.05;
    const snow = state.weather === "snow" && state.precipitation > 0.05;
    if (rain !== this.rainOn) { this.rainOn = rain; this.host.rain?.setEnabled(rain); this.host.rainAudio?.setRainEnabled(rain); }
    if (snow !== this.snowOn) { this.snowOn = snow; this.host.snow?.setEnabled(snow); }
  }

  private skyTexture(kind: SkyKind): Promise<Texture | undefined> {
    let pending = this.skyTextures.get(kind);
    if (pending) return pending;
    pending = (async () => {
      const stem = kind === "dusk" ? "kartcity_sky_dusk" : "kartcity_sky_night";
      const file = this.host.library.files.find(entry =>
        entry.virtualPath.toLowerCase() === `track_kartcity/${stem}.png`);
      if (!file) return undefined;
      const bytes = await file.bytes();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      try {
        const texture = await new TextureLoader().loadAsync(url);
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = (this.dayTexture as Texture | undefined)?.flipY ?? true;
        texture.wrapS = (this.dayTexture as Texture | undefined)?.wrapS ?? texture.wrapS;
        texture.wrapT = (this.dayTexture as Texture | undefined)?.wrapT ?? texture.wrapT;
        texture.needsUpdate = true;
        return texture;
      } finally { URL.revokeObjectURL(url); }
    })();
    this.skyTextures.set(kind, pending);
    return pending;
  }

  private async applySky(kind: SkyKind): Promise<void> {
    const texture = kind === "day" ? this.dayTexture : await this.skyTexture(kind);
    if (this.disposed || this.currentSky !== kind) return;
    for (const material of this.skyMaterials) {
      if (material.uniforms.baseMap && texture) material.uniforms.baseMap.value = texture;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const restore of this.restoreMaterials) restore();
    this.restoreMaterials.length = 0;
    const fog = this.host.scene.fog;
    if (fog && this.originalFog) {
      fog.color.copy(this.originalFog.color);
      if (this.originalFog.near !== undefined) fog.near = this.originalFog.near;
      if (this.originalFog.far !== undefined) fog.far = this.originalFog.far;
    }
    for (const pending of this.skyTextures.values()) void pending.then(texture => texture?.dispose());
    this.skyTextures.clear();
  }
}
