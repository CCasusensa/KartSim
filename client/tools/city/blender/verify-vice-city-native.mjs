// Verify staged native bytes with the runtime parser, collision queries and AL kart.
// No registered resources, active city-map.json or generator functions are used.
// node --import ./src/physics/node-raw-test-hook.mjs --import tsx tools/city/blender/verify-vice-city-native.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCityVehicleScale, CITY_VEHICLE_SCALE } from '../../../src/city/city-vehicle-scale.ts';
import * as Fuel from './fuel-station-checks.mjs';
import { loadPropAsset, propPlacement } from './design-props.mjs';

const client = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) { const index = args.indexOf(name); return path.resolve(index < 0 ? fallback : args[index + 1]); }
const designFile = option('--design', path.join(client, 'build/vice-city/out/kartcity-design.json'));
const trackFile = option('--track', path.join(client, 'build/vice-city/native/track.1s'));
const outputFile = option('--out', path.join(client, 'build/vice-city/native-verification.json'));
const failures = [], navigationWarnings = [], report = { designFile, trackFile, limits: { sampleSpacing: 6, roadHeightError: .7, maximumGrade: .25, sweepHeight: .7, spawnDriveDistance: 20 }, stats: { groundProbes: 0, forwardSweeps: 0, bodyOverlaps: 0, maximumHeightError: 0, maximumGrade: 0 }, roads: [], spawns: [], drives: [], failures, navigationWarnings };
report.vehicleScale = CITY_VEHICLE_SCALE;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = () => { mkdirSync(path.dirname(outputFile), { recursive: true }); writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n'); };
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
let design, world, surface, toWorld, toDesign, admitted;
function issue(kind, details, important = true) { (important ? failures : navigationWarnings).push({ kind, ...details }); }

function probe(x, z, hint) {
  const origin = toWorld(x, hint + 1.2, z), movement = { x: 0, y: -12, z: 0 };
  report.stats.groundProbes++;
  const fraction = surface.queryBest(origin, movement, false);
  if (!Number.isFinite(fraction)) return undefined;
  const hit = surface.buildHit(origin, movement, fraction);
  return { height: hit.point.y, normal: { ...hit.normal }, point: { ...hit.point } };
}
function sweep(a, b) {
  const origin = toWorld(a[0], a[2] + report.limits.sweepHeight, a[1]);
  const movement = { x: b[0] - a[0], y: b[2] - a[2], z: b[1] - a[1] };
  report.stats.forwardSweeps++;
  const fraction = surface.queryBest(origin, movement, true);
  if (!Number.isFinite(fraction)) return undefined;
  const hit = surface.buildHit(origin, movement, fraction);
  return { point: toDesign(hit.point), normal: { ...hit.normal }, fraction };
}
function verifyPath(id, points, closed, important, category = 'road') {
  const stats = { id, category, important, points: points.length, samples: 0, length: 0, maximumHeightError: 0, maximumGrade: 0, issues: 0 };
  const add = (kind, detail) => { stats.issues++; issue(kind, { road: id, category, ...detail }, important); };
  if (points.length < 2) { add('path-too-short', {}); return stats; }
  for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (![...a, ...b].every(Number.isFinite)) { add('nonfinite-path-point', { index: i }); continue; }
    const dx = b[0] - a[0], dz = b[1] - a[1], distance = Math.hypot(dx, dz);
    stats.length += distance;
    if (distance < 1e-6) { add('zero-length-path-segment', { index: i }); continue; }
    const count = Math.max(1, Math.ceil(distance / report.limits.sampleSpacing));
    let previous;
    for (let sample = 0; sample <= count; sample++) {
      const t = sample / count, x = a[0] + dx * t, z = a[1] + dz * t, expectedY = a[2] + (b[2] - a[2]) * t;
      const ground = probe(x, z, expectedY); stats.samples++;
      if (!ground) { add('missing-path-ground', { index: i, fraction: t, at: [x, z], expectedY }); previous = undefined; continue; }
      const error = Math.abs(ground.height - expectedY), grade = Math.hypot(ground.normal.x, ground.normal.z) / Math.abs(ground.normal.y);
      stats.maximumHeightError = Math.max(stats.maximumHeightError, error); report.stats.maximumHeightError = Math.max(report.stats.maximumHeightError, error);
      stats.maximumGrade = Math.max(stats.maximumGrade, grade); report.stats.maximumGrade = Math.max(report.stats.maximumGrade, grade);
      if (error > report.limits.roadHeightError) add('path-height-mismatch', { index: i, fraction: t, at: [x, z], expectedY, actualY: ground.height, error });
      if (grade > report.limits.maximumGrade + .0001) add('path-steep-surface', { index: i, fraction: t, at: [x, z], grade });
      if (ground.normal.y < .1) add('path-downward-normal', { index: i, fraction: t, at: [x, z], normal: ground.normal });
      const current = [x, z, ground.height];
      if (previous) { const obstruction = sweep(previous, current); if (obstruction) add('path-forward-obstruction', { index: i, fraction: t, ...obstruction }); }
      previous = current;
    }
  }
  return stats;
}

try {
  const designBytes = readFileSync(designFile), trackBytes = readFileSync(trackFile);
  design = JSON.parse(designBytes);
  report.designSha256 = hash(designBytes); report.trackSha256 = hash(trackBytes); report.trackBytes = trackBytes.length; report.designVersion = design.meta.version;
  const extent = design.meta.extent;
  assert.ok(extent?.length === 2 && extent.flat().every(Number.isFinite), 'Valid staged design extent');
  const offsetX = -extent[0][0], offsetZ = extent[1][1];
  report.coordinateOffsets = { x: offsetX, z: -offsetZ };
  toWorld = (x, y, z) => ({ x: x + offsetX, y, z: z - offsetZ });
  toDesign = p => ({ x: p.x - offsetX, y: p.y, z: p.z + offsetZ });
  const roadExtent = Math.max(extent[1][0] - extent[0][0], extent[1][1] - extent[0][1]) + 1;
  // This small DOM stub only satisfies the generated runtime's module setup.
  globalThis.document ??= { createElement: () => ({ relList: { supports: () => true }, getContext: () => null, style: {} }) };
  const [formats, { _L }, { AL }, { T2 }, { bundledVehicleSpecCatalog }, { vehiclePhysicsParameters }] = await Promise.all([
    import('../../../src/generated/formats.js'), import('../../../src/generated/world.js'), import('../../../src/generated/driving.js'), import('../../../src/generated/vendor.js'), import('../../../src/physics/bundled.ts'), import('../../../src/driving/physics-parameters.ts'),
  ]);
  const started = performance.now();
  admitted = formats.YW(formats.y9(new Uint8Array(trackBytes)), 'time-attack', { roadExtent });
  report.parseMs = Math.round(performance.now() - started);
  report.collisionTriangles = admitted.collisionTriangles.length;
  report.routeSections = admitted.sections.length;
  for (const kind of ['roadIssues', 'runtimeIssues', 'deferredRoadTriangles']) if (admitted[kind]?.length) issue('native-parser-issues', { field: kind, count: admitted[kind].length, examples: admitted[kind].slice(0, 8) });
  world = new _L({ ...admitted, resourceVersion: 'p3553', trackId: 'kartcity' }, new T2());
  surface = world.surface;
  report.worldBuildMs = Math.round(performance.now() - started - report.parseMs);
  report.gridCells = surface.cells.size;

  const routeRoads = design.roads.filter(r => r.route || r.id === 'ring');
  if (!routeRoads.length) issue('missing-primary-route', {});
  for (const road of design.roads) {
    const important = routeRoads.includes(road);
    if (important && !road.closed) issue('primary-route-not-closed', { road: road.id });
    if (important) for (let i = 0; i < road.points.length; i++) {
      const a = road.points[(i + road.points.length - 1) % road.points.length], b = road.points[i], c = road.points[(i + 1) % road.points.length];
      const dx1 = b[0] - a[0], dz1 = b[1] - a[1], dx2 = c[0] - b[0], dz2 = c[1] - b[1], len = Math.hypot(dx1, dz1) * Math.hypot(dx2, dz2);
      if (len && (dx1 * dx2 + dz1 * dz2) / len < -.999) issue('primary-route-immediate-reversal', { road: road.id, index: i, points: [a, b, c] });
    }
    report.roads.push(verifyPath(road.id, road.points, !!road.closed, important));
  }

  // Check the actual parsed RouteSection graph as well as the design. Native
  // route interpolation can cut corners even if its input samples had ground.
  report.nativeRoute = [];
  const visited = new Set(), pending = [admitted.firstSection];
  while (pending.length) {
    const index = pending.pop(); if (visited.has(index)) continue; visited.add(index);
    const section = admitted.sections[index];
    if (!section) { issue('route-invalid-section', { index }); continue; }
    const points = section.frames.map(frame => { const p = toDesign(frame.position); return [p.x, p.z, p.y - 1]; });
    report.nativeRoute.push(verifyPath(`native-section-${index}`, points, false, true, 'native-route'));
    if (!section.outgoing.length) issue('route-dead-end', { section: index });
    for (const edge of section.outgoing) {
      const next = admitted.sections[edge.section];
      if (!next) { issue('route-invalid-edge', { section: index, target: edge.section }); continue; }
      const a = section.frames.at(-1)?.position, b = next.frames[0]?.position;
      if (!a || !b || pointDistance(a, b) > .05) issue('native-route-section-gap', { section: index, target: edge.section, distance: a && b ? pointDistance(a, b) : null });
      pending.push(edge.section);
    }
  }
  if (visited.size !== admitted.sections.length) issue('native-route-disconnected', { visited: visited.size, total: admitted.sections.length });
  if (!admitted.sections[admitted.lastSection]?.outgoing.some(e => e.section === admitted.firstSection)) issue('native-route-open-seam', { first: admitted.firstSection, last: admitted.lastSection });

  const tuning = vehiclePhysicsParameters(bundledVehicleSpecCatalog().lookup(373, 7).spec, { autoChargeLowSpeed: 100, driftGaugeReset: true, wheelPosition: .85 }, 5);
  const neutral = { forward: 0, reverse: 0, steer: 0, rawSteer: 0, steeringInverted: false, rawDriftHeld: false, derivedDriftHeld: false, actionMarkerWord: 0 };
  const spawns = design.pois.filter(p => p.kind === 'spawn');
  if (!spawns.length) issue('missing-spawns', {});
  report.playerSpawnCount = spawns.length;
  // Regression for the source's co-planar bridge deck/backface pair. These
  // points remain required even if recovery navigation is later trimmed.
  const bridgeRegressionChecks = [
    { id: 'north-bridge-east', at: [-1208, -320], y: 25.147461891174316, heading: 90, verificationSource: 'audited-source-bridge-deck' },
    { id: 'north-bridge-west', at: [-1208, -320], y: 25.147461891174316, heading: 270, verificationSource: 'audited-source-bridge-deck' },
  ];
  for (const spawn of [...spawns, ...bridgeRegressionChecks]) {
    const [x, z] = spawn.at, yaw = Math.PI - spawn.heading * Math.PI / 180;
    const forward = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, right = { x: forward.z, y: 0, z: -forward.x };
    const ground = probe(x, z, spawn.y), result = { id: spawn.id, verificationSource: spawn.verificationSource ?? 'player-spawn', expected: [x, spawn.y, z], heading: spawn.heading, ground, footprint: [] };
    report.spawns.push(result);
    if (!ground || Math.abs(ground.height - spawn.y) > .7) issue('spawn-ground', { spawn: spawn.id, expectedY: spawn.y, actualY: ground?.height });
    for (const [side, ahead] of [[0, 0], [-.9, -1.5], [.9, -1.5], [.9, 1.5], [-.9, 1.5], [-.9, 0], [.9, 0], [0, -1.5], [0, 1.5]]) {
      const sx = x + right.x * side + forward.x * ahead, sz = z + right.z * side + forward.z * ahead, contact = probe(sx, sz, spawn.y);
      result.footprint.push({ x: sx, z: sz, height: contact?.height });
      if (!contact || Math.abs(contact.height - spawn.y) > .7) issue('spawn-wheel-ground', { spawn: spawn.id, at: [sx, sz], expectedY: spawn.y, actualY: contact?.height });
    }
    if (!ground) continue;
    const box = { center: toWorld(x, ground.height + 1.025, z), axes: [right, { x: 0, y: 1, z: 0 }, forward], halfExtents: [.9, .775, 1.5] };
    const overlaps = surface.queryObb(box); report.stats.bodyOverlaps += overlaps.length;
    result.bodyOverlapCount = overlaps.length;
    if (overlaps.length) issue('spawn-body-obstruction', { spawn: spawn.id, count: overlaps.length, examples: overlaps.slice(0, 8).map(o => ({ point: toDesign(o.point), normal: o.normal })) });
    const drive = { spawn: spawn.id, verificationSource: spawn.verificationSource ?? 'player-spawn', requestedDistance: 20, reached: false, automaticReset: false, maxSpeedKmh: 0, groundedTicks: 0, progress: 0, lateralDeviation: 0, trajectory: [] };
    report.drives.push(drive);
    try {
      const kart = new AL(tuning, { rawHalfWidth: .9, rawHalfLength: 1.5, scaleX: 1, scaleY: 1, rawHeight: 1 });
      applyCityVehicleScale(kart);
      const start = toWorld(x, ground.height + .4, z);
      kart.reset(start.x, start.y, start.z, yaw); world.resetRouteState(kart, kart.body.position);
      kart.update(10000, neutral, world);
      for (let time = 10016; time <= 18000; time += 16) {
        kart.update(time, { ...neutral, forward: 1 }, world);
        const position = kart.body.position, local = toDesign(position);
        drive.maxSpeedKmh = Math.max(drive.maxSpeedKmh, kart.displaySpeedKmh());
        drive.progress = (position.x - start.x) * forward.x + (position.z - start.z) * forward.z;
        drive.lateralDeviation = Math.max(drive.lateralDeviation, Math.abs((position.x - start.x) * right.x + (position.z - start.z) * right.z));
        if (kart.wheels.grounded) drive.groundedTicks++;
        if ((time - 10016) % 80 === 0) drive.trajectory.push({ ms: time - 10000, ...local, grounded: !!kart.wheels.grounded });
        if (kart.consumeAutomaticResetRequest()) { drive.automaticReset = true; break; }
        if (![position.x, position.y, position.z].every(Number.isFinite) || position.y < -5) { drive.invalidPosition = local; break; }
        if (drive.progress >= 20 && kart.wheels.grounded) { drive.reached = true; break; }
      }
      drive.finalPosition = toDesign(kart.body.position);
      if (!drive.reached || drive.automaticReset || drive.invalidPosition || drive.lateralDeviation > 2) issue('spawn-drive-failed', { spawn: spawn.id, reached: drive.reached, progress: drive.progress, automaticReset: drive.automaticReset, lateralDeviation: drive.lateralDeviation, finalPosition: drive.finalPosition });
    } catch (error) { drive.error = error.message; issue('spawn-drive-exception', { spawn: spawn.id, message: error.message }); }
  }

  // Fuel stations: zone/park sanity, park ground and clearance, a straight
  // drive out of the park pose, a drive from the nearest road into the zone,
  // and (for Tripo props) how far the slab top stands above the ground.
  const fuelPois = design.pois.filter(p => p.kind === 'fuel');
  report.fuel = [];
  const fuelContext = { surface, world, toWorld, toDesign, AL, tuning, scaleKart: applyCityVehicleScale };
  const fuelQueries = Fuel.nativeQueries(fuelContext);
  for (const poi of fuelPois) {
    const entry = { id: poi.id, source: poi.source, at: poi.at, y: poi.y, park: poi.park, zone: poi.zone };
    report.fuel.push(entry);
    const fail = (kind, details = {}) => issue(kind, { poi: poi.id, ...details });
    if (!Array.isArray(poi.zone) || poi.zone.length !== 4 || !Fuel.isConvex(poi.zone)) fail('fuel-zone-invalid');
    if (!poi.park || !Fuel.pointInPolygon(poi.park.at, poi.zone)) { fail('fuel-park-outside-zone'); continue; }
    // parkGround: the surface a kart at the park pose rests on (the slab top for
    // Tripo stations); placementGround: what the city's reset placement picks there.
    const [px, pz] = poi.park.at, parkGround = fuelQueries.resting(px, pz, poi.park.y), placementGround = fuelQueries.ground(px, pz, poi.park.y);
    Object.assign(entry, { parkGround, placementGround });
    if (parkGround === undefined || Math.abs(parkGround - poi.park.y) > .05) fail('fuel-park-ground', { expectedY: poi.park.y, actualY: parkGround });
    if (placementGround === undefined || placementGround + .4 < parkGround) fail('fuel-park-placement', { parkGround, placementGround });
    if (parkGround === undefined) continue;
    const yaw = Math.PI - poi.park.heading * Math.PI / 180, forward = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, right = { x: forward.z, y: 0, z: -forward.x };
    const overlaps = surface.queryObb({ center: toWorld(px, parkGround + 1.025, pz), axes: [right, { x: 0, y: 1, z: 0 }, forward], halfExtents: [.9, .775, 1.5] });
    entry.parkBodyOverlaps = overlaps.length;
    if (overlaps.length) fail('fuel-park-obstruction', { count: overlaps.length, examples: overlaps.slice(0, 4).map(o => ({ point: toDesign(o.point), normal: o.normal })) });
    if (poi.source === 'tripo') {
      const prop = (design.props ?? []).find(p => p.id === `prop-${poi.id}`);
      if (!prop) fail('fuel-prop-missing');
      else {
        // Ground just inside the slab outline vs the slab top (≤ 0.1 m step for karts driving on).
        const { geometry } = loadPropAsset(prop.asset), placement = propPlacement(prop, geometry);
        const [sx, , sz] = placement.scale, [cx, cz] = placement.centre;
        const u0 = (geometry.slab.min[0] - cx) * sx + .3, u1 = (geometry.slab.max[0] - cx) * sx - .3, v0 = -(geometry.slab.max[1] - cz) * sz + .3, v1 = -(geometry.slab.min[1] - cz) * sz - .3;
        let maxStep = 0, minStep = Infinity;
        for (let t = 0; t <= 1.0001; t += .05) for (const [u, v] of [[u0 + (u1 - u0) * t, v0], [u0 + (u1 - u0) * t, v1], [u0, v0 + (v1 - v0) * t], [u1, v0 + (v1 - v0) * t]]) {
          const [x, z] = placement.local(u, v), w = toWorld(x, 0, z);
          // the city ground under the slab: the first upward surface below the slab top
          const hit = fuelQueries.rayQuery({ x: w.x, y: placement.slabTopY - .005, z: w.z }, { x: 0, y: -2, z: 0 }, false);
          if (!hit) continue;
          const step = placement.slabTopY - hit.point.y; maxStep = Math.max(maxStep, step); minStep = Math.min(minStep, step);
        }
        entry.slab = { top: placement.slabTopY, lift: placement.lift, scale: placement.scale, maxStep, minStep };
        if (maxStep > .1001 || minStep < -.0001) fail('fuel-slab-step', entry.slab);
      }
    }
    // Drive straight out of the park pose until 2 m past the zone edge.
    const zoneExit = Fuel.drive(fuelContext, { at: poi.park.at, y: parkGround, heading: poi.park.heading, maxKmh: 30, timeoutMs: 15000, done: q => Fuel.distanceOutside([q.x, q.z], poi.zone) >= 2 });
    entry.driveOut = { ...zoneExit, trajectory: zoneExit.trajectory.filter((_, i) => i % 2 === 0) };
    if (!zoneExit.passed) fail('fuel-drive-out-failed', { reached: zoneExit.reached, automaticReset: zoneExit.automaticReset, fell: zoneExit.fell, stalled: zoneExit.stalled, final: zoneExit.final, error: zoneExit.error });
    // From the nearest road on the zone's level into the zone.
    const reach = Fuel.reachZone(fuelContext, fuelQueries, design, poi.zone, poi.y);
    entry.reach = reach;
    if (!reach.passed) fail('fuel-zone-unreachable', { road: reach.road, attempts: reach.attempts.map(a => ({ pathLength: a.pathLength, kerbs: a.kerbs, final: a.drive?.final, stalled: a.drive?.stalled, reset: a.drive?.automaticReset })) });
  }
  // Dropped-kerb ramps must not trip karts driving along the road past them.
  report.ramps = [];
  for (const ramp of (design.props ?? []).filter(p => p.kind === 'ramp')) {
    const up = Fuel.headingVector(ramp.heading), along = Fuel.headingVector(ramp.heading + 90);
    for (const direction of [1, -1]) {
      const start = [ramp.at[0] - up[0] - along[0] * direction * 12, ramp.at[1] - up[1] - along[1] * direction * 12];
      const pass = Fuel.drive(fuelContext, { at: start, y: ramp.from, heading: (ramp.heading + 90 * direction + 360) % 360, maxKmh: 40, timeoutMs: 8000, done: q => ((q.x - start[0]) * along[0] + (q.z - start[1]) * along[1]) * direction >= 24 });
      report.ramps.push({ id: ramp.id, direction, passed: pass.passed, maxSpeedKmh: pass.maxSpeedKmh, final: pass.final });
      if (!pass.passed) issue('ramp-road-pass-failed', { ramp: ramp.id, direction, automaticReset: pass.automaticReset, stalled: pass.stalled, final: pass.final });
    }
  }
} catch (error) {
  issue('verification-exception', { message: error.message, stack: error.stack });
}
report.failureCount = failures.length;
report.navigationWarningCount = navigationWarnings.length;
report.drivesPassed = report.drives.filter(d => d.reached && !d.automaticReset && !d.invalidPosition && d.lateralDeviation <= 2).length;
report.fuelPassed = (report.fuel ?? []).filter(f => f.driveOut?.passed && f.reach?.passed).length;
report.passed = failures.length === 0;
save();
console.log(JSON.stringify({ outputFile, passed: report.passed, failureCount: failures.length, navigationWarningCount: navigationWarnings.length, drivesPassed: report.drivesPassed, drivesTotal: report.drives.length, fuel: (report.fuel ?? []).map(f => ({ id: f.id, parkGround: f.parkGround, placementGround: f.placementGround, overlaps: f.parkBodyOverlaps, slabStep: f.slab && [+f.slab.minStep.toFixed(3), +f.slab.maxStep.toFixed(3)], driveOut: f.driveOut && { passed: f.driveOut.passed, distance: +f.driveOut.distance.toFixed(1), maxKmh: +f.driveOut.maxSpeedKmh.toFixed(0), final: f.driveOut.final }, reach: f.reach && { passed: f.reach.passed, road: f.reach.road?.road, roadDistance: f.reach.road && +f.reach.road.distance.toFixed(1), attempts: f.reach.attempts.length, entry: f.reach.entry } })), ramps: (report.ramps ?? []).map(r => `${r.id}${r.direction > 0 ? '+' : '-'}:${r.passed ? 'ok' : 'FAIL'}`), collisionTriangles: report.collisionTriangles, stats: report.stats, failures: failures.slice(0, 12), navigationWarnings: navigationWarnings.slice(0, 8) }));
assert.equal(failures.length, 0, 'Staged Vice City native verification failed; inspect the report');
