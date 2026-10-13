/**
 * 数据服务的自制地图接口（server-go/MAPS.md）：列出已发布地图、下载赛道包、
 * 发布和删除。发布需要登录（Bearer 会话令牌，与游戏共用）。
 */
import { readServiceJson, serviceFetch, type FetchLike } from "../account/account-api";
import { tokenAccess } from "../account/account-token-store";
import type { MapDesign } from "./design";
import type { CustomMapFile, CustomMapSummary } from "./custom-tracks";

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** 数据服务地址：游戏的联机配置，否则同源。 */
export function dataServiceOrigin(): string {
  const configured = typeof window !== "undefined" ? window.__KART_MULTIPLAYER_CONFIG__?.backendOrigin : undefined;
  return configured ?? (typeof location !== "undefined" ? location.origin : "http://127.0.0.1:8787");
}

export function storedSessionToken(origin = dataServiceOrigin()): string | undefined {
  try { return tokenAccess().load(origin); } catch { return undefined; }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** 校验服务端返回的地图摘要。 */
export function parseMapSummary(value: unknown): CustomMapSummary {
  if (!record(value)) throw new Error("INVALID_MAP");
  const text = (key: string) => typeof value[key] === "string" ? value[key] as string : "";
  const number = (key: string) => typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : 0;
  const files = Array.isArray(value.files) ? value.files.flatMap((file): CustomMapFile[] =>
    record(file) && typeof file.path === "string" && /^[A-Za-z0-9_@\-\.]{1,80}$/.test(file.path) &&
    typeof file.size === "number" ? [{ path: file.path, size: file.size }] : []) : [];
  const id = text("id");
  if (!/^[0-9a-z]{6,16}$/.test(id) || !files.some(file => file.path === "track.1s")) throw new Error("INVALID_MAP");
  return {
    id, name: text("name") || id, author: text("author"), theme: text("theme") || "village",
    laps: Math.max(1, Math.round(number("laps")) || 3), difficulty: Math.max(1, Math.round(number("difficulty")) || 2),
    roadExtent: Math.max(100, number("roadExtent")), sha256: text("sha256"), size: number("size"),
    items: Math.max(0, Math.round(number("items"))),
    files, updatedAt: number("updatedAt"), source: "server",
  };
}

export async function listPublishedMaps(origin = dataServiceOrigin(), fetchImpl = defaultFetch): Promise<CustomMapSummary[]> {
  const body = await readServiceJson(await serviceFetch(fetchImpl, `${origin}/api/maps`));
  const maps = record(body) && Array.isArray(body.maps) ? body.maps : [];
  return maps.flatMap(map => { try { return [parseMapSummary(map)]; } catch { return []; } });
}

export async function fetchMapSummary(id: string, origin = dataServiceOrigin(), fetchImpl = defaultFetch): Promise<CustomMapSummary> {
  return parseMapSummary(await readServiceJson(await serviceFetch(fetchImpl, `${origin}/api/maps/${encodeURIComponent(id)}`)));
}

export async function listMyMaps(token: string, origin = dataServiceOrigin(), fetchImpl = defaultFetch): Promise<CustomMapSummary[]> {
  const body = await readServiceJson(await serviceFetch(fetchImpl, `${origin}/api/maps/mine`,
    { headers: { Authorization: `Bearer ${token}` } }));
  const maps = record(body) && Array.isArray(body.maps) ? body.maps : [];
  return maps.flatMap(map => { try { return [parseMapSummary(map)]; } catch { return []; } });
}

export async function fetchMapDesign(id: string, origin = dataServiceOrigin(), fetchImpl = defaultFetch): Promise<string> {
  const response = await serviceFetch(fetchImpl, `${origin}/api/maps/${encodeURIComponent(id)}/design`);
  if (!response.ok) await readServiceJson(response);
  return response.text();
}

export function mapFileUrl(summary: CustomMapSummary, file: "container" | "card" | "thumb", origin = dataServiceOrigin()): string {
  return `${origin}/api/maps/${encodeURIComponent(summary.id)}/${file}?v=${encodeURIComponent(summary.sha256)}`;
}

export async function downloadMapFile(summary: CustomMapSummary, file: "container" | "card" | "thumb",
  origin = dataServiceOrigin(), fetchImpl = defaultFetch): Promise<Uint8Array> {
  const response = await serviceFetch(fetchImpl, mapFileUrl(summary, file, origin));
  if (!response.ok) await readServiceJson(response);
  return new Uint8Array(await response.arrayBuffer());
}

export interface PublishInput {
  design: MapDesign;
  summary: Omit<CustomMapSummary, "author" | "updatedAt" | "source">;
  container: Uint8Array;
  card: Uint8Array;
  thumb: Uint8Array;
}

/** 上传赛道包与设计文件；同 id 再次发布即更新（只限作者）。 */
export async function publishMap(input: PublishInput, token: string, origin = dataServiceOrigin(),
  fetchImpl = defaultFetch): Promise<CustomMapSummary> {
  const form = new FormData();
  const { id, name, theme, laps, difficulty, roadExtent, items, files } = input.summary;
  form.set("meta", JSON.stringify({ id, name, theme, laps, difficulty, roadExtent, items, files }));
  form.set("design", new Blob([JSON.stringify(input.design)], { type: "application/json" }), "design.json");
  form.set("container", new Blob([input.container as BlobPart], { type: "application/octet-stream" }), `track_custom_${id}.rho`);
  form.set("card", new Blob([input.card as BlobPart], { type: "image/png" }), "card.png");
  form.set("thumb", new Blob([input.thumb as BlobPart], { type: "image/png" }), "thumb.png");
  const body = await readServiceJson(await serviceFetch(fetchImpl, `${origin}/api/maps/${encodeURIComponent(id)}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  }));
  return parseMapSummary(body);
}

export async function deleteMap(id: string, token: string, origin = dataServiceOrigin(), fetchImpl = defaultFetch): Promise<void> {
  await readServiceJson(await serviceFetch(fetchImpl, `${origin}/api/maps/${encodeURIComponent(id)}/delete`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` },
  }));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
