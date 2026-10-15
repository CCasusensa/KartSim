#!/usr/bin/env node
/** Geometry-only slicing of imagegen atlases and resizing of verified native Korean sprites. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/locale-ui/commerce');
const layouts=JSON.parse(readFileSync(path.join(root,'source/atlas-layout.json'),'utf8'));
const selectedAtlas=process.argv.includes('--atlas')?process.argv[process.argv.indexOf('--atlas')+1]:undefined;
if(selectedAtlas&&!layouts.some(atlas=>atlas.name===selectedAtlas))throw Error(`Unknown atlas: ${selectedAtlas}`);
const entries=[],generations=[];
const hash=file=>createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex');
function buttonCrop(sheet,cell){
  const x=cell.col*258,y=cell.row*66;
  const components=execFileSync('magick',[sheet,'-crop',`258x66+${x}+${y}`,'+repage','-alpha','extract','-threshold','50%',
    '-define','connected-components:verbose=true','-connected-components','8','null:'],{encoding:'utf8'});
  // Adjacent sprites may intrude into the nominal atlas cell. Only the largest opaque
  // component belongs to this button; retain its antialiased edge with one pixel of padding.
  const boxes=components.split('\n').map(line=>line.match(/^\s*\d+: (\d+)x(\d+)\+(\d+)\+(\d+) \S+ ([\d.]+) (?:srgb\(255,255,255\)|gray\(255\))$/)).filter(Boolean);
  boxes.sort((a,b)=>Number(b[5])-Number(a[5]));
  if(!boxes.length)throw Error(`No button found at ${x},${y}`);
  const [,w,h,bx,by]=boxes[0].map(Number),left=Math.max(0,bx-1),top=Math.max(0,by-1);
  return `${Math.min(258,bx+w+1)-left}x${Math.min(66,by+h+1)-top}+${x+left}+${y+top}`;
}
for(const atlas of layouts)for(const locale of ['en','ko']){
  if(atlas.name==='dictionary-tabs'&&locale==='ko')continue; // Verified native sprites have their own dictionary-ko spec.
  const input=`source/${atlas.name}-${locale}-generated.png`,prompt=`source/${atlas.name}-${locale}-prompt.txt`;
  if(!existsSync(path.join(root,input)))throw Error(`Missing imagegen result: ${input}`);
  const sheet=path.join(root,locale,`${atlas.name}-sheet.png`);mkdirSync(path.dirname(sheet),{recursive:true});
  const prepare=!selectedAtlas||selectedAtlas===atlas.name;
  if(prepare)execFileSync('magick',[path.join(root,input),'-resize',`${atlas.width}x${atlas.height}!`,sheet]);
  generations.push({input:`source/${atlas.name}-original.png`,prompt,output:input,outputSha256:hash(input)});
  for(const [index,cell]of atlas.cells.entries()){
    const filename=`${atlas.name}-${index+1}.png`,file=`${locale}/${filename}`,out=path.join(root,file);
    let provenance=`imagegen ${locale} complete sprite; ${input}; geometry-only resize and crop`;
    if(locale==='ko'&&cell.nativeKo){
      const native=`source/native-ko/${path.basename(cell.nativeKo)}`;
      if(prepare)execFileSync('magick',[path.join(root,native),'-resize',`${cell.width}x${cell.height}!`,out]);
      provenance=`Native Korean ${cell.nativeKo}; full-image resize to current release geometry`;
    }else if(!prepare){
      // Keep the other atlases byte-for-byte unchanged during a targeted crop correction.
    }else if(atlas.name==='lottery-controls'){
      execFileSync('magick',[sheet,'-crop',buttonCrop(sheet,cell),'+repage','-resize',`${cell.width}x${cell.height}!`,out]);
    }else if(atlas.name==='dictionary-tabs'&&(cell.col===0||cell.col===4)){
      // Keep the floating category caption clear of the adjacent generated sub-tab border.
      execFileSync('magick',[sheet,'-crop',`104x40+${cell.col*122+3}+${cell.row*48+4}`,'+repage','-resize',`${cell.width}x${cell.height}!`,out]);
    }else if(atlas.name==='dictionary-tabs'){
      // The generated sub-tabs are shifted within their cells. Use their inspected complete
      // rectangles, excluding the neighboring tab's white border and preserving every label.
      const bounds={1:[112,238],2:[240,364],3:[366,491],5:[596,723],6:[725,849],7:[850,976]}[cell.col];
      const top=[6,53,101,148,196,244,292,340][cell.row];
      execFileSync('magick',[sheet,'-crop',`${bounds[1]-bounds[0]}x41+${bounds[0]}+${top}`,'+repage','-resize',`${cell.width}x${cell.height}!`,out]);
    }else if(atlas.name==='commerce-details'){
      // Tiny marks remain complete (two animation frames side by side). Header/panel padding is intentional.
      if(locale==='ko'&&cell.canonicalPath.includes('eventbuycount')){execFileSync('magick',[sheet,'-crop','110x58+695+56','+repage','-trim','+repage','-resize',`${cell.width}x${cell.height}!`,out]);}
      else if(cell.canonicalPath.includes('collect_txt_mainTitle')){execFileSync('magick',[sheet,'-crop','200x50+50+740','+repage','-resize',`${cell.width}x${cell.height}!`,out]);}
      else if(cell.width>=292){execFileSync('magick',[sheet,'-crop',`${cell.width}x${cell.height}+${cell.x}+${cell.y}`,'+repage',out]);}
      else {execFileSync('magick',[sheet,'-crop',`${cell.width+12}x${cell.height+12}+${cell.x-6}+${cell.y-6}`,'+repage','-trim','+repage','-resize',`${cell.width}x${cell.height}!`,out]);}
    }else{execFileSync('magick',[sheet,'-crop',`${cell.width}x${cell.height}+${cell.x}+${cell.y}`,'+repage',out]);}
    for(const canonicalPath of [cell.canonicalPath,...(cell.aliases??[])])entries.push({canonicalPath,locale,file,width:cell.width,height:cell.height,provenance});
  }
}
writeFileSync(path.join(root,'spec.json'),JSON.stringify({version:1,generation:{tool:'imagegen',preparation:'node tools/slice-commerce-locale-art.mjs (requires ImageMagick)',atlases:generations},entries},null,2)+'\n');
console.log(`Prepared ${entries.length} complete localized commerce and collection sprites.`);
