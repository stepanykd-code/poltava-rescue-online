import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,basename} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),out=resolve(root,'_site');
if(dirname(out)!==resolve(root)||basename(out)!=='_site')throw new Error('Unexpected build output');
const files=['index.html','style.css',...JSON.parse(await readFile(resolve(root,'scripts/public-files.json'),'utf8')),'.nojekyll'];
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const file of files){const target=resolve(out,file);await mkdir(dirname(target),{recursive:true});await copyFile(resolve(root,file),target);}
const endpoint=process.env.ROOM_SERVER_URL||'';
if(endpoint){const url=new URL(endpoint);if(!['https:','http:','wss:','ws:'].includes(url.protocol)||url.username||url.password)throw new Error('ROOM_SERVER_URL must be a public HTTP or WebSocket URL');}
await writeFile(resolve(out,'multiplayer-config.mjs'),'export const ROOM_SERVER_URL='+JSON.stringify(endpoint)+';\n');
console.log('Static multiplayer client ready in _site/. Room server deploys separately with npm start.');
