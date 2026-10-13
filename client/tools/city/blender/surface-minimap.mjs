// Rasterize the imported city itself into the native 256-unit HUD projection.
// A height buffer keeps building roofs above terrain regardless of mesh order.
import { encodePng } from '../png.mjs';

export class SurfaceMinimap {
  constructor(design) {
    this.size = 1024;
    const [[x0,z0],[x1,z1]] = design.meta.extent;
    this.cx=(x0+x1)/2; this.cz=(z0+z1)/2;
    this.scale=944/Math.max(x1-x0,z1-z0);
    this.rgba=new Uint8Array(this.size*this.size*4);
    this.height=new Float32Array(this.size*this.size).fill(-Infinity);
    for(let i=0;i<this.height.length;i++) this.rgba.set([34,82,108,255],i*4);
  }
  triangle(a,b,c,name) {
    const up=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    if(up<.01 || /WATER/i.test(name)) return;
    const road=/ROAD2|ROAD1256|DT_ROAD|TARMAC|RUNWAY|STOPLINE|ROADJUNCT|ROOSVELTBRIDGE|BOW_ROAD/i.test(name);
    // Design props are named PROP_<asset>; fuel stations show as an orange roof.
    const color=/^PROP_c_gasstation/.test(name)?[240,150,40]:road?[220,220,201]:/GRASS|LEAF|TREE|BUSH/i.test(name)?[99,143,103]:/SAND|BEACH/i.test(name)?[201,188,146]:[136,157,150];
    const p=[a,b,c].map(v=>[512+(v[0]-this.cx)*this.scale,512+(v[2]-this.cz)*this.scale,v[1]]);
    const [u,v,w]=p;
    const den=(v[1]-w[1])*(u[0]-w[0])+(w[0]-v[0])*(u[1]-w[1]);
    if(Math.abs(den)<1e-10) return;
    const y0=Math.max(0,Math.floor(Math.min(u[1],v[1],w[1]))),y1=Math.min(1023,Math.ceil(Math.max(u[1],v[1],w[1])));
    const x0=Math.max(0,Math.floor(Math.min(u[0],v[0],w[0]))),x1=Math.min(1023,Math.ceil(Math.max(u[0],v[0],w[0])));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
      const f=((v[1]-w[1])*(x+.5-w[0])+(w[0]-v[0])*(y+.5-w[1]))/den;
      const g=((w[1]-u[1])*(x+.5-w[0])+(u[0]-w[0])*(y+.5-w[1]))/den;
      if(f<-.01||g<-.01||f+g>1.01) continue;
      const h=f*u[2]+g*v[2]+(1-f-g)*w[2],i=y*1024+x;
      if(h<=this.height[i]) continue;
      this.height[i]=h;
      this.rgba[i*4]=color[0];this.rgba[i*4+1]=color[1];this.rgba[i*4+2]=color[2];
    }
  }
  png() { return encodePng(1024,1024,this.rgba); }
}
