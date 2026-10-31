import assert from 'node:assert/strict';
import {friendlyFireAllowed,catchFriendlySpell,HEROES} from '../server/simulation.mjs';
import {createState,requestHitFall} from '../engine.mjs';
import {abilitySpell} from '../spell-projectiles.mjs';
const humans=new Set(HEROES);
for(let bits=0;bits<8;bits++){
  const flags=Object.fromEntries(HEROES.map((id,i)=>[id,!!(bits>>i&1)]));
  for(const a of HEROES)for(const b of HEROES){
    const allowed=a!==b&&(flags[a]||flags[b]);assert.equal(friendlyFireAllowed(a,b,humans,flags),allowed);assert.equal(friendlyFireAllowed(a,b,humans,flags),friendlyFireAllowed(b,a,humans,flags),'Friendly fire must be reciprocal');
  }
}
assert(!friendlyFireAllowed('slavik','katya',new Set(['slavik','dasha']),{slavik:true,katya:true}),'AI heroes are not human PvP targets');
for(const hero of HEROES)for(const slot of ['e','r'])for(const direction of [-1,1]){
  const target=HEROES.find(id=>id!==hero),players=Object.fromEntries(HEROES.map(id=>[id,{...createState(id),x:id===hero?100:800,y:0}]));
  const before=structuredClone(players),shot={character:hero,direction,width:300,spell:abilitySpell(hero,slot)};
  const from={x:800-direction*500,y:550},to={x:800+direction*500,y:550};let hits=0;
  const team=new Set([hero,target]);
  assert(!catchFriendlySpell(shot,from,to,players,before,team,{},()=>hits++));
  assert(catchFriendlySpell(shot,from,to,players,before,team,{[hero]:true},p=>{hits++;requestHitFall(p,direction,130);}));
  assert.equal(hits,1);assert.equal(players[target].mode,'fall');assert.equal(players[hero].mode,'idle');
  assert(!catchFriendlySpell(shot,{x:300,y:0},{x:1300,y:0},players,before,team,{[hero]:true},()=>hits++));
}
const players=Object.fromEntries(HEROES.map((id,i)=>[id,{...createState(id),x:300+i*400}])),shot={character:'slavik',width:300,direction:1,spell:abilitySpell('slavik','e')};let target;
assert(catchFriendlySpell(shot,{x:300,y:550},{x:1600,y:550},players,structuredClone(players),humans,{slavik:true},p=>{target=p.character;}));assert.equal(target,'dasha','The first crossed target consumes the projectile');
console.log('Passed: personal reciprocal Frendli Fire, all eight toggle combinations, all six spells in both directions, no self/AI hits, swept nearest target, misses and approved fall reaction.');
