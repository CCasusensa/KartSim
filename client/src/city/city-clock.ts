/**
 * Day/night and weather state derived from the node's city clock: the
 * browser keeps the last `city-clock` and extrapolates with its own clock
 * synchronisation (serverTick is the node's monotonic millisecond clock).
 */
import type { CityClock, CityWeather } from "./city-protocol";

export interface SkyState {
  /** 0 = midnight, 0.5 = noon. */
  timeOfDay: number;
  /** 0 at night, 1 in full daylight. */
  daylight: number;
  /** Sun elevation in degrees (negative below the horizon). */
  sunElevation: number;
  /** Fog / sky tint for the moment, 0–1 RGB. */
  skyColor: [number, number, number];
  fogColor: [number, number, number];
  /** RGB illumination multiplier; warm daylight may exceed 1 in red. */
  lightTint: [number, number, number];
  horizonColor: [number, number, number];
  /** Unit direction toward the sun, in world coordinates with Y up. */
  sunDirection: [number, number, number];
  sunStrength: number;
  /** World-space fog distances in metres. */
  fogNear: number;
  fogFar: number;
  /** Scene light factor applied to materials (0.42 at night, 1 by day). */
  lightFactor: number;
  weather: CityWeather;
  /** 0–1 intensity of the current precipitation (fades in/out around transitions). */
  precipitation: number;
}

const DAY_SKY: [number, number, number] = [0.5, 0.83, 0.76];
const DUSK_SKY: [number, number, number] = [0.88, 0.62, 0.36];
const NIGHT_SKY: [number, number, number] = [0.07, 0.09, 0.16];
const RAIN_SKY: [number, number, number] = [0.43, 0.58, 0.55];
const DAY_FOG: [number, number, number] = [0.77, 0.74, 0.55];
const DUSK_FOG: [number, number, number] = [0.73, 0.52, 0.34];
const NIGHT_FOG: [number, number, number] = [0.1, 0.12, 0.2];
const RAIN_FOG: [number, number, number] = [0.51, 0.57, 0.51];
const DAY_LIGHT: [number, number, number] = [1.13, 0.98, 0.68];
const WARM_LIGHT: [number, number, number] = [1.18, 0.9, 0.59];
const NIGHT_LIGHT: [number, number, number] = [0.72, 0.83, 1.06];
const RAIN_LIGHT: [number, number, number] = [0.92, 0.96, 0.88];
const DAY_HORIZON: [number, number, number] = [0.94, 0.91, 0.66];
const DUSK_HORIZON: [number, number, number] = [1, 0.72, 0.4];
const NIGHT_HORIZON: [number, number, number] = [0.12, 0.16, 0.23];
const RAIN_HORIZON: [number, number, number] = [0.66, 0.72, 0.68];

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Time of day at `serverTick`, from the last clock message. */
export function timeOfDayAt(clock: CityClock, serverTick: number): number {
  const elapsed = serverTick - clock.serverTick;
  const t = clock.timeOfDay + elapsed / clock.dayLengthMs;
  return ((t % 1) + 1) % 1;
}

/** Daylight curve: dawn 0.21–0.29, dusk 0.71–0.79. */
export function daylightAt(timeOfDay: number): number {
  return smooth(0.21, 0.29, timeOfDay) * (1 - smooth(0.71, 0.79, timeOfDay));
}

export function skyStateAt(clock: CityClock, serverTick: number, weatherFade = 8000): SkyState {
  const timeOfDay = timeOfDayAt(clock, serverTick);
  const daylight = daylightAt(timeOfDay);
  const sunAngle = (timeOfDay - 0.25) * Math.PI * 2;
  const sunHeight = Math.sin(sunAngle);
  const sunElevation = sunHeight * 90;
  const sunDirection: [number, number, number] = [
    Math.cos(sunAngle) * Math.cos(0.3), sunHeight, Math.cos(sunAngle) * Math.sin(0.3),
  ];
  // Warm band around sunrise and sunset.
  const dusk = Math.max(smooth(0.17, 0.24, timeOfDay) * (1 - smooth(0.26, 0.33, timeOfDay)),
    smooth(0.67, 0.74, timeOfDay) * (1 - smooth(0.76, 0.83, timeOfDay)));
  let skyColor = mix(NIGHT_SKY, DAY_SKY, daylight);
  let fogColor = mix(NIGHT_FOG, DAY_FOG, daylight);
  let horizonColor = mix(NIGHT_HORIZON, DAY_HORIZON, daylight);
  const afternoon = smooth(0.5, 0.67, timeOfDay) * (1 - smooth(0.7, 0.79, timeOfDay));
  let lightTint = mix(mix(NIGHT_LIGHT, DAY_LIGHT, daylight), WARM_LIGHT,
    Math.max(dusk * 0.75, afternoon * 0.35));
  skyColor = mix(skyColor, DUSK_SKY, dusk * 0.8);
  fogColor = mix(fogColor, DUSK_FOG, dusk * 0.6);
  horizonColor = mix(horizonColor, DUSK_HORIZON, dusk * 0.6);
  const untilMs = clock.weatherUntilTick - serverTick;
  const precipitation = clock.weather === "clear" ? 0
    : clamp01(Math.min((serverTick - clock.serverTick + weatherFade) / weatherFade, untilMs / weatherFade));
  if (precipitation > 0) {
    skyColor = mix(skyColor, mix(NIGHT_SKY, RAIN_SKY, daylight), precipitation * 0.75);
    fogColor = mix(fogColor, mix(NIGHT_FOG, RAIN_FOG, daylight), precipitation * 0.7);
    horizonColor = mix(horizonColor, mix(NIGHT_HORIZON, RAIN_HORIZON, daylight), precipitation * 0.7);
    lightTint = mix(lightTint, mix(NIGHT_LIGHT, RAIN_LIGHT, daylight), precipitation * 0.7);
  }
  const sunStrength = 0.22 * daylight * smooth(0, 0.3, sunHeight) * (1 - 0.78 * precipitation);
  const clearFogNear = 80 + 40 * daylight;
  const clearFogFar = 850 + 250 * daylight;
  const fogNear = clearFogNear + (70 - clearFogNear) * precipitation;
  const fogFar = clearFogFar + (700 - clearFogFar) * precipitation;
  // Nights stay readable (street lights come later): never below 0.42.
  const lightFactor = 0.42 + 0.58 * daylight - 0.15 * precipitation * daylight;
  return { timeOfDay, daylight, sunElevation, skyColor, fogColor, lightTint, horizonColor,
    sunDirection, sunStrength, fogNear, fogFar, lightFactor, weather: clock.weather, precipitation };
}

/** "06:30" style label for the HUD. */
export function clockLabel(timeOfDay: number): string {
  const minutes = Math.floor(((timeOfDay % 1) + 1) % 1 * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
