/** City karts use the same size for collision, wheel footprint and presentation. */
export const CITY_VEHICLE_SCALE = 0.75;

interface ScaleVector { x: number; y: number; z: number }
interface CityVehicle {
  collisionShape: {
    rawHalfWidth: number;
    rawHalfLength: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly rawHeight: number;
  };
  syncPresentationFields(): void;
}

const scaledVehicles = new WeakSet<CityVehicle>();

/**
 * Keep the release's dynamic event-scale getters: AL replaces its runtime
 * on reset. A city-only multiplier therefore survives teleport/reset and
 * composes with temporary size effects without changing ordinary races.
 * AL publishes this effective scale to both the local view and network.
 */
export function applyCityVehicleScale(vehicle: CityVehicle): void {
  if (scaledVehicles.has(vehicle)) return;
  const shape = vehicle.collisionShape;
  vehicle.collisionShape = {
    rawHalfWidth: shape.rawHalfWidth,
    rawHalfLength: shape.rawHalfLength,
    get scaleX() { return Math.fround(shape.scaleX * CITY_VEHICLE_SCALE); },
    get scaleY() { return Math.fround(shape.scaleY * CITY_VEHICLE_SCALE); },
    get rawHeight() { return Math.fround(shape.rawHeight * CITY_VEHICLE_SCALE); },
  };
  scaledVehicles.add(vehicle);
  vehicle.syncPresentationFields();
}

/** Wire scale already includes the city size; only missing poses need a default. */
export function cityVisualScale(received?: ScaleVector): ScaleVector {
  return received ? { ...received }
    : { x: CITY_VEHICLE_SCALE, y: CITY_VEHICLE_SCALE, z: CITY_VEHICLE_SCALE };
}
