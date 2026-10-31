import assert from 'node:assert/strict';
import {createCoopSimulation,HEROES} from '../server/simulation.mjs';
import {HALUSHUN_MENU} from '../halushun-boss.mjs';
import {WICK_SEQUENCE} from '../wick-boss.mjs';

const savedRandom=Math.random;Math.random=()=>.9;
try{
  for(const fixture of ['boss','egg','halushun','wick']){
    const sim=createCoopSimulation({fixture}),humans=new Set(HEROES);let frames=0,lastCastAt=-100,awaiting=null;
    while(sim.boss.phase!=='inactive'&&frames++<18000){
      const boss=sim.boss,inputs=Object.fromEntries(HEROES.map(id=>[id,{axis:0,crouch:false,held:false}]));
      if(awaiting&&(boss.progress!==awaiting.progress||boss.wrongHits!==awaiting.wrongHits||frames-awaiting.at>900))awaiting=null;
      if(!sim.entering&&boss.phase==='active'){
        for(const id of HEROES){
          const p=sim.players[id];
          if(fixture==='egg'&&boss.waves.some(w=>w.x>p.x&&w.x-p.x<250))sim.command(id,{type:'jump'},{axis:0});
          if(fixture==='halushun')inputs[id].crouch=boss.requiresCrouch;
          if(fixture==='wick'){const dodge=boss.dodgeFor(p);inputs[id].crouch=dodge.crouch;if(dodge.jump)sim.command(id,{type:'jump'},{axis:0});}
        }
        const entry=fixture==='boss'?boss.next:fixture==='egg'&&boss.vulnerable?{character:HEROES[boss.progress%3],slot:'e'}:fixture==='halushun'&&boss.turn==='hungry'?HALUSHUN_MENU.find(e=>!boss.completedSpells.includes(e.spell.id)):fixture==='wick'&&boss.vulnerable?WICK_SEQUENCE[boss.progress]:null;
        if(entry&&!awaiting&&frames-lastCastAt>5){
          const p=sim.players[entry.character];if(!p.airborne&&p.mode!=='ability'&&p.mode!=='fall'&&sim.command(entry.character,{type:'ability',slot:entry.slot})){lastCastAt=frames;awaiting={progress:boss.progress,wrongHits:boss.wrongHits,at:frames};}
        }
      }
      sim.tick(1/60,inputs,humans);
    }
    assert(frames<18000,'Three-player boss encounter stalled: '+fixture+' '+sim.boss.turn+' '+sim.boss.progress);
    assert.equal(sim.boss.phase,'inactive');assert.equal(sim.boss.progress,fixture==='boss'||fixture==='egg'?3:6);
    for(const p of Object.values(sim.players))assert.equal(p.ghostHitCount,0,'A human-controlled hero failed a scripted dodge: '+fixture+' '+p.character);
    assert(!sim.boss.cameraLocked);if(fixture==='wick')assert(sim.snapshot().worldFreed);
  }
  console.log('Passed: all four complete boss encounters through the real room simulation with three human-controlled heroes, six spells, all jump/duck dodges, full defeat and shared finale.');
}finally{Math.random=savedRandom;}
