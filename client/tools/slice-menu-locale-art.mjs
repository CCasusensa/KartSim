#!/usr/bin/env node
/** Geometry-only atlas preparation. Lettering is part of the imagegen PNG, never painted at runtime. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../assets/locale-ui/main-menu');
const groups={
 pro:['btn_proMission1_timeattack','btn_proMission2_shadow'],
 claim:['riderSchool_btn_emblem','riderSchool_btn_getlicense'],
 overview:['TimeAttack','License','Scenario','Training','Replay'].map(n=>`lobby_btn_${n}`),
 race:['btn_timeAttack01','btn_timeAttack02','btn_timeAttackCompetitive'],
 tabs:['cat_timeAttack','cat_riderSchool','cat_scenirio','cat_training','cat_replay'],
 license:[1,2,3,4,5,6].map(n=>`btn_riderSchool0${n}`),
 replay:['btn_replay01','btn_replay02','btn_replay03','cn_training01','cn_training02','cn_training03'],
};
const generation=JSON.parse(readFileSync(path.join(root,'generation.json'),'utf8'));
const selectedKind=process.argv.includes('--kind')?process.argv[process.argv.indexOf('--kind')+1]:undefined;
if(selectedKind&&!groups[selectedKind])throw Error('Unknown atlas '+selectedKind);
const entries=[];
for(const item of generation){
 const {kind,locale}=item;const rows=groups[kind];if(!rows)throw Error('Unknown atlas '+kind);
 const prepare=!selectedKind||kind===selectedKind;
 const width=kind==='tabs'?110:kind==='overview'?148:kind==='pro'?750:kind==='claim'?262:272,
  height=kind==='tabs'?32:kind==='overview'?318:kind==='pro'?230:kind==='claim'?76:134;
 const input=path.join(root,'source',`${kind}-${locale}.png`);
 const output=path.join(root,locale);mkdirSync(output,{recursive:true});
 const sheet=path.join(output,`${kind}-sheet.png`);
 if(prepare){
  // Imagegen can shift row boundaries by a few pixels. Crop each inspected row before resizing
  // so a neighboring card's background cannot bleed into the final sprite.
  if(item.rowCrops){
   if(item.rowCrops.length!==rows.length)throw Error(`Invalid row crops for ${kind}/${locale}`);
   const rowImages=item.rowCrops.flatMap(crop=>['(',input,'-crop',crop,'+repage','-resize',`${width*4}x${height}!`,')']);
   execFileSync('magick',[...rowImages,'-append','PNG32:'+sheet]);
  }else execFileSync('magick',[input,...(item.crop?['-crop',item.crop,'+repage']:[]),'-resize',`${width*4}x${height*rows.length}!`,'PNG32:'+sheet]);
 }
 item.sha256=createHash('sha256').update(readFileSync(input)).digest('hex');
 for(let row=0;row<rows.length;row++)for(let col=0;col<4;col++){
  const isRider=kind==='pro'||kind==='claim';
  const name=`${rows[row]}_${col+1}${isRider?'@cn':''}.png`;
  if(prepare)execFileSync('magick',[sheet,'-crop',`${width}x${height}+${col*width}+${row*height}`,'+repage','PNG32:'+path.join(output,name)]);
  entries.push({canonicalPath:`${isRider?'stage_/mainMenu/riderSchool':'zeta_/cn/stage/mainMenu'}/${name}`,locale,file:`${locale}/${name}`,width,height,provenance:`imagegen ${locale} localization of original ${isRider?'stage_mainMenu.rho':'zeta_cn_stage.rho'}; source/${kind}-${locale}.png; geometry-only atlas slicing`});
 }
}
writeFileSync(path.join(root,'generation.json'),JSON.stringify(generation,null,2)+'\n');
writeFileSync(path.join(root,'spec.json'),JSON.stringify({version:1,entries},null,2)+'\n');
console.log(`Prepared ${entries.length} menu sprites.`);
