// Staged native conversion directly from the six source GLBs. This adapter
// preserves the source world, restores audited alpha, and shares the regular
// importCity implementation with Blender exports. It never registers a map.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix3, Matrix4 } from 'three';
import { IDENTITY, readGlb, transformPoint } from './glb.mjs';

const client = fileURLToPath(new URL('../../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizedName = name => (name ?? '').toUpperCase().replace(/\.\d{3}$/, '');
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

// Kept equivalent to vice_city_scene.py classify_materials. Image alpha comes
// from Blender's full-resolution PNG audit, not glTF's incorrect OPAQUE flag.
function classify(name, alpha) {
  name = normalizedName(name);
  const hasAlpha = (alpha?.nonOpaqueFraction ?? 0) > 0;
  const ground = /^(ROAD|GRASS|GRVL|SAND|TARMAC)|PAVE|CONCRETE|CONC_|DIRT|SIDEWALK/.test(name);
  const water = /WATERCLEAR|(?:^|_)WATER(?:_|\d|$)|STARWATER|SPAD_WATER/.test(name);
  const structure = !hasAlpha && /PLANTER|PALMBARK|TREE_RINGS|HEDGEWALL|^KBTREE3_TEST$/.test(name);
  const sign = new Set(['DT_MOISTPALMS1', 'SHADYPALMS', 'DT_POSH_HOTEL_STREETNUMBER']).has(name);
  const plant = !ground && !structure && /LEAF|LEAV|PALM|(?<!S)TREE|BUSH|HEDGE|FERN|PLANT|WATERLILI/.test(name);
  const plane = /BILL|ADVERT|(?<!DE)SIGN|POSTER|ALFA|ALPHA|FENCE|GRILL|(?:^|_)NET(?:_|\d|$)/.test(name);
  const category = water ? 'water' : sign ? 'decorative-plane' : plant ? 'foliage' : ground ? 'solid' : hasAlpha ? 'alpha-detail' : plane ? 'decorative-plane' : 'solid';
  return {category, alphaMode: hasAlpha ? water ? 'BLEND' : 'MASK' : 'OPAQUE'};
}

function normalTransform(matrix, normal) {
  const x=matrix[0]*normal[0]+matrix[3]*normal[1]+matrix[6]*normal[2];
  const y=matrix[1]*normal[0]+matrix[4]*normal[1]+matrix[7]*normal[2];
  const z=matrix[2]*normal[0]+matrix[5]*normal[1]+matrix[8]*normal[2];
  const length=Math.hypot(x,y,z)||1;
  return [x/length,y/length,z/length];
}

function hashAccessor(digest, name, values) {
  digest.update(name + '\0');
  const flat = values.length && Array.isArray(values[0]) ? values.flat() : values;
  digest.update(new Uint8Array(Float64Array.from(flat).buffer));
}

export async function loadViceCitySource({
  sourceDir = path.join(client, 'build/vice-city/source'),
  classificationPath = path.join(client, 'build/vice-city/out/vice-city-surface-classes.json'),
  reportPath = path.join(client, 'build/vice-city/native-source/source-adapter-report.json'),
} = {}) {
  const started=Date.now(), classes=JSON.parse(readFileSync(classificationPath,'utf8'));
  const alphaByImage=new Map(), oldClassByMaterial=new Map();
  for(const record of classes){
    if(record.image){
      const previous=alphaByImage.get(record.image);
      if(previous && stable(previous)!==stable(record.alpha)) throw Error(`Conflicting alpha audit for ${record.image}`);
      alphaByImage.set(record.image,record.alpha);
    }
    oldClassByMaterial.set(`${normalizedName(record.name)}|${record.image??''}`,record.category);
  }
  const json={asset:{version:'2.0',generator:'Vice City audited source adapter'},materials:[],textures:[],images:[],samplers:[],accessors:[]};
  const images=[],accessors=[],instances=[],materialKeys=new Map(),imageKeys=new Map(),textureKeys=new Map(),samplerKeys=new Map(),geometryKeys=new Set();
  const report={sourceDir:path.resolve(sourceDir),classificationPath:path.resolve(classificationPath),scale:100,coordinateSystem:'Y up; X east; Z south; original world origin retained',sources:[],sourceInstances:0,sourcePrimitives:0,sourceTriangles:0,keptPrimitives:0,keptTriangles:0,collisionTriangles:0,duplicatePrimitives:0,duplicateTriangles:0,bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},classes:{},classificationChanges:[],warnings:[],geometrySignaturePolicy:'Exact transformed Float64 positions, inverse-transpose normals, all source attributes, indices and restored material signature; primitive signatures sorted for aggregate hash'};
  const geometricKeys=[],collisionKeys=[];
  for(let part=1;part<=6;part++){
    const file=path.join(sourceDir,`bolum${part}.glb`),source=readGlb(file),j=source.json;
    const partReport={file:path.basename(file),instances:0,primitives:0,triangles:0,kept:0,duplicates:0};
    const localImages=j.images.map((_,i)=>{
      const image=source.image(i);if(!image)throw Error(`${file}: external image ${i} is unsupported`);
      if(!['image/png','image/jpeg'].includes(image.mimeType))throw Error(`${file}: unsupported image type ${image.mimeType}`);
      const sha256=hash(image.bytes),name=`vc_${sha256.slice(0,24)}`;
      if(!imageKeys.has(sha256)){
        imageKeys.set(sha256,images.length);images.push({...image,name,sha256});json.images.push({name,mimeType:image.mimeType});
      }
      return imageKeys.get(sha256);
    });
    const localTextures=(j.textures??[]).map(texture=>{
      const sampler=j.samplers?.[texture.sampler]??{},samplerKey=stable(sampler);
      if(!samplerKeys.has(samplerKey)){samplerKeys.set(samplerKey,json.samplers.length);json.samplers.push(sampler);}
      const normalized={...texture,source:localImages[texture.source],sampler:samplerKeys.get(samplerKey)};
      const key=stable(normalized);
      if(!textureKeys.has(key)){textureKeys.set(key,json.textures.length);json.textures.push(normalized);}
      return textureKeys.get(key);
    });
    const localMaterials=(j.materials??[]).map(material=>{
      const baseImage=material.pbrMetallicRoughness?.baseColorTexture?.index;
      const image=baseImage===undefined?undefined:images[localImages[j.textures[baseImage].source]];
      const alpha=image?alphaByImage.get(image.name):undefined;
      if(image&&!alpha)throw Error(`${file}: texture ${image.name} has no matching alpha audit`);
      const restored=classify(material.name,alpha),old=oldClassByMaterial.get(`${normalizedName(material.name)}|${image?.name??''}`);
      if(old&&old!==restored.category&&!report.classificationChanges.some(r=>r.name===normalizedName(material.name)&&r.image===image?.name)) report.classificationChanges.push({name:normalizedName(material.name),image:image?.name,old,updated:restored.category});
      const normalized=structuredClone(material);delete normalized.name;
      function remapTextures(obj){for(const [key,value] of Object.entries(obj??{})){if(value&&typeof value==='object'){if(key.endsWith('Texture')&&value.index!==undefined)value.index=localTextures[value.index];else remapTextures(value);}}}
      remapTextures(normalized);
      normalized.pbrMetallicRoughness={...normalized.pbrMetallicRoughness,metallicFactor:0,roughnessFactor:1};
      normalized.alphaMode=restored.alphaMode;
      if(restored.alphaMode==='MASK')normalized.alphaCutoff=.5;
      normalized.extras={...normalized.extras,kr_road:restored.category==='solid'?'{}':'',vc_surface_class:restored.category};
      const key=hash(stable(normalized));
      if(!materialKeys.has(key)){
        materialKeys.set(key,json.materials.length);
        json.materials.push({...normalized,name:`${normalizedName(material.name)||'material'}__vc_${key.slice(0,12)}`});
        report.classes[restored.category]=(report.classes[restored.category]??0)+1;
      }
      return materialKeys.get(key);
    });
    for(const instance of source.instances()){
      if(!instance.mesh)continue;
      report.sourceInstances++;partReport.instances++;
      const normalMatrix=new Matrix3().getNormalMatrix(new Matrix4().fromArray(instance.world)).elements;
      for(const primitive of instance.mesh.primitives){
        if((primitive.mode??4)!==4)throw Error(`${file}: non-triangle primitive`);
        const material=localMaterials[primitive.material];
        if(material===undefined)throw Error(`${file}: unclassified material in ${instance.node.name}`);
        const attributes={};
        for(const [name,index] of Object.entries(primitive.attributes)){
          let values=source.accessor(index);
          if(name==='POSITION')values=values.map(p=>transformPoint(instance.world,p).map(v=>v*100));
          else if(name==='NORMAL')values=values.map(n=>normalTransform(normalMatrix,n));
          attributes[name]=values;
        }
        const indices=primitive.indices===undefined?attributes.POSITION.map((_,i)=>i):source.accessor(primitive.indices);
        const digest=createHash('sha256');
        for(const name of Object.keys(attributes).sort())hashAccessor(digest,name,attributes[name]);
        hashAccessor(digest,'INDICES',indices);
        const geometryKey=digest.copy().digest('hex');
        digest.update(stable(json.materials[material]));
        const key=digest.digest('hex'),triangles=indices.length/3;
        report.sourcePrimitives++;report.sourceTriangles+=triangles;partReport.primitives++;partReport.triangles+=triangles;
        if(geometryKeys.has(key)){report.duplicatePrimitives++;report.duplicateTriangles+=triangles;partReport.duplicates++;continue;}
        geometryKeys.add(key);geometricKeys.push(geometryKey);
        if(json.materials[material].extras.kr_road){report.collisionTriangles+=triangles;collisionKeys.push(geometryKey);}
        report.keptPrimitives++;report.keptTriangles+=triangles;partReport.kept++;
        for(const p of attributes.POSITION)for(let axis=0;axis<3;axis++){report.bounds.min[axis]=Math.min(report.bounds.min[axis],p[axis]);report.bounds.max[axis]=Math.max(report.bounds.max[axis],p[axis]);}
        const translated={mode:4,material,attributes:{}};
        // Store lazy accessors so ~600 MB of source buffers are retained once,
        // rather than also retaining millions of nested geometry arrays.
        for(const [name,index] of Object.entries(primitive.attributes)){
          translated.attributes[name]=accessors.length;
          accessors.push({source,index,name,world:instance.world,normalMatrix});
          json.accessors.push({...j.accessors[index],bufferView:undefined});
        }
        translated.indices=accessors.length;
        accessors.push(primitive.indices===undefined?{generated:indices}:{source,index:primitive.indices,name:'INDICES'});
        json.accessors.push({type:'SCALAR',componentType:5125,count:indices.length});
        instances.push({index:instances.length,node:{name:`vc${part}_${instance.node.name??'mesh'}`,extras:{source_part:path.basename(file)}},mesh:{primitives:[translated]},world:IDENTITY});
      }
    }
    report.sources.push(partReport);
    console.log(`Vice City source part ${part}: ${partReport.kept} kept / ${partReport.duplicates} duplicate primitives`);
  }
  report.materials=json.materials.length;report.images=images.length;report.imageBytes=images.reduce((n,image)=>n+image.bytes.length,0);
  report.geometryHash=hash(geometricKeys.sort().join('\n'));report.collisionGeometryHash=hash(collisionKeys.sort().join('\n'));report.elapsedSeconds=(Date.now()-started)/1000;
  if(reportPath){mkdirSync(path.dirname(path.resolve(reportPath)),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
  return {json,report,image:index=>images[index],instances:()=>instances,accessor(index){
    const entry=accessors[index];if(!entry)throw Error(`Unknown source adapter accessor ${index}`);
    if(entry.generated)return entry.generated;
    const values=entry.source.accessor(entry.index);
    if(entry.name==='POSITION')return values.map(p=>transformPoint(entry.world,p).map(v=>v*100));
    if(entry.name==='NORMAL')return values.map(n=>normalTransform(entry.normalMatrix,n));
    return values;
  }};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  loadViceCitySource({sourceDir:process.argv[2],classificationPath:process.argv[3],reportPath:process.argv[4]}).then(source=>console.log(JSON.stringify(source.report,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
}
