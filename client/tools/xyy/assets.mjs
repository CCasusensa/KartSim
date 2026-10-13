// 喜羊羊赛道的 3D 摆件。原版 track_xyy_*.rho 缺失，只剩 theme_xyy 的贴图，
// 能看出原来的景物：羊角木门（tusukki00 / C_object_2B）、灰太狼热气球
// （s_ballon00）、狼堡紫色城墙（s_castle00/01、C_side_00/01）、风车
// （pungcha00）、草垛（C_straw）、手推车、喇叭、瞭望塔、喷泉……
// 这里用 Tripo 文生 3D 按跑跑卡丁车卡通风格重做，缓存在 design/xyy/tripo/
// （git LFS），生成不可复现，同一个 id 不会重复生成。
//
// 卡丁城已经生成过的通用摆件（树、风车、花坛、蘑菇、石头……）直接复用
// design/open-world/tripo/ 里的，见 REUSED。
//
//   cd client && node tools/xyy/assets.mjs [--concurrency 3] [--only id,id] [--force]
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TRIPO_DIR, ensureModel } from "../city/blender/tripo.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const XYY_TRIPO_DIR = path.join(clientDir, "..", "design", "xyy", "tripo");
export const CITY_TRIPO_DIR = TRIPO_DIR;

const STYLE = {
  sheep: "in the art style of the game KartRider (跑跑卡丁车): a cheerful cartoon sheep village on a green meadow, cute chunky simplified shapes, bright pastel hand-painted colors, clean flat textures",
  wolf: "in the art style of the game KartRider (跑跑卡丁车): a spooky but cute cartoon wolf castle, chunky simplified shapes, dark grey stone and purple hand-painted colors, clean flat textures",
};
const SUFFIX = "game-ready prop, single isolated object, centered, no ground plane, no base, no text, no people, no characters";
const NEGATIVE = "realistic, photorealistic, text, letters, watermark, ground plane, base, scenery, multiple objects, people, characters, animals";

/**
 * size: [x, y, z] 米（模型朝 +x），等比缩放到装进这个盒子。
 * collider: 摆在路边时给的碰撞（box / post / none）。
 */
export const ASSETS = [
  { id: "x_house_a", theme: "sheep", what: "a cute round cottage with a fluffy white wool-like roof and a pair of big curly brown ram horns on the roof, cream walls, a round wooden door and round windows", size: [13, 13, 12], collider: "box", faces: 2500 },
  { id: "x_house_b", theme: "sheep", what: "a cute two-story cottage with a pink tiled roof decorated with a pair of curly ram horns, light yellow walls, round windows and a small brick chimney", size: [13, 11, 14], collider: "box", faces: 2500 },
  { id: "x_house_c", theme: "sheep", what: "a cute tall round tower house with a sky blue cone roof, white walls, a wooden door and a little sheep-shaped weathervane on the top", size: [9, 9, 20], collider: "box", faces: 2500 },
  { id: "x_school", theme: "sheep", what: "a small cute village schoolhouse with a bell tower, a big round clock and curly ram horn decorations on the roof, white walls and a green roof", size: [22, 14, 18], collider: "box", faces: 3000 },
  { id: "x_horns", theme: "sheep", what: "a pair of giant curly brown ram horns joined by a carved wooden plank, decorative village gate ornament", size: [16, 3, 7], collider: "none", faces: 1500 },
  { id: "x_hay", theme: "sheep", what: "a stack of three round golden hay bales", size: [6, 4, 3.6], collider: "box", faces: 1000 },
  { id: "x_cart", theme: "sheep", what: "a wooden farm hand cart with two big spoked wheels loaded with fresh green grass", size: [5, 2.6, 2.6], collider: "box", faces: 1200 },
  { id: "x_well", theme: "sheep", what: "a cute round stone water well with a small wooden roof, a crank and a bucket", size: [4.5, 4.5, 5.5], collider: "post", faces: 1200 },
  { id: "x_sheepbush", theme: "sheep", what: "a green topiary hedge bush trimmed into the shape of a cute fluffy sheep", size: [5, 3, 4], collider: "box", faces: 1000 },
  { id: "x_bigtree", theme: "sheep", what: "a huge cartoon broadleaf tree with a thick twisted trunk and a round bright green canopy", size: [22, 22, 26], collider: "post", faces: 1500 },
  { id: "x_flowers", theme: "sheep", what: "a cluster of giant cartoon daisies and pink tulips with big leaves", size: [6, 6, 4], collider: "none", faces: 1000 },
  { id: "x_signpost", theme: "sheep", what: "a wooden signpost with three blank arrow-shaped boards pointing in different directions", size: [3, 2.5, 5], collider: "post", faces: 600 },
  { id: "x_scarecrow", theme: "sheep", what: "a cute scarecrow made of straw wearing a straw hat and a patched shirt on a wooden pole", size: [3, 1.5, 5], collider: "post", faces: 800 },
  { id: "x_megaphone", theme: "sheep", what: "a tall wooden pole with a big red loudspeaker horn on top", size: [2.5, 2.5, 8], collider: "post", faces: 600 },
  { id: "x_balloon", theme: "wolf", what: "a single purple hot air balloon floating in the air with a cartoon grey wolf face painted on it and a small wicker basket hanging under it by ropes, nothing else, no buildings", size: [11, 11, 17], collider: "none", faces: 1500 },
  { id: "w_castle", theme: "wolf", what: "a cartoon wolf castle made of dark grey stone with several towers with purple pointed roofs and a big grey wolf head sculpture with pointy ears above the front gate", size: [70, 50, 55], collider: "box", faces: 4000 },
  { id: "w_tower", theme: "wolf", what: "a tall dark grey stone castle watchtower with a purple pointed roof, a small balcony and glowing yellow windows", size: [11, 11, 32], collider: "post", faces: 1500 },
  { id: "w_wall", theme: "wolf", what: "a straight section of dark grey stone castle wall with purple battlements", size: [24, 4, 9], collider: "box", faces: 1000 },
  { id: "w_pot", theme: "wolf", what: "a big black iron cooking cauldron on a pile of burning firewood", size: [5, 5, 4], collider: "post", faces: 1000 },
  { id: "w_deadtree", theme: "wolf", what: "a twisted dead tree with bare dark purple branches", size: [10, 10, 14], collider: "post", faces: 1000 },
  { id: "w_lamp", theme: "wolf", what: "a spooky iron lamp post with a purple glowing lantern", size: [2, 2, 7], collider: "post", faces: 600 },
];

/** 卡丁城已经生成的通用摆件，直接复用（id → 目录）。 */
export const REUSED = {
  v_tree: "village", v_tree_pink: "village", v_flowerbed: "village", v_windmill: "village",
  v_fountain: "village", v_lamp: "village", v_bench: "village",
  f_oak: "forest", f_pine_a: "forest", f_pine_b: "forest", f_mushroom: "forest", f_rock: "forest",
  f_stump: "forest", f_tower: "forest", f_cabin: "forest",
};

export function promptOf(asset) {
  return `${asset.what}, ${STYLE[asset.theme]}, ${SUFFIX}`;
}

export function optionsOf(asset, model = "P1-20260311") {
  return { model, face_limit: asset.faces, texture: true, pbr: false, auto_size: true, negative_prompt: NEGATIVE };
}

/** 摆件 id → GLB 路径。 */
export function assetFile(id) {
  return path.join(id in REUSED ? CITY_TRIPO_DIR : XYY_TRIPO_DIR, `${id}.glb`);
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const concurrency = Number(option("--concurrency") ?? 3);
  const only = option("--only")?.split(",");
  const force = args.includes("--force");
  const queue = ASSETS.filter(a => !only || only.includes(a.id));
  const failed = [];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const asset = queue[next++];
      try {
        const r = await ensureModel(asset.id, promptOf(asset), optionsOf(asset), { force, dir: XYY_TRIPO_DIR, log: line => console.log(`[${asset.id}] ${line}`) });
        console.log(`[${asset.id}] ${r.cached ? "cached" : "done"} ${r.entry.bytes} bytes`);
      } catch (error) {
        console.error(`[${asset.id}] failed: ${error.message}`);
        failed.push(asset.id);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`assets: ${queue.length - failed.length} ok, ${failed.length} failed${failed.length ? ` (${failed.join(", ")})` : ""}`);
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
