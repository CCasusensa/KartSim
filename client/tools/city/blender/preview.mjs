// Local art/physics review surface. Uses the exported GLB and the same parsed
// track.1s, TrackWorld and AL kart dynamics as the game; no account required.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {y9,YW} from '../../../src/generated/formats.js';
import {_L} from '../../../src/generated/world.js';
import {AL} from '../../../src/generated/driving.js';
import {bundledVehicleSpecCatalog} from '../../../src/physics/bundled.ts';
import {vehiclePhysicsParameters} from '../../../src/driving/physics-parameters.ts';
import {cityWaterLevel} from '../../../src/city/city-water.ts';
import {groundHeightAt} from '../../../src/city/city-ground.ts';
import {applyCityVehicleScale, CITY_VEHICLE_SCALE} from '../../../src/city/city-vehicle-scale.ts';

const $=id=>document.getElementById(id);
const variants={
 'vice-city':{design:'/build/vice-city/out/kartcity-design.json',glb:'/build/vice-city/out/kartcity.glb',track:'/build/vice-city/native/track.1s'},
};

async function main(){
 const requested=new URLSearchParams(location.search).get('map');
 if(requested&&!variants[requested])throw Error(`未知地图：${requested}`);
 const variant=variants[requested];
 const mapResponse=await fetch(variant?.design??'/src/city/city-map.json');
 if(!mapResponse.ok)throw Error('地图尚未生成，请先生成地图后再刷新预览。');
 const map=await mapResponse.json();
 const assets={glb:'/build/blender/out/kartcity.glb',track:'/build/kartcity/track.1s',...map.meta.preview,...variant};
 const [[minX,minZ],[maxX,maxZ]]=map.meta.extent;
 const width=maxX-minX,depth=maxZ-minZ,size=Math.max(width,depth),offsetX=-minX,offsetZ=maxZ;
 if(![minX,minZ,maxX,maxZ].every(Number.isFinite)||width<=0||depth<=0)throw Error('地图边界无效。');
 const centerX=(minX+maxX)/2,centerZ=(minZ+maxZ)/2;
 const title=map.meta.name??'卡丁城';
 const districts=map.districts??[],spawns=map.pois.filter(p=>p.kind==='spawn');
 if(!spawns.length)throw Error('地图缺少出生点。');
 document.title=title;
 $('map-title').textContent=title;
 $('map-summary').textContent=`${(width/1000).toFixed(1)} × ${(depth/1000).toFixed(1)} km · ${districts.length} 个区域 · 自由驾驶与探索`;
 $('loading-title').textContent=`准备${title.replace(/^卡丁城\s*[·・]?\s*/,'')}`;

 // Build the recovery index from the map being previewed, not the registered
 // game's JSON: a staged city may use entirely different roads and offsets.
 const segments=[];
 for(const road of map.roads){
  const count=road.closed?road.points.length:road.points.length-1;
  for(let i=0;i<count;i++){
   const a=road.points[i],b=road.points[(i+1)%road.points.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
   if(length>0)segments.push({a,b,dx,dz,length});
  }
 }
 if(!segments.length)throw Error('地图缺少可用于复位的道路。');
 function nearestRoadPoint(x,z){
  let best,bestDistance=Infinity;
  for(const {a,b,dx,dz,length} of segments){
   const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(length*length)));
   const px=a[0]+dx*t,pz=a[1]+dz*t,distance=(x-px)**2+(z-pz)**2;
   if(distance<bestDistance){bestDistance=distance;best={x:px,z:pz,y:(a[2]??0)+((b[2]??0)-(a[2]??0))*t,tx:dx/length,tz:dz/length};}
  }
  return best;
 }

 const scene=new THREE.Scene();scene.background=new THREE.Color('#b6dbe5');
 const camera=new THREE.PerspectiveCamera(46,innerWidth/innerHeight,.1,Math.max(12000,size*3));
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,logarithmicDepthBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
 document.body.prepend(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0xebf5ff,0x74805a,2));
 const sun=new THREE.DirectionalLight(0xffefd3,2.6);sun.position.set(centerX-600,1600,centerZ+400);sun.target.position.set(centerX,0,centerZ);scene.add(sun,sun.target);
 const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.maxDistance=size*2;orbit.maxPolarAngle=Math.PI*.48;
 let mode='overview',physics,track,selected=spawns.find(p=>p.id==='spawn-main')??spawns[0],clock=10000,previous=0,frameCount=0,lastFps=0;
 const keys=new Set();
 const kart=new THREE.Group();scene.add(kart);kart.visible=false;kart.scale.setScalar(CITY_VEHICLE_SCALE);
 function part(geometry,color,x,y,z){const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.7}));mesh.position.set(x,y,z);kart.add(mesh);return mesh;}
 part(new THREE.BoxGeometry(1.55,.45,2.5),0xec674d,0,.55,0);
 part(new THREE.BoxGeometry(1.1,.25,.8),0xfbe2a3,0,.82,.55);
 part(new THREE.BoxGeometry(.8,.65,.7),0x194951,0,1,-.3);
 for(const x of [-.91,.91])for(const z of [-.83,.8]){const wheel=part(new THREE.CylinderGeometry(.38,.38,.28,12),0x24303a,x,.35,z);wheel.rotation.z=Math.PI/2;}
 const neutral={forward:0,reverse:0,steer:0,rawSteer:0,steeringInverted:false,rawDriftHeld:false,derivedDriftHeld:false,actionMarkerWord:0};
 function ground(x,z,y=0){return groundHeightAt(track,x+offsetX,z-offsetZ,y)??y;}
 function place(p){selected=p;const x=p.at[0],z=p.at[1],h=ground(x,z,p.y);physics.reset(x+offsetX,h+.4,z-offsetZ,Math.PI-(p.heading??0)*Math.PI/180);physics.synchronizeClock(clock);track.resetRouteState(physics,physics.body.position);keys.clear();if(mode==='drive')follow(1);}
 function overview(){mode='overview';keys.clear();orbit.enabled=true;kart.visible=false;camera.position.set(centerX+size*.04,size*.88,centerZ+size*.9);orbit.target.set(centerX,0,centerZ);scene.fog=null;$('overview').classList.add('active');$('drive').classList.remove('active');}
 function drive(){if(!physics)return;mode='drive';orbit.enabled=false;kart.visible=true;const fogFar=Math.max(1500,map.meta.cameraFar??size*.6);scene.fog=new THREE.Fog(0xb6dbe5,fogFar*.4,fogFar);place(selected);$('drive').classList.add('active');$('overview').classList.remove('active');}
 function follow(alpha){const b=physics.body;const pos=new THREE.Vector3(b.position.x-offsetX,b.position.y,b.position.z+offsetZ);kart.position.copy(pos);const matrix=new THREE.Matrix4().makeBasis(new THREE.Vector3(b.right.x,b.right.y,b.right.z),new THREE.Vector3(b.up.x,b.up.y,b.up.z),new THREE.Vector3(b.forward.x,b.forward.y,b.forward.z));kart.quaternion.setFromRotationMatrix(matrix);const eye=pos.clone().add(new THREE.Vector3(-b.forward.x*11,5.5,-b.forward.z*11));camera.position.lerp(eye,alpha);camera.lookAt(pos.clone().add(new THREE.Vector3(b.forward.x*14,1.8,b.forward.z*14)));}
 function reset(){const b=physics.body.position,p=nearestRoadPoint(b.x-offsetX,b.z+offsetZ);place({name:'最近道路',at:[p.x,p.z],y:p.y,heading:(Math.atan2(p.tx,-p.tz)*180/Math.PI+360)%360});}
 for(const spawn of spawns){const button=document.createElement('button');button.textContent=spawn.name.replace(/(出生点|入口|山口)/g,'');button.onclick=()=>{selected=spawn;document.querySelectorAll('.regions button').forEach(b=>b.classList.remove('active'));button.classList.add('active');if(mode==='drive')place(spawn);else{const x=spawn.at[0],z=spawn.at[1],y=spawn.y??0;camera.position.set(x+400,y+530,z+650);orbit.target.set(x,y,z);}};$('regions').append(button);}
 $('overview').onclick=overview;$('drive').onclick=drive;
 window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='KeyR'&&physics)reset();});
 window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
 window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
 const [gltf,bytes]=await Promise.all([new GLTFLoader().loadAsync(assets.glb),fetch(assets.track).then(r=>{if(!r.ok)throw Error('请先生成并导入地图');return r.arrayBuffer();})]);
 gltf.scene.traverse(obj=>{if(!obj.isMesh)return;const mats=Array.isArray(obj.material)?obj.material:[obj.material];if(mats.some(m=>m.userData.kr_collider))obj.visible=false;obj.updateMatrix();obj.matrixAutoUpdate=false;});scene.add(gltf.scene);
 $('progress').textContent='准备道路与试驾…';await new Promise(resolve=>requestAnimationFrame(resolve));
 const data={...YW(y9(new Uint8Array(bytes)),'time-attack',{roadExtent:size+1}),resourceVersion:'p3553',trackId:'kartcity'};
 track=new _L(data,new THREE.Group());
 const spec=bundledVehicleSpecCatalog().lookup(373,7).spec;
 physics=new AL(vehiclePhysicsParameters(spec,{autoChargeLowSpeed:100,driftGaugeReset:true,wheelPosition:.85},5),{rawHalfWidth:.9,rawHalfLength:1.5,scaleX:1,scaleY:1,rawHeight:1});
 applyCityVehicleScale(physics);
 place(selected);overview();$('loading').style.display='none';$('drive').disabled=false;
 // Keep the historical alias for existing local review scripts.
 window.cityPreview=window.continentPreview={physics,track,map,scene,camera,keys,place,drive,overview,reset,renderer,assets,offsetX,offsetZ,nearestRoadPoint,get mode(){return mode;}};
 function frame(now){requestAnimationFrame(frame);const dt=Math.min(32,previous?now-previous:16);previous=now;clock+=dt;
  if(mode==='drive'){
   const steer=(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')?1:0),drift=keys.has('ShiftLeft')||keys.has('ShiftRight');
   physics.update(clock,{...neutral,forward:keys.has('KeyW')||keys.has('ArrowUp')?1:0,reverse:keys.has('KeyS')||keys.has('ArrowDown')?1:0,steer,rawSteer:steer,rawDriftHeld:drift,derivedDriftHeld:drift},track);
   const p=physics.body.position,water=cityWaterLevel(map.world,p.x-offsetX,p.z+offsetZ);
   const belowWorld=p.y< -6&&p.y<nearestRoadPoint(p.x-offsetX,p.z+offsetZ).y-6;
   if(belowWorld||(water!==undefined&&p.y<water-1.5)||physics.consumeAutomaticResetRequest())reset();
   follow(1-Math.exp(-dt/100));$('speed').textContent=Math.round(physics.displaySpeedKmh());$('unit').textContent='km/h';
  }else{orbit.update();$('speed').textContent=String(map.roads.length);$('unit').textContent='条道路';}
  renderer.render(scene,camera);frameCount++;if(now-lastFps>1000){const fps=Math.round(frameCount*1000/(now-lastFps));lastFps=now;frameCount=0;$('status').textContent=`${mode==='drive'?(selected.name??'最近道路').replace('出生点',''):`全境 / ${districts.length} 个区域`} · ${fps} FPS\n${mode==='drive'?'沿街道与沿海公路自由探索':'旋转视角，选择区域查看地标'}`;}
 }requestAnimationFrame(frame);
}
main().catch(error=>{$('error').textContent=error.message;console.error(error);});
