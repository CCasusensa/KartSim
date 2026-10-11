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
  /** Scene light factor applied to materials (0.25 at night, 1 by day). */
  lightFactor: number;
  weather: CityWeather;
  /** 0–1 intensity of the current precipitation (fades in/out around transitions). */
  precipitation: number;
}

const DAY_SKY: [number, number, number] = [0.74, 0.81, 0.9];
const DUSK_SKY: [number, number, number] = [0.95, 0.6, 0.38];
const NIGHT_SKY: [number, number, number] = [0.07, 0.09, 0.16];
const DAY_FOG: [number, number, number] = [188 / 255, 206 / 255, 228 / 255];
const DUSK_FOG: [number, number, number] = [0.8, 0.55, 0.42];
const NIGHT_FOG: [number, number, number] = [0.1, 0.12, 0.2];
const RAIN_FOG: [number, number, number] = [0.45, 0.5, 0.56];

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
  const sunElevation = Math.sin((timeOfDay - 0.25) * Math.PI * 2) * 90;
  // Warm band around sunrise and sunset.
  const dusk = Math.max(smooth(0.17, 0.24, timeOfDay) * (1 - smooth(0.26, 0.33, timeOfDay)),
    smooth(0.67, 0.74, timeOfDay) * (1 - smooth(0.76, 0.83, timeOfDay)));
  let skyColor = mix(NIGHT_SKY, DAY_SKY, daylight);
  let fogColor = mix(NIGHT_FOG, DAY_FOG, daylight);
  skyColor = mix(skyColor, DUSK_SKY, dusk * 0.8);
  fogColor = mix(fogColor, DUSK_FOG, dusk * 0.6);
  const untilMs = clock.weatherUntilTick - serverTick;
  const precipitation = clock.weather === "clear" ? 0
    : clamp01(Math.min((serverTick - clock.serverTick + weatherFade) / weatherFade, untilMs / weatherFade));
  if (precipitation > 0) fogColor = mix(fogColor, mix(RAIN_FOG, NIGHT_FOG, 1 - daylight), precipitation * 0.7);
  const lightFactor = 0.28 + 0.72 * daylight - 0.15 * precipitation * daylight;
  return { timeOfDay, daylight, sunElevation, skyColor, fogColor, lightFactor, weather: clock.weather, precipitation };
}

/** "06:30" style label for the HUD. */
export function clockLabel(timeOfDay: number): string {
  const minutes = Math.floor(((timeOfDay % 1) + 1) % 1 * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
