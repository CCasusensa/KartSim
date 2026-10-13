import { Group, Matrix4, Quaternion, Vector3, type Object3D } from "three";

const IDENTITY_TOLERANCE = 1e-6;

/**
 * The parent for a flying pet riding on `owner` (the rider's decoration owner).
 *
 * Twelve p3553 karts turn the rider inside the ReKart root child 6 mount: the
 * Reverse karts (flubber1/2/7/8, gomsin9/V1/X/XUN_flower) by 180°, crab1/crab2
 * by about 90° and the snow/surfing boards by 45°. The release hangs the pet
 * under the rider, so on those karts it faced and floated backwards or sideways
 * with the rider. The pet keeps to the kart instead: the returned group undoes
 * the mount's rotation, so the pet sits and faces as on an unrotated mount.
 * Every other kart's mount is unrotated and gets `owner` itself back.
 */
export function kartAlignedPetOwner(owner: Object3D, riderMount: Object3D): Object3D {
  if (riderMount.matrixAutoUpdate) riderMount.updateMatrix();
  const translation = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  riderMount.matrix.decompose(translation, rotation, scale);
  if (1 - Math.abs(rotation.w) < IDENTITY_TOLERANCE) return owner;

  // Owner relative to the mount, multiplied down from the mount's child.
  const chain: Object3D[] = [];
  for (let node: Object3D | null = owner; node !== riderMount; node = node.parent) {
    if (!node) return owner;
    chain.unshift(node);
  }
  const ownerInMount = new Matrix4();
  for (const node of chain) {
    if (node.matrixAutoUpdate) node.updateMatrix();
    ownerInMount.multiply(node.matrix);
  }

  // mount · ownerInMount · aligned = unrotated mount · ownerInMount
  const unrotated = new Matrix4().compose(translation, new Quaternion(), scale);
  const aligned = new Group();
  aligned.name = "FlyingPet:KartAligned";
  aligned.matrixAutoUpdate = false;
  aligned.matrix.copy(ownerInMount).invert()
    .multiply(riderMount.matrix.clone().invert())
    .multiply(unrotated)
    .multiply(ownerInMount);
  aligned.matrixWorldNeedsUpdate = true;
  owner.add(aligned);
  return aligned;
}
