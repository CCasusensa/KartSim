// The 3D props of 卡丁城 v3, generated with Tripo (text-to-model) in the
// art styles of 跑跑卡丁车's themes. Each asset: id, theme, what it is, the
// size it is scaled to in Blender (metres), the collider the city gives it
// and the face budget asked from Tripo. Prompts are English (the generator
// understands it best); the style suffix keeps everything consistent.
export const STYLE = {
  village: "in the art style of the game KartRider (跑跑卡丁车) village theme: cute cartoon, chunky simplified shapes, bright saturated hand-painted colors, clean flat textures",
  forest: "in the art style of the game KartRider (跑跑卡丁车) forest theme: cute cartoon, chunky simplified shapes, lush green hand-painted colors, clean flat textures",
  ice: "in the art style of the game KartRider (跑跑卡丁车) ice theme: cute cartoon, chunky simplified shapes, cool blue and white hand-painted colors, clean flat textures",
  desert: "in the art style of the game KartRider (跑跑卡丁车) desert theme: cute cartoon, chunky simplified shapes, warm sand and terracotta hand-painted colors, clean flat textures",
  beach: "in the art style of the game KartRider (跑跑卡丁车) beach theme: cute cartoon, chunky simplified shapes, bright tropical hand-painted colors, clean flat textures",
  city: "in the art style of the game KartRider (跑跑卡丁车) city theme: cute cartoon, chunky simplified low-poly shapes, bright clean colors, flat hand-painted textures",
};
export const SUFFIX = "game-ready prop, single isolated object, centered, no ground plane, no base, no text, no people";
export const NEGATIVE = "realistic, photorealistic, text, letters, watermark, ground plane, base, scenery, multiple objects, people";

/** size: [x, y, z] in metres (the model faces +x); scaled uniformly to fit inside, or per axis when fit is "stretch". */
export const ASSETS = [
  // 城镇 village — the plaza and the main streets
  { id: "v_house_a", theme: "village", what: "a small two-story village house with an orange tiled roof, cream walls, a blue door and blue windows", size: [14, 12, 12], collider: "box", faces: 2500 },
  { id: "v_house_b", theme: "village", what: "a small village house with a green roof, yellow walls, round windows and a brick chimney", size: [13, 11, 11], collider: "box", faces: 2500 },
  { id: "v_house_c", theme: "village", what: "a cozy village cottage with a red roof, white walls, a wooden door and flower boxes under the windows", size: [12, 10, 10], collider: "box", faces: 2500 },
  { id: "v_house_d", theme: "village", what: "a narrow three-story townhouse with a purple roof, pink walls and a balcony", size: [10, 10, 16], collider: "box", faces: 2500 },
  { id: "v_shop", theme: "village", what: "a small village bakery shop with a striped awning, a big display window and a round sign board", size: [14, 12, 10], collider: "box", faces: 2500 },
  { id: "v_cafe", theme: "village", what: "a small corner cafe with outdoor tables, umbrellas and a blue awning", size: [14, 12, 9], collider: "box", faces: 2500 },
  { id: "v_clocktower", theme: "village", what: "a tall village clock tower with a big clock face, a bell and a pointed copper roof", size: [12, 12, 42], collider: "box", faces: 3000 },
  { id: "v_fountain", theme: "village", what: "a round stone plaza fountain with three tiers and water jets", size: [22, 22, 9], collider: "cylinder", faces: 2500 },
  { id: "v_lamp", theme: "village", what: "a vintage iron street lamp post with two glass lanterns", size: [2, 2, 8], collider: "post", faces: 600 },
  { id: "v_bench", theme: "village", what: "a wooden park bench with iron legs", size: [3, 1.2, 1.2], collider: "box", faces: 400 },
  { id: "v_tree", theme: "village", what: "a round cartoon tree with a thick brown trunk and fluffy green leaves", size: [10, 10, 12], collider: "post", faces: 900 },
  { id: "v_tree_pink", theme: "village", what: "a round cartoon cherry blossom tree with pink fluffy leaves", size: [10, 10, 11], collider: "post", faces: 900 },
  { id: "v_flowerbed", theme: "village", what: "a round flower bed with red and yellow tulips inside a low stone border", size: [6, 6, 1.2], collider: "none", faces: 800 },
  { id: "v_busstop", theme: "village", what: "a small bus stop shelter with a bench and a round sign", size: [6, 2.5, 3.5], collider: "box", faces: 800 },
  { id: "v_gate", theme: "village", what: "a decorative town entrance arch gate with two stone pillars, a curved top and colorful flags", size: [20, 3, 12], collider: "none", faces: 1500 },
  { id: "v_windmill", theme: "village", what: "a dutch windmill with a stone base, a red roof and four wooden blades", size: [16, 16, 30], collider: "cylinder", faces: 2000 },
  { id: "v_mailbox", theme: "village", what: "a red round-top mailbox", size: [1, 1, 1.6], collider: "post", faces: 300 },
  // 森林 forest
  { id: "f_pine_a", theme: "forest", what: "a tall cartoon pine tree with three layers of green foliage", size: [9, 9, 20], collider: "post", faces: 900 },
  { id: "f_pine_b", theme: "forest", what: "a short bushy cartoon pine tree", size: [8, 8, 12], collider: "post", faces: 800 },
  { id: "f_oak", theme: "forest", what: "a big old oak tree with a wide canopy and exposed roots", size: [18, 18, 18], collider: "post", faces: 1200 },
  { id: "f_cabin", theme: "forest", what: "a wooden log cabin with a stone chimney and a small front porch", size: [16, 12, 9], collider: "box", faces: 2500 },
  { id: "f_mushroom", theme: "forest", what: "a giant red mushroom with white spots", size: [8, 8, 10], collider: "cylinder", faces: 700 },
  { id: "f_rock", theme: "forest", what: "a cluster of mossy grey boulders", size: [9, 7, 4], collider: "box", faces: 700 },
  { id: "f_stump", theme: "forest", what: "a large tree stump with an axe stuck in it", size: [3, 3, 2], collider: "cylinder", faces: 500 },
  { id: "f_tower", theme: "forest", what: "a wooden forest watchtower with a ladder and a covered lookout platform", size: [8, 8, 24], collider: "box", faces: 2000 },
  { id: "f_totem", theme: "forest", what: "a carved wooden totem pole with owl and bear faces", size: [2.5, 2.5, 9], collider: "post", faces: 900 },
  // 冰河 ice
  { id: "i_igloo", theme: "ice", what: "a snow igloo with a short entrance tunnel", size: [12, 12, 6], collider: "cylinder", faces: 1200 },
  { id: "i_pine", theme: "ice", what: "a cartoon pine tree covered in thick snow", size: [8, 8, 15], collider: "post", faces: 900 },
  { id: "i_snowman", theme: "ice", what: "a cheerful snowman with a carrot nose, a red scarf and a top hat", size: [4, 4, 6], collider: "post", faces: 800 },
  { id: "i_crystal", theme: "ice", what: "a cluster of tall glowing blue ice crystals", size: [8, 8, 11], collider: "box", faces: 800 },
  { id: "i_castle", theme: "ice", what: "a small ice castle with blue crystal towers, a gate and snowy walls", size: [40, 36, 34], collider: "box", faces: 4000 },
  { id: "i_penguin", theme: "ice", what: "a cute penguin statue standing on a round ice pedestal", size: [4, 4, 6], collider: "cylinder", faces: 800 },
  { id: "i_lodge", theme: "ice", what: "a cozy alpine wooden lodge with a snow-covered roof and warm windows", size: [18, 14, 11], collider: "box", faces: 2500 },
  { id: "i_iceblock", theme: "ice", what: "a big translucent blue ice boulder", size: [6, 5, 4], collider: "box", faces: 500 },
  // 沙漠 desert
  { id: "d_pyramid", theme: "desert", what: "a large sandstone pyramid with stepped stone blocks", size: [60, 60, 40], collider: "box", faces: 1500 },
  { id: "d_sphinx", theme: "desert", what: "a cartoon sphinx statue lying on a stone base", size: [24, 10, 12], collider: "box", faces: 2500 },
  { id: "d_cactus_a", theme: "desert", what: "a tall green saguaro cactus with two arms", size: [4, 4, 8], collider: "post", faces: 600 },
  { id: "d_cactus_b", theme: "desert", what: "a round barrel cactus with a pink flower on top", size: [3, 3, 3], collider: "post", faces: 500 },
  { id: "d_palm", theme: "desert", what: "a cartoon palm tree with coconuts and big fronds", size: [10, 10, 14], collider: "post", faces: 900 },
  { id: "d_house", theme: "desert", what: "an adobe clay desert house with a flat roof, a wooden door and small windows", size: [14, 12, 8], collider: "box", faces: 2000 },
  { id: "d_obelisk", theme: "desert", what: "a tall sandstone obelisk with carved hieroglyph patterns", size: [3, 3, 16], collider: "post", faces: 600 },
  { id: "d_rock", theme: "desert", what: "a smooth red desert rock arch formation", size: [16, 8, 10], collider: "box", faces: 1000 },
  { id: "d_market", theme: "desert", what: "a desert market stall with a striped canopy and baskets of fruit", size: [8, 6, 5], collider: "box", faces: 1200 },
  // 海滩 beach
  { id: "b_lighthouse", theme: "beach", what: "a red and white striped lighthouse with a glass lantern room on top", size: [10, 10, 40], collider: "cylinder", faces: 2000 },
  { id: "b_hut", theme: "beach", what: "a tropical beach hut with a straw roof and bamboo walls", size: [10, 9, 7], collider: "box", faces: 1500 },
  { id: "b_palm", theme: "beach", what: "a leaning cartoon coconut palm tree", size: [10, 8, 14], collider: "post", faces: 900 },
  { id: "b_boat", theme: "beach", what: "a small wooden fishing boat with a blue and white hull", size: [8, 3, 3], collider: "box", faces: 1000 },
  { id: "b_umbrella", theme: "beach", what: "a striped beach umbrella with a wooden lounge chair", size: [4, 4, 3.5], collider: "none", faces: 700 },
  { id: "b_surfshop", theme: "beach", what: "a colorful surf shop shack with surfboards leaning against the wall", size: [14, 10, 8], collider: "box", faces: 2500 },
  { id: "b_lifeguard", theme: "beach", what: "a tall wooden lifeguard tower with a red roof and a ladder", size: [5, 5, 9], collider: "box", faces: 1200 },
  { id: "b_rock", theme: "beach", what: "a cluster of rounded grey sea rocks with a starfish", size: [8, 6, 3], collider: "box", faces: 700 },
  // 城市 downtown — tall buildings (user: low-poly, few triangles)
  { id: "c_tower_a", theme: "city", what: "a tall cartoon office skyscraper with blue glass windows, a flat roof and a rooftop antenna", size: [22, 22, 90], collider: "box", faces: 1500 },
  { id: "c_tower_b", theme: "city", what: "a tall cartoon apartment tower with colorful balconies and a red roof", size: [20, 18, 64], collider: "box", faces: 1800 },
  { id: "c_tower_c", theme: "city", what: "a modern cartoon hotel tower with a curved glass front and a rooftop sign", size: [26, 22, 56], collider: "box", faces: 1800 },
  { id: "c_tower_d", theme: "city", what: "a cartoon office building with a stepped top and green glass", size: [24, 24, 46], collider: "box", faces: 1500 },
  { id: "c_mall", theme: "city", what: "a cartoon shopping mall building with a big glass entrance, a dome and a round sign", size: [44, 32, 20], collider: "box", faces: 2000 },
  { id: "c_station", theme: "city", what: "a small cartoon train station building with a big clock and a canopy", size: [32, 16, 14], collider: "box", faces: 2000 },
  { id: "c_gasstation", theme: "city", what: "a cartoon gas station with a flat canopy on pillars and two fuel pumps", size: [22, 16, 8], collider: "none", faces: 1500 },
  { id: "c_billboard", theme: "city", what: "a big blank billboard on two steel posts", size: [12, 2, 10], collider: "post", faces: 400 },
  { id: "c_tree", theme: "city", what: "a trimmed round street tree in a square concrete planter", size: [6, 6, 8], collider: "post", faces: 700 },
  { id: "c_bench_bus", theme: "city", what: "a modern glass bus shelter with a bench", size: [6, 2.5, 3.5], collider: "box", faces: 800 },
  // 隧道与桥 — hollow structures straddling the road: stretched to size, floor sunk to ground level, no collision (AI interiors are not reliably drivable)
  { id: "c_tunnel", theme: "city", what: "a straight hollow road tunnel through a concrete hill: a rectangular archway open at both ends, you can see through it, flat road floor inside", size: [60, 24, 14], collider: "none", fit: "stretch", sink: true, faces: 1200 },
  { id: "f_tunnel", theme: "forest", what: "a straight hollow wooden log tunnel over a road: an archway of logs open at both ends, you can see through it, flat floor", size: [50, 22, 12], collider: "none", fit: "stretch", sink: true, faces: 1200 },
  { id: "i_tunnel", theme: "ice", what: "a straight hollow ice cave tunnel: a blue ice archway open at both ends, you can see through it, flat floor", size: [50, 24, 14], collider: "none", fit: "stretch", sink: true, faces: 1200 },
  { id: "d_tunnel", theme: "desert", what: "a straight hollow sandstone gate tunnel with hieroglyph carvings: an archway open at both ends, you can see through it, flat floor", size: [40, 22, 14], collider: "none", fit: "stretch", sink: true, faces: 1200 },
  { id: "c_bridge", theme: "city", what: "a short flat cartoon road bridge over a canal with low stone arches and railings, flat deck open at both ends", size: [30, 16, 4], collider: "none", fit: "stretch", sink: true, faces: 1200 },
];

export function promptOf(asset) {
  return `${asset.what}, ${STYLE[asset.theme]}, ${SUFFIX}`;
}

/** Tripo options for an asset (low-poly, no PBR, metre scale). */
export function optionsOf(asset, model = "P1-20260311") {
  return { model, face_limit: asset.faces, texture: true, pbr: false, auto_size: true, negative_prompt: NEGATIVE };
}
