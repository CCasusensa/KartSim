import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { cameraCullingPlanes } from "./camera-culling-planes";

function nativeVisible(camera: PerspectiveCamera, bounds: Box3) {
  return cameraCullingPlanes(camera).every(({ normal, constant }) => {
    const point = [normal[0]! <= 0 ? bounds.max.x : bounds.min.x,
      normal[1]! <= 0 ? bounds.max.y : bounds.min.y,
      normal[2]! <= 0 ? bounds.max.z : bounds.min.z];
    return normal.reduce((sum, value, axis) => sum + value * point[axis]!, constant) <= 0;
  });
}

test("大陆远景相机不会剔除屏幕中的本地车辆", () => {
  const camera = new PerspectiveCamera(59.840000216971724, 16 / 9, 1.5, 2000);
  camera.matrixAutoUpdate = false;
  camera.matrix.fromArray([1.001365855708243, 0, 0, 0,
    0, 0.9689124156012398, -0.24774188694160104, 0,
    0, 0.24740397432884478, 0.970235834547216, 0,
    2399.9999006824, 27.0449802508, -2116.5076255378, 1]);
  camera.updateMatrixWorld(true);
  const kart = new Box3(new Vector3(2399.23315, 24.04102, -2122.84448),
    new Vector3(2400.76685, 24.85784, -2121.21021));
  assert.equal(nativeVisible(camera, kart), true);
  for (const offset of [new Vector3(), new Vector3(0, 0, 30),
    new Vector3(30, 0, 0), new Vector3(0, 0, -2200)]) {
    const bounds = kart.clone().translate(offset);
    const rendered = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    assert.equal(nativeVisible(camera, bounds), rendered.intersectsBox(bounds));
  }
});

test("普通赛道相机仍剔除侧面、近面和远面以外的物体", () => {
  const camera = new PerspectiveCamera(60, 16 / 9, 1.5, 1000);
  camera.updateMatrixWorld(true);
  const at = (x: number, z: number) => new Box3(
    new Vector3(x - 0.2, -0.2, z - 0.2), new Vector3(x + 0.2, 0.2, z + 0.2));
  assert.equal(nativeVisible(camera, at(0, -10)), true);
  for (const box of [at(0, 1), at(20, -10), at(0, -1002)])
    assert.equal(nativeVisible(camera, box), false);
});
