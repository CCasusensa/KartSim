import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cityWaterLevel } from '../src/city/city-water.ts';
import { sampleRoad } from '../tools/city/city-roads.mjs';
import { designToWorld, worldToDesign } from '../src/city/city-coordinates.ts';

const map = JSON.parse(readFileSync(new URL('../src/city/city-map.json', import.meta.url)));

test('open terrain and highway shoulders are not classified as water', () => {
  // Keep the legacy map contract covered when the registered city changes.
  const world = {
    coast:[[-500,-400],[500,-400],[500,400],[-500,400]],
    river:[[-150,-250,30],[-150,250,10]],
    lake:{center:[200,100],radius:60,level:88},
    seaLevel:0,
  };
  for (const [x,z] of [[0,0],[100,-100],[-350,150],[350,-200],[100,300]])
    assert.equal(cityWaterLevel(world,x,z),undefined,`${x},${z}`);
  assert.equal(cityWaterLevel(world,550,450),0);
  assert.equal(cityWaterLevel(world,200,100),88);
  const [a,b] = world.river;
  const level = cityWaterLevel(world,(a[0]+b[0])/2,(a[1]+b[1])/2);
  assert.ok(Math.abs(level-(a[2]+b[2])/2)<1e-6,'river segment interpolates its water level');
  // A bridge's water surface is below its stored deck, so driving over water
  // cannot satisfy the session's submerged check.
  const bridge=[-150,0,26];
  assert.ok(bridge[2]>cityWaterLevel(world,bridge[0],bridge[1])+2);
});

test('an ocean plane reports sea height under islands and bridges without requiring one coastline', () => {
  const world = {kind:'ocean-plane',seaLevel:0};
  for (const [x,z,y] of [[-2400,-1600,3],[-900,1200,8],[250,2300,18]]) {
    const level = cityWaterLevel(world,x,z);
    assert.equal(level,0);
    assert.equal(y < level - 1.5,false,'above-water roads do not trigger recovery');
    assert.equal(-2 < level - 1.5,true,'a submerged kart does trigger recovery');
  }
  assert.equal(cityWaterLevel({kind:'ocean-plane',seaLevel:12},0,0),12);
  assert.equal(cityWaterLevel(undefined,0,0),undefined);
});

test('route resampling preserves elevated open roads and closed-loop seam', () => {
  const design={roadTypes:{expressway:{width:26}}};
  const terrain={height:()=>-1000};
  const open=sampleRoad(design,{type:'expressway',points:[[0,0,20],[100,0,40]],width:30},terrain,10);
  assert.equal(open.elevation[5],30);
  assert.equal(open.elevation.at(-1),40);
  assert.equal(open.width,30);
  const closed=sampleRoad(design,{type:'expressway',closed:true,points:[[0,0,10],[100,0,20],[100,100,30],[0,100,40]]},terrain,10);
  assert.equal(closed.elevation.at(-1),13);
  assert.ok(closed.elevation.every(Number.isFinite));
});

test('registered map coordinates use independent rectangular bounds and round trip', () => {
  const [[minX,minZ],[maxX,maxZ]]=map.meta.extent;
  assert.deepEqual(designToWorld(0,24,0),{x:-minX,y:24,z:-maxZ});
  assert.deepEqual(designToWorld(minX,24,maxZ),{x:0,y:24,z:0});
  assert.deepEqual(designToWorld(maxX,24,minZ),{x:maxX-minX,y:24,z:minZ-maxZ});
  for (const p of [{x:-1730,y:48,z:40},{x:1310,y:150,z:-900}]) {
    const w=designToWorld(p.x,p.y,p.z);
    assert.deepEqual(worldToDesign(w.x,w.y,w.z),p);
  }
});
