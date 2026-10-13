import assert from 'node:assert/strict';
import test from 'node:test';
import {groundHeightAt} from '../src/city/city-ground.ts';
import {StaticTrackSurface} from '../src/world/static-track-surface.ts';

function planes(...levels) {
  const triangles=levels.flatMap(([y,up])=>{
    const a={x:-4,y,z:-4},b={x:-4,y,z:4},c={x:4,y,z:-4},d={x:4,y,z:4};
    return (up?[[a,b,c],[c,b,d]]:[[c,b,a],[d,b,c]]).map(([a,b,c])=>({
      a,b,c,normal:{x:0,y:up?1:-1,z:0},roadDescriptor:{},auxiliaryDirection:{x:0,y:0,z:0},
    }));
  });
  const unusedObb=()=>false;
  const surface=new StaticTrackSurface(triangles,unusedObb,{
    p3553ObbQuery:unusedObb,p3553ObbBounds:()=>{},roadDescriptorIssue:()=>undefined,
  });
  return {
    surface,
    rayQuery(origin,movement,includeWalls){
      const fraction=surface.queryBest(origin,movement,includeWalls);
      return Number.isFinite(fraction)?surface.buildHit(origin,movement,fraction):undefined;
    },
  };
}

test('city placement chooses the bridge deck, not its solid underside within the height tolerance',()=>{
  const bridge=planes([25.1475,true],[23.19,false],[9,true]);
  // Native downward rays really do hit this ceiling from inside the deck;
  // the fix must reject it for standing without deleting its collision.
  const underside=bridge.rayQuery({x:0,y:24,z:0},{x:0,y:-4,z:0},false);
  assert.ok(Math.abs(underside.point.y-23.19)<.001);
  assert.equal(underside.normal.y,-1);
  assert.ok(Math.abs(groundHeightAt(bridge,0,0,25.1475)-25.1475)<.001);
  assert.equal(bridge.surface.triangles.length,6,'all bridge and lower-road collision remains');
  assert.ok(Math.abs(groundHeightAt(bridge,0,0,9)-9)<.001,'the road below the bridge is still selectable');
});

test('city placement follows an underground floor past a downward tunnel ceiling',()=>{
  const tunnel=planes([22,true],[-6,false],[-12,true]);
  assert.ok(Math.abs(groundHeightAt(tunnel,0,0,-12)+12)<.001);
});

test('a column containing only a ceiling has no standing surface',()=>{
  assert.equal(groundHeightAt(planes([23.19,false]),0,0,25.1475),undefined);
});
