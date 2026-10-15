#!/usr/bin/env node
/** Rebuild the independently mounted locale_ui.rho from the reviewed image manifests. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildLocalizedPngPack} from './pack-localized-png.mjs';
import {registerContainer} from './city/register-container.mjs';
const client=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.join(client,'assets/locale-ui');
const entries=[];
const sources=[];
for(const dir of fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
 const folder=path.join(root,dir.name);
 const file=['spec.json','manifest.json'].map(n=>path.join(folder,n)).find(f=>fs.existsSync(f));
 if(!file)continue;
 const spec=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(spec.entries))throw Error('Missing entries in '+file);
 sources.push(path.relative(root,file));
 entries.push(...spec.entries.map(row=>({...row,file:path.resolve(folder,row.file)})));
}
const {bytes,manifest}=await buildLocalizedPngPack({entries},root);
const out=path.join(client,'build/localized-ui');fs.mkdirSync(out,{recursive:true});
const containerPath=path.join(out,'locale_ui.rho');fs.writeFileSync(containerPath,bytes);
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({...manifest,sources},null,2)+'\n');
await registerContainer({mirrorRoot:path.dirname(client),containerPath});
console.log(`Registered ${manifest.entries.length} complete PNGs from ${sources.length} manifests (${bytes.length} bytes).`);
