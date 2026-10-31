import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const meta=JSON.parse(await readFile(new URL('../assets/audio-cues.json',import.meta.url),'utf8'));
async function wav(name){const data=await readFile(new URL('../assets/'+name,import.meta.url));assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WAVE');assert.equal(data.readUInt16LE(22),1);assert.equal(data.readUInt32LE(24),32000);assert.equal(data.readUInt16LE(34),16);let peak=0,sum=0,n=0;for(let i=44;i<data.length;i+=2){const value=data.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(value));sum+=value*value;n++;}assert(peak<.95&&peak>.05);assert(Math.sqrt(sum/n)>.015);return {data,duration:n/32000};}
const music=await wav('poltava-night-loop.wav'),effects=await wav('rescue-sounds.wav');
assert(Math.abs(music.duration-meta.music.duration)<.001);assert.equal(meta.music.bars,8);assert.equal(meta.music.seamless,true);
const seam=Math.abs(music.data.readInt16LE(44)-music.data.readInt16LE(music.data.length-2))/32768;assert(seam<.08,'Audible loop discontinuity');
for(const name of ['ui','jump','land','fall','cast-slavik','cast-dasha','cast-katya','hit','ghost-appear','ghost-defeat','boss-correct','boss-wrong','boss-defeat','victory','egg-warning','egg-attack','steam-warning','steam-attack','wick-jump-warning','wick-duck-warning','wick-fire','wick-high']){
  const cue=meta.cues[name];assert(cue&&cue.duration>.05&&cue.start>=0&&cue.start+cue.duration<=effects.duration);
}
assert.equal(Object.keys(meta.cues).length,22);
console.log('Passed: original seamless eight-bar melody, safe audio levels, 22 complete effects and separate boss telegraphs/attacks including jump/duck warnings.');

// Feed real-shaped server snapshots through the browser audio event router.
const starts=[],ducking=[];
const gain=()=>({gain:{value:1,cancelScheduledValues(){},setTargetAtTime(value){ducking.push(value);}},connect(){},disconnect(){}});
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.document={createElement:()=>({addEventListener(){},setAttribute(){}}),getElementById:()=>({prepend(){}}),addEventListener(){}};
globalThis.fetch=async path=>{const file=await readFile(new URL('../'+path.replace(/^\.\//,''),import.meta.url));return {arrayBuffer:async()=>file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),json:async()=>JSON.parse(file.toString())};};
globalThis.AudioContext=class{state='running';currentTime=0;destination={};createGain(){return gain();}createBufferSource(){return {connect(){},disconnect(){},stop(){},start(...args){starts.push(args);}};}async decodeAudioData(){return {};}async resume(){}};
const {createRescueAudio}=await import('../audio.mjs');
const {createCoopSimulation}=await import('../server/simulation.mjs');
const audio=createRescueAudio();await audio.activate();
let world=createCoopSimulation().snapshot();for(const boss of world.bosses)boss.actor.x=1000;
const update=change=>{world=structuredClone(world);change?.(world);audio.update(world,{playing:true,hero:'slavik',round:'test:0'});};
update();update(w=>{w.bosses[1].turn='windup';});update(w=>{w.bosses[1].turn='wave';w.bosses[1].waves=[{id:100}];});
update(w=>{w.bosses[2].turn='windup';});update(w=>{Object.assign(w.bosses[2],{turn:'steam',emitted:1,burstCount:1,turnAge:0,waves:[{id:200}]});});
update(w=>{Object.assign(w.bosses[3],{turn:'series',pattern:['jump','duck'],emitted:0,turnAge:0,stage:1});});
update(w=>{Object.assign(w.bosses[3],{emitted:1,turnAge:1.05,waves:[{id:300,kind:'jump'}]});});
update(w=>{w.bosses[3].turnAge=2;});update(w=>{Object.assign(w.bosses[3],{emitted:2,turnAge:3.05,waves:[{id:300,kind:'jump'},{id:301,kind:'duck'}]});});
for(const name of ['egg-warning','egg-attack','steam-warning','steam-attack','wick-jump-warning','wick-duck-warning','wick-fire','wick-high']){
  assert(starts.some(([,offset,duration])=>offset===meta.cues[name].start&&duration===meta.cues[name].duration),'Missing routed boss sound: '+name);
}
const count=starts.length;update();update();assert.equal(starts.length,count,'Repeated snapshots must not repeat warning/attack sounds');
assert(ducking.filter(value=>value===.07).length>=4,'Telegraphs must lower the music');
console.log('Passed: live boss-state transitions route all eight warning/attack effects once and lower the music under telegraphs.');
