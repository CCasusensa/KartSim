#!/usr/bin/env node
/** Crop only the empty atlas border; each final sprite includes its translated lettering. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../assets/locale-ui/menu-guide');
const entries=[];
for(const row of JSON.parse(fs.readFileSync(path.join(root,'generation.json'),'utf8'))){
 const output=path.join(root,row.locale);fs.mkdirSync(output,{recursive:true});
 const sheet=path.join(output,'sheet.png');
 execFileSync('magick',[path.join(root,'source',row.locale+'.png'),'-crop',row.crop,'+repage','-resize','644x80!','PNG32:'+sheet]);
 for(let state=1;state<=4;state++){
  const name=`btn_watchingGuide_${state}@zz.png`;
  execFileSync('magick',[sheet,'-crop',`322x40+${(state-1)%2*322}+${Math.floor((state-1)/2)*40}`,'+repage','PNG32:'+path.join(output,name)]);
  entries.push({canonicalPath:`stage_/mainMenu/riderSchool/${name}`,locale:row.locale,file:`${row.locale}/${name}`,width:322,height:40,provenance:'imagegen localization of original Korean guide sprite, with geometry-only atlas cropping'});
 }
}
fs.writeFileSync(path.join(root,'spec.json'),JSON.stringify({version:1,entries},null,2)+'\n');
console.log(`Prepared ${entries.length} guide sprites.`);
