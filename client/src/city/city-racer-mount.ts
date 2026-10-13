/**
 * The per-racer block of initializeRacePresenter for karts that join the
 * running city scene: the rider on the kart's rider mount (or the linked
 * character), accessories on their sockets, the aura on the kart body and
 * the balloon on attachment 16. Used for members' karts (CityFleet) and for
 * the local kart after a garage change (city-local-kart.ts).
 */
import { racePresenterInitializationDependencies } from "../generated/world.js";

export function mountRacer(presenter: any, playerId: string, participant: any, view: any): void {
  const deps = racePresenterInitializationDependencies as any;
  const vehicle = participant.vehicle;
  const sourceRoot = deps.serializedRoot(vehicle.imported.model);
  const riderSource = sourceRoot.children[6]?.value;
  const riderMount = riderSource && "children" in (riderSource as object)
    ? vehicle.imported.renderScene?.bySource.get(riderSource) : undefined;
  const character = participant.characters.linked ?? participant.characters.ordinary;
  presenter.linkedPresentations.delete(playerId);
  if (character && riderMount) {
    riderMount.clear();
    riderMount.add(character.scene.object);
    character.scene.object.scale.setScalar(vehicle.visual.onCharacterSize);
    if (participant.characters.linked) {
      const vehicleRoot = vehicle.imported.renderScene?.bySource.get(sourceRoot);
      if (vehicleRoot && character.award) {
        const linked = deps.createLinkedPresentation(vehicleRoot, riderMount,
          character.scene.object, vehicle.kartItem.alwaysLinkCharacter);
        linked.resetForRacePresentation();
        presenter.linkedPresentations.set(playerId, linked);
      }
    }
  }
  if (character) {
    for (const accessory of vehicle.accessories) {
      const socketName = accessory.kind === "aura" ? undefined : deps.accessorySockets[accessory.kind];
      const socket = socketName
        ? character.scene.getDecorationSocket(socketName[0], socketName[1])
        : character.scene.getDecorationOwner();
      if (!socket) continue;
      socket.add(accessory.render.scene.object);
      if (accessory.kind === "aura" && riderMount) {
        const vehicleRoot = vehicle.imported.renderScene?.bySource.get(sourceRoot);
        if (vehicleRoot) deps.attachAura(socket, vehicleRoot, accessory.render.scene.object);
      }
    }
  }
  if (vehicle.decoration) view.getAttachment(16)?.add(vehicle.decoration.scene.object);
}
