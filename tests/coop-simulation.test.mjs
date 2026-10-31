import assert from 'node:assert/strict';
import {createCoopSimulation,HEROES} from '../server/simulation.mjs';

const sim=createCoopSimulation(),humans=new Set(HEROES),start=structuredClone(sim.players);
for(let i=0;i<30;i++)sim.tick(1/60,{slavik:{axis:-1,held:true},dasha:{axis:1,held:true},katya:{axis:0,crouch:true,held:true}},humans);
assert(sim.players.slavik.x<start.slavik.x-100);assert(sim.players.dasha.x>start.dasha.x+100);
assert.equal(sim.players.katya.x,start.katya.x);assert.equal(sim.players.katya.mode,'crouch');
assert(sim.command('slavik',{type:'jump'},{axis:0}));assert(sim.command('katya',{type:'ability',slot:'e'}));
for(let i=0;i<60;i++)sim.tick(1/60,{},humans);
assert(sim.spells.projectiles.some(p=>p.character==='katya'));
const snapshot=sim.snapshot();assert.equal(snapshot.bosses.length,4);assert.equal(snapshot.humans.length,3);assert.doesNotThrow(()=>JSON.stringify(snapshot));
const disconnectedX=sim.players.dasha.x;
for(let i=0;i<240;i++)sim.tick(1/60,{katya:{axis:1,held:true}},new Set(['slavik','katya']));
assert.notEqual(sim.players.dasha.x,disconnectedX,'Disconnected hero is controlled by the existing follower AI');
for(const fixture of ['boss','egg','halushun','wick']){
  const arena=createCoopSimulation({fixture});
  for(let i=0;i<600&&arena.entering;i++)arena.tick(1/60,{},humans);
  for(let i=0;i<120;i++)arena.tick(1/60,{slavik:{axis:-1,held:true},dasha:{axis:1,held:true}},humans);
  assert(arena.boss.cameraLocked);const left=arena.boss.arenaLeft(1600);
  for(const p of Object.values(arena.players))assert(p.x>=left+79.9&&p.x<=left+1520.1,'Humans stay inside the shared boss arena');
  assert(arena.snapshot().hands.every(e=>e.x+160<left||e.x-160>left+1600));
}
console.log('Passed: three independent humans, ability launch, JSON snapshots, disconnected follower AI, four locked arenas and protected hand-free boss screens.');

