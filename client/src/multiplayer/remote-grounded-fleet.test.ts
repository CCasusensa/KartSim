import assert from "node:assert/strict";
import test from "node:test";
import { RemoteFleet, type MotionPacket } from "./remote-fleet";
import type { RemoteGroundTrack } from "./remote-pose-grounding";

const BASE = 100_000;
const moving = { bypass: false, locked: false };

function plane(slope = 0): RemoteGroundTrack {
  return {
    rayQuery(origin, displacement) {
      const denominator = displacement.y - slope * displacement.x;
      if (Math.abs(denominator) < 1e-9) return undefined;
      const fraction = (slope * origin.x - origin.y) / denominator;
      if (fraction < 0 || fraction > 1) return undefined;
      const x = origin.x + displacement.x * fraction;
      const length = Math.hypot(slope, 1);
      return { point: { x, y: slope * x, z: origin.z + displacement.z * fraction },
        normal: { x: -slope / length, y: 1 / length, z: 0 } };
    },
  };
}

function fixture(track: RemoteGroundTrack) {
  let now = BASE;
  let receive!: (packet: MotionPacket) => void;
  const fleet = new RemoteFleet({ roomId: "room", raceId: "race", participants: [
    { playerId: "me", slot: 0, remoteParameters: { mass: 2 } },
    { playerId: "peer", slot: 1, remoteParameters: { mass: 2, halfWidth: 0.7, halfLength: 1 } },
  ] }, { roomId: "room", raceId: "race", playerId: "me",
    subscribeMotion: listener => { receive = listener; return () => {}; } },
  () => now, error => { throw error; }, undefined, {
    createPresentation: () => ({ receive() {}, consume: () => undefined }),
    createGiant: () => { throw new Error("no giants"); },
    validateGiantState: () => true, newerSequence: (a, b) => a > b,
    resetVisible: () => true,
  });
  fleet.groundTrack = track;
  fleet.bindClock({ offsetMs: 0 });
  return { fleet, setTime: (elapsed: number) => { now = BASE + elapsed; },
    receive: (packet: MotionPacket) => receive(packet),
    update: () => fleet.update(now, moving) };
}

function sample(elapsed: number, sequence: number,
  changes: Partial<MotionPacket["payload"]> = {}): MotionPacket {
  return { roomId: "room", raceId: "race", playerId: "peer", sequence, payload: {
    kind: "kinematic", tick: BASE + elapsed, flags: [1, 0],
    position: [10 * elapsed / 1000, 0, 0], quaternion: [1, 0, 0, 0],
    linearVelocity: [10, 0, 0], angularVelocity: [0, 0, 0],
    vector5C: [0, 0, 0], vector68: [0, 0, 0],
    collision: { active: true, scaleX: 1, scaleY: 1 }, ...changes,
  } };
}

test("delayed landing packets never draw a peer under the road, including a lost-packet gap", () => {
  for (const landingGap of [64, 256]) {
    const { fleet, setTime, receive, update } = fixture(plane());
    const packets = [sample(0, 1, { position: [0, 0, 0.3],
      linearVelocity: [10, 0, -8], vector5C: [0, 0, -19.6] })];
    for (let elapsed = landingGap; elapsed <= 800; elapsed += 64)
      packets.push(sample(elapsed, packets.length + 1));
    let rawPenetrated = false, frames = 0;
    for (let elapsed = 0; elapsed <= 900; elapsed += 16) {
      setTime(elapsed);
      while (packets.length && packets[0]!.payload.tick + 40 <= BASE + elapsed)
        receive(packets.shift()!);
      update();
      const raw = fleet.remotes.get("peer")!.motion.copyPose();
      const drawn = fleet.copyWebPose("peer");
      if (!raw || !drawn) continue;
      frames++;
      rawPenetrated ||= raw.position[2] < -0.05;
      assert.ok(drawn.position.y >= -1e-6, `gap ${landingGap}, t=${elapsed}: ${drawn.position.y}`);
    }
    assert.ok(rawPenetrated, "the fixture must exercise an underground prediction");
    assert.ok(frames > 40);
    fleet.dispose();
  }
});

test("downhill smoothing keeps the drawn footprint above the road at its displayed XZ", () => {
  const slope = 0.5;
  const { fleet, setTime, receive, update } = fixture(plane(slope));
  const angle = -Math.atan(slope);
  const packets: MotionPacket[] = [];
  for (let elapsed = 0; elapsed <= 1_600; elapsed += 128) {
    const x = 20 - elapsed * 0.01;
    packets.push(sample(elapsed, packets.length + 1, { position: [x, 0, slope * x],
      quaternion: [Math.cos(angle / 2), 0, Math.sin(angle / 2), 0],
      linearVelocity: [-10, 0, -10 * slope] }));
  }
  let frames = 0;
  for (let elapsed = 0; elapsed <= 1_600; elapsed += 16) {
    setTime(elapsed);
    while (packets.length && packets[0]!.payload.tick + 40 <= BASE + elapsed)
      receive(packets.shift()!);
    update();
    const pose = fleet.copyWebPose("peer");
    if (!pose) continue;
    frames++;
    for (const side of [-0.7, 0.7]) {
      const x = pose.position.x + side * pose.right.x;
      const y = pose.position.y + side * pose.right.y;
      assert.ok(y >= slope * x - 1e-5, `wheel below slope at ${elapsed}: ${y - slope * x}`);
    }
  }
  assert.ok(frames > 80);
  fleet.dispose();
});

test("a fresh airborne packet stays above the road without being pulled down", () => {
  const { fleet, setTime, receive, update } = fixture(plane());
  setTime(0);
  receive(sample(0, 1, { position: [0, 0, 5], linearVelocity: [10, 0, 0] }));
  update();
  assert.equal(fleet.copyWebPose("peer")!.position.y, 5);
  fleet.dispose();
});
