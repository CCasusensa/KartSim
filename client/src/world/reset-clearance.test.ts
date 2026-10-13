import assert from "node:assert/strict";
import test from "node:test";

import { triangleIntersectsOrientedBox } from "../driving/collision-geometry";
import { clearResetPose, type ResetPose } from "./reset-clearance";
import type { RouteSection, Vec3 } from "./route";

type Triangle = { a: Vec3; b: Vec3; c: Vec3; normal: Vec3; motion?: Vec3 };

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const up = v(0, 1, 0);
const forward = v(0, 0, 1);
const vehicle = {
  collisionShape: { rawHalfWidth: 0.85, rawHalfLength: 1.35, scaleX: 1, scaleY: 1, rawHeight: 0.6 },
};

/** A straight section heading +z (its right is +x), road at y = 0 for |x| <= roadHalfWidth. */
function section(length = 60, surface = ""): RouteSection {
  return {
    frames: [{ position: v(0, 0, 0), forward, up }, { position: v(0, 0, length), forward, up }],
    length, surface, outgoing: [], incoming: [],
  };
}

function checkpoint(route: RouteSection): ResetPose {
  const first = route.frames[0]!;
  return { position: v(0, 0, Math.fround(0.10000000149011612)), forward: { ...first.forward },
    up: { ...first.up }, surface: route.surface };
}

function centroid(triangle: Triangle): Vec3 {
  return v((triangle.a.x + triangle.b.x + triangle.c.x) / 3,
    (triangle.a.y + triangle.b.y + triangle.c.y) / 3, (triangle.a.z + triangle.b.z + triangle.c.z) / 3);
}

/** Two triangles of the rectangle corner + s·edge1 + t·edge2, facing `normal`. */
function quad(corner: Vec3, edge1: Vec3, edge2: Vec3, normal: Vec3): Triangle[] {
  const at = (s: number, t: number) => v(corner.x + s * edge1.x + t * edge2.x,
    corner.y + s * edge1.y + t * edge2.y, corner.z + s * edge1.z + t * edge2.z);
  return [
    { a: at(0, 0), b: at(1, 0), c: at(1, 1), normal },
    { a: at(0, 0), b: at(1, 1), c: at(0, 1), normal },
  ];
}

/** A wall in the plane x = `x`, from z0 to z1, 2 m tall. */
const wallX = (x: number, z0: number, z1: number, facing: 1 | -1) =>
  quad(v(x, 0, z0), v(0, 0, z1 - z0), v(0, 2, 0), v(facing, 0, 0));
/** A wall in the plane z = `z`, from x0 to x1, 2 m tall. */
const wallZ = (z: number, x0: number, x1: number, facing: 1 | -1) =>
  quad(v(x0, 0, z), v(x1 - x0, 0, 0), v(0, 2, 0), v(0, 0, facing));

function world(walls: Triangle[], options: {
  roadHalfWidth?: number; animators?: unknown[];
} = {}) {
  const roadHalfWidth = options.roadHalfWidth ?? 8;
  return {
    queryObb: (box: any) => walls.filter(triangle => triangleIntersectsOrientedBox(triangle, box))
      .map(triangle => ({ point: centroid(triangle), normal: triangle.normal })),
    rayQuery(origin: Vec3, movement: Vec3, includeWalls: boolean) {
      assert.equal(includeWalls, false);
      if (movement.y >= 0 || Math.abs(origin.x) > roadHalfWidth) return undefined;
      const fraction = -origin.y / movement.y;
      if (fraction < 0 || fraction > 1) return undefined;
      return { point: v(origin.x + movement.x * fraction, 0, origin.z + movement.z * fraction), normal: up };
    },
    triangleObbQuery: triangleIntersectsOrientedBox,
    data: { obstacleAnimators: options.animators ?? [] },
  };
}

/** A 2 x 2 x 2 m block centred on (x, 1, z), as a moving obstacle's side faces. */
function block(x: number, z: number, motion = v(0, 0, 0)): Triangle[] {
  return [
    ...wallX(x - 1, z - 1, z + 1, -1), ...wallX(x + 1, z - 1, z + 1, 1),
    ...wallZ(z - 1, x - 1, x + 1, -1), ...wallZ(z + 1, x - 1, x + 1, 1),
  ].map(triangle => ({ ...triangle, motion }));
}

function animator(triangles: Triangle[]) {
  const center = centroid({ a: triangles[0]!.a, b: triangles[2]!.b, c: triangles[5]!.c, normal: up });
  return { updateSnapshot: () => triangles, registrationCenter: () => center, modelRadius: () => 2 };
}

const near = (actual: Vec3, expected: Vec3) =>
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) < 1e-3,
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);

test("复位点周围没有障碍时原样返回发行版的复位点", () => {
  const route = section();
  const pose = checkpoint(route);
  // Road side walls 6 m away, a ledge the kart drops from behind it, a far wall ahead.
  const track = world([...wallX(-6, -5, 60, 1), ...wallX(6, -5, 60, -1),
    ...wallZ(0, -6, 6, 1), ...wallZ(30, -6, 6, -1)]);
  assert.equal(clearResetPose(track, vehicle, route, pose), pose);
});

test("只擦到车身侧面的墙不算挡住", () => {
  const route = section();
  const pose = checkpoint(route);
  assert.equal(clearResetPose(world(wallX(-0.7, -5, 60, 1)), vehicle, route, pose), pose);
});

test("复位点骑在分岔匝道的侧壁上时换到旁边的空位（village_I15 交通高峰第 7 段）", () => {
  const route = section();
  const pose = checkpoint(route);
  const result = clearResetPose(world(wallX(-0.17, 1.15, 9, 1)), vehicle, route, pose);
  assert.notEqual(result, pose);
  near(result.position, v(1.5, 0, pose.position.z));
  assert.deepEqual(result.forward, forward);
  assert.deepEqual(result.up, up);
  assert.equal(result.surface, "");
});

test("正前方贴着墙时不穿墙，换到墙边可开出去的位置（china_I08 第 10 段）", () => {
  const route = section();
  const pose = checkpoint(route);
  const result = clearResetPose(world(wallZ(2.1, -2.3, 1.47, -1)), vehicle, route, pose);
  // Further along would pass through the wall; 3 m to the right clears its end.
  near(result.position, v(3, 0, pose.position.z));
});

test("两侧没有路面时沿路线往前找", () => {
  const route = section();
  const pose = checkpoint(route);
  const result = clearResetPose(world(wallX(0, -1, 1.5, 1), { roadHalfWidth: 1 }), vehicle, route, pose);
  near(result.position, v(0, 0, pose.position.z + 4));
});

test("找不到空位或路段过短时保留原复位点", () => {
  const boxed = [...wallZ(1.5, -10, 10, -1), ...wallX(-0.2, -5, 60, 1)];
  const route = section();
  const pose = checkpoint(route);
  assert.equal(clearResetPose(world(boxed, { roadHalfWidth: 1 }), vehicle, route, pose), pose);
  const short = section(4);
  const shortPose = checkpoint(short);
  assert.equal(clearResetPose(world(wallX(0, -1, 1.5, 1), { roadHalfWidth: 1 }), vehicle,
    short, shortPose), shortPose);
});

test("轨道和传送路段保留原复位点", () => {
  for (const surface of ["rail", "warpnext"]) {
    const route = section(60, surface);
    const pose = checkpoint(route);
    assert.equal(clearResetPose(world(wallX(-0.17, 1.15, 9, 1)), vehicle, route, pose), pose);
  }
});

test("缺少碰撞查询或车体尺寸时不做检查", () => {
  const route = section();
  const pose = checkpoint(route);
  assert.equal(clearResetPose({}, vehicle, route, pose), pose);
  assert.equal(clearResetPose(world(wallX(-0.17, 1.15, 9, 1)), {}, route, pose), pose);
});

test("移动障碍物停在复位点上时换位置", () => {
  const route = section();
  const pose = checkpoint(route);
  const hammer = animator(block(0, 0.5));
  const result = clearResetPose(world([], { animators: [hammer] }), vehicle, route, pose);
  // The block covers |x| <= 1 up to z = 1.5: the kart is put down just past it.
  near(result.position, v(0, 0, pose.position.z + 4));
});

test("按当前速度即将开到复位点的移动障碍物也要避开", () => {
  const route = section();
  const pose = checkpoint(route);
  // A train 10 m to the left crossing the road at 10 m/s reaches the checkpoint within 1 s.
  const train = animator(block(-10, 0.5, v(10, 0, 0)));
  const result = clearResetPose(world([], { animators: [train] }), vehicle, route, pose);
  assert.notEqual(result, pose);
  // A parked one, or one driving away, does not block.
  for (const motion of [v(0, 0, 0), v(-10, 0, 0)]) {
    const parked = animator(block(-10, 0.5, motion));
    assert.equal(clearResetPose(world([], { animators: [parked] }), vehicle, route, pose), pose);
  }
});

test("障碍物顶面可以站人，不算挡住", () => {
  const route = section();
  const pose = checkpoint(route);
  const top = quad(v(-3, 0.3, -3), v(6, 0, 0), v(0, 0, 6), up);
  assert.equal(clearResetPose(world([], { animators: [animator([...top, ...top, ...top])] }),
    vehicle, route, pose), pose);
});
