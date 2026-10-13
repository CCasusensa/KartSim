import assert from "node:assert/strict";
import test from "node:test";

import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { kartAlignedPetOwner } from "./flying-pet-mount";

/** kart root → child 6 mount (fixed matrix) → rider (scaled) → culling → owner. */
function rig(basis: number[][]) {
  const kart = new Group();
  kart.position.set(10, -4, 2);
  kart.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
  const mount = new Object3D();
  mount.matrixAutoUpdate = false;
  mount.matrix.set(
    basis[0]![0]!, basis[0]![1]!, basis[0]![2]!, 0,
    basis[1]![0]!, basis[1]![1]!, basis[1]![2]!, 0.18,
    basis[2]![0]!, basis[2]![1]!, basis[2]![2]!, 0.52,
    0, 0, 0, 1);
  const rider = new Group();
  rider.scale.setScalar(1.3);
  const culling = new Group();
  const owner = new Object3D();
  owner.matrixAutoUpdate = false;
  owner.matrix.compose(new Vector3(0, 0.05, -0.1),
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2), new Vector3(1, 1, 1));
  kart.add(mount);
  mount.add(rider);
  rider.add(culling);
  culling.add(owner);
  return { kart, mount, owner };
}

/** World matrix of a pet floating at `local` on the returned owner. */
function petWorld(basis: number[][], local: Vector3): Matrix4 {
  const { kart, mount, owner } = rig(basis);
  const pet = new Object3D();
  pet.position.copy(local);
  kartAlignedPetOwner(owner, mount).add(pet);
  kart.updateMatrixWorld(true);
  return pet.matrixWorld.clone();
}

function assertMatrixClose(actual: Matrix4, expected: Matrix4, label: string): void {
  actual.elements.forEach((value, index) =>
    assert.ok(Math.abs(value - expected.elements[index]!) < 1e-5,
      `${label}[${index}] ${value} ≠ ${expected.elements[index]}`));
}

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

test("飞宠挂点：未旋转的角色挂点直接用角色装饰节点，和发行版一致", () => {
  const { mount, owner } = rig(IDENTITY);
  assert.equal(kartAlignedPetOwner(owner, mount), owner);
  assert.equal(owner.children.length, 0);
});

test("飞宠挂点：反向/螃蟹/滑板车的角色挂点旋转不带到飞宠上", () => {
  const local = new Vector3(0.59, -0.75, 0.5);
  const expected = petWorld(IDENTITY, local);
  const rotated: Array<[string, number[][]]> = [
    // flubber1 (Reverse='true'): the rider faces backwards.
    ["flubber1", [[-1, 1.5099580252808664e-7, 0], [-1.5099580252808664e-7, -1, 0], [0, 0, 1]]],
    ["crab2", [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]],
    ["snowBoardX", [[0.7071068, 0.7071068, 0], [-0.7071068, 0.7071068, 0], [0, 0, 1]]],
    ["crab1", [[0.084, 0.962, -0.259], [-0.996, 0.087, 0], [0.023, 0.258, 0.966]]],
  ];
  for (const [name, basis] of rotated) {
    // crab1's file basis is rounded here; orthonormalize it like a real mount.
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().set(
      basis[0]![0]!, basis[0]![1]!, basis[0]![2]!, 0,
      basis[1]![0]!, basis[1]![1]!, basis[1]![2]!, 0,
      basis[2]![0]!, basis[2]![1]!, basis[2]![2]!, 0, 0, 0, 0, 1)).normalize();
    const e = new Matrix4().makeRotationFromQuaternion(rotation).elements;
    const clean = [[e[0]!, e[4]!, e[8]!], [e[1]!, e[5]!, e[9]!], [e[2]!, e[6]!, e[10]!]];
    assertMatrixClose(petWorld(clean, local), expected, name);
  }
});
