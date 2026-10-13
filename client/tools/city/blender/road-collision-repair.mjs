// Some Vice City bridge shells contain a reversed copy of the asphalt face.
// Preserve its rendering, but let the upward asphalt be the sole collision.
// The real underside below the deck and all wall faces remain solid.
import { transformPoint } from './glb.mjs';

const key = points => points.map(p=>p.map(v=>Math.round(v*1000)).join(',')).sort().join('|');
function upNormal(points) {
  const [a,b,c]=points, x=b.map((v,i)=>v-a[i]), y=c.map((v,i)=>v-a[i]);
  const n=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  return n[1]/(Math.hypot(...n)||1);
}

export function coplanarRoadFilter(glb, materialNames) {
  const names=new Set(materialNames), upward=new Set();
  for(const {mesh,world} of glb.instances()) for(const p of mesh?.primitives??[]) {
    const material=glb.json.materials[p.material];
    const name=(material?.name??'').replace(/__vc_[a-f\d]+$/i,'').replace(/\.\d+$/,'');
    if(!names.has(name)||!material?.extras?.kr_road) continue;
    const positions=glb.accessor(p.attributes.POSITION).map(v=>transformPoint(world,v));
    const indices=p.indices===undefined?positions.map((_,i)=>i):glb.accessor(p.indices);
    for(let i=0;i<indices.length;i+=3) {
      const triangle=[positions[indices[i]],positions[indices[i+1]],positions[indices[i+2]]];
      if(upNormal(triangle)>.65) upward.add(key(triangle));
    }
  }
  return points=>upNormal(points)<-.65&&upward.has(key(points));
}
