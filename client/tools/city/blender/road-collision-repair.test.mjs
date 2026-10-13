import assert from 'node:assert/strict';
import test from 'node:test';
import { coplanarRoadFilter } from './road-collision-repair.mjs';
import { IDENTITY } from './glb.mjs';

test('a duplicate downward bridge shell loses collision while the real underside remains solid',()=>{
  const top=[[0,25,0],[0,25,10],[10,25,0]];
  const source={json:{materials:[{name:'asphalt',extras:{kr_road:'{}'}}]},instances:()=>[{world:IDENTITY,mesh:{primitives:[{attributes:{POSITION:0},material:0}]}}],accessor:()=>top};
  const suppress=coplanarRoadFilter(source,['asphalt']);
  assert.equal(suppress([top[2],top[1],top[0]]),true);
  assert.equal(suppress(top),false,'the usable upward face stays solid');
  assert.equal(suppress([top[2],top[1],top[0]].map(p=>[p[0],23,p[2]])),false,'the true underside stays solid');
  assert.equal(suppress([[0,25,0],[0,35,0],[10,25,0]]),false,'walls remain solid');
});

test('unrelated upward building faces cannot suppress a ceiling',()=>{
  const top=[[0,25,0],[0,25,10],[10,25,0]];
  const source={json:{materials:[{name:'roof',extras:{kr_road:'{}'}}]},instances:()=>[{world:IDENTITY,mesh:{primitives:[{attributes:{POSITION:0},material:0}]}}],accessor:()=>top};
  assert.equal(coplanarRoadFilter(source,['asphalt'])([top[2],top[1],top[0]]),false);
});
