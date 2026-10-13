import { Frustum, Matrix4, type PerspectiveCamera } from "three";

const clipFromWorld = new Matrix4();
const frustum = new Frustum();
const planes = Array.from({ length: 6 }, () => ({
  normal: [0, 0, 0], constant: 0,
}));

/** Outward planes for the native bounds test, using the camera's actual projection. */
export function cameraCullingPlanes(camera: PerspectiveCamera) {
  // The native drive camera basis is not perfectly orthonormal. Rotating plane
  // normals with that basis moves the side planes as far grows (enough to hide
  // the player's kart on a continent). Projection * inverse-world handles its
  // scale as well as translation and matches what WebGL actually draws.
  clipFromWorld.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(clipFromWorld, camera.coordinateSystem);
  for (let index = 0; index < planes.length; index++) {
    const source = frustum.planes[index]!;
    const target = planes[index]!;
    target.normal[0] = Math.fround(-source.normal.x);
    target.normal[1] = Math.fround(-source.normal.y);
    target.normal[2] = Math.fround(-source.normal.z);
    target.constant = Math.fround(-source.constant);
  }
  return planes;
}
