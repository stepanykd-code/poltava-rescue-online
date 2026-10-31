import assert from 'node:assert/strict';
import {createScreamerDirector} from '../screamer.mjs';
import {createState} from '../engine.mjs';
import {abilitySpell} from '../spell-projectiles.mjs';

function fixture(){
  const director=createScreamerDirector(()=>0),p=createState('slavik'),players={slavik:p},enemy={x:300,halfWidth:80},view={x:0,width:1600};
  for(let i=0;i<2;i++){
    Object.assign(p,{x:100,y:-170,mode:'jump',airborne:true});director.observe(players,{slavik:{x:100,y:-170,mode:'jump',airborne:true}},new Set(['slavik']),[enemy],view);
    Object.assign(p,{x:500,y:0,mode:'idle',airborne:false});director.observe(players,{slavik:{x:500,y:-2,mode:'jump',airborne:true}},new Set(['slavik']),[enemy],view);
  }
  assert.equal(director.ghosts.length,1);return {director,p,players,ghost:director.ghosts[0],view};
}
for(const hero of ['slavik','dasha','katya'])for(const slot of ['e','r'])for(const direction of [-1,1]){
  const {director,p,players,ghost,view}=fixture();
  const shot={spell:abilitySpell(hero,slot),width:300,direction};
  const x=ghost.x,y=ghost.y;
  assert(!director.catchSpell(shot,{x:x-500,y:y-500},{x:x+500,y:y-500}),'A miss must leave the ghost alive');
  assert(director.catchSpell(shot,{x:x-direction*500,y},{x:x+direction*500,y}),'Every spell must hit in either direction, even across a large frame');
  assert(ghost.defeated);assert(!director.catchSpell(shot,{x:x-500,y},{x:x+500,y}),'One ghost can be defeated only once');
  p.x=ghost.x;p.y=0;const hits=p.screamerHits??0;
  for(let i=0;i<35;i++)director.advance(players,{slavik:{...p}},1/60,view);
  assert.equal(p.screamerHits??0,hits);assert.equal(director.ghosts.length,0,'Defeated ghost fades out and cannot knock anyone down');
}
console.log('Passed: all six spells defeat screamers in both directions; swept hits, misses, one-shot consumption, fade-out and harmless defeated ghosts.');
