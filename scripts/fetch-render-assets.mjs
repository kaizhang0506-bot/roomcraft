import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setDefaultResultOrder} from 'node:dns';
setDefaultResultOrder('ipv4first');
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'public/assets/realistic');await mkdir(dir,{recursive:true});
const records=[];
async function save(url,name,credit,license,source){
 let cached;try{cached=await readFile(path.join(dir,name));}catch{}
 if(cached?.length){records.push({file:name,bytes:cached.length,sha256:createHash('sha256').update(cached).digest('hex'),credit,license,source,url});return;}
 let response;
 try{response=await fetch(url,{signal:AbortSignal.timeout(90000),headers:{'User-Agent':'RoomcraftPrototype/0.1 local asset preparation'}});}
 catch(error){if(!url.startsWith('https://raw.githubusercontent.com/'))throw error;url=url.replace('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/','https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/');response=await fetch(url,{signal:AbortSignal.timeout(90000)});}
 if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>25*1024*1024)throw Error('Asset exceeds size limit');
 if(name.endsWith('.glb')&&new TextDecoder().decode(bytes.slice(0,4))!=='glTF')throw Error('Invalid GLB');
 await writeFile(path.join(dir,name),bytes);records.push({file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),credit,license,source,url});
}
const textures=[['laminate_floor_02','oak'],['plastered_wall_02','plaster'],['marble_01','marble']];
await Promise.all(textures.map(async([id,stem])=>{
 const files=await (await fetch(`https://api.polyhaven.com/files/${id}`,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'RoomcraftPrototype/0.1'}})).json();
 await Promise.all([['Diffuse','color'],['nor_gl','normal'],['Rough','roughness']].map(async([key,suffix])=>{
  const file=files[key]?.['1k']?.jpg;if(!file)throw Error(`Missing ${id} ${key}`);
  await save(file.url,`${stem}-${suffix}.jpg`,'Poly Haven contributors','CC0-1.0',`https://polyhaven.com/a/${id}`);
 }));
}));
await Promise.all([
 save('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SheenWoodLeatherSofa/glTF-Binary/SheenWoodLeatherSofa.glb','sofa.glb','Darmstadt Graphics Group GmbH (2024), Eric Chadwick; original Fran Calvente (2021)','CC-BY-4.0 (improvements); CC0-1.0 (original)','https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenWoodLeatherSofa'),
 save('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SheenChair/glTF-Binary/SheenChair.glb','chair.glb','Wayfair, LLC (2020), Eric Chadwick','CC0-1.0','https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair'),
 save('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr','studio.hdr','Poly Haven contributors','CC0-1.0','https://polyhaven.com/a/brown_photostudio_02'),
]);
records.sort((a,b)=>a.file.localeCompare(b.file));
await writeFile(path.join(dir,'manifest.json'),JSON.stringify({assets:records,changes:'Assets are unmodified. The application scales furniture to editable dimensions and may tint cloned materials at runtime.',licenseURLs:{'CC0-1.0':'https://creativecommons.org/publicdomain/zero/1.0/','CC-BY-4.0':'https://creativecommons.org/licenses/by/4.0/'}},null,2));
await writeFile(path.join(dir,'NOTICE.txt'),`Roomcraft realistic assets\n\n${records.map(r=>`${r.file}\n${r.credit}\nLicense: ${r.license}\nSource: ${r.source}\n`).join('\n')}\nCC0: https://creativecommons.org/publicdomain/zero/1.0/\nCC BY 4.0: https://creativecommons.org/licenses/by/4.0/\nAssets are unmodified. Models may be resized and material tints adjusted at runtime. No creator endorsement is implied.\n`);
console.log(JSON.stringify({downloaded:records.length,bytes:records.reduce((n,r)=>n+r.bytes,0)}));
