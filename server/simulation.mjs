import {WORLD,CHARACTERS,createState,step,requestJump,requestTouchJump,requestFall,requestHitFall,attemptAbility} from '../engine.mjs';
import {cameraLeft} from '../parallax.mjs';
import {createGhostHandsEnemies,advanceGhostHands,nearestGhostTarget,applyGhostHandsContact} from '../ghost-hands.mjs';
import {createPartyFollowers} from '../followers.mjs';
import {createScreamerDirector} from '../screamer.mjs';
import {createSpellProjectiles} from '../spell-projectiles.mjs';
import {createPumpkinBoss} from '../pumpkin-boss.mjs';
import {createEggBoss} from '../egg-boss.mjs';
import {createHalushunBoss} from '../halushun-boss.mjs';
import {createWickBoss} from '../wick-boss.mjs';
import {createBossArenaParty} from '../boss-arena-party.mjs';
import {createDialogueDirector} from '../dialogue.mjs';
import {DIALOGUE_DATA} from '../dialogue-data.mjs';
import {createPumpkinDialogue} from '../pumpkin-dialogue.mjs';
import {createEggDialogue} from '../egg-dialogue.mjs';
import {createHalushunDialogue} from '../halushun-dialogue.mjs';
import {createWickDialogue} from '../wick-dialogue.mjs';

export const HEROES=['slavik','dasha','katya'];
const jsonCopy=value=>JSON.parse(JSON.stringify(value,(_,v)=>v instanceof Set?[...v]:v));
export function createCoopSimulation({fixture=''}={}){
  const encounters=[createPumpkinBoss(),createEggBoss(),createHalushunBoss(),createWickBoss({previewEnding:fixture==='ending'})];
  const [pumpkin,egg,halushun,wick]=encounters;
  let boss=({boss:pumpkin,egg,halushun,wick,ending:wick})[fixture]??pumpkin;
  const players=Object.fromEntries(HEROES.map(id=>[id,{...createState(id),...DIALOGUE_DATA.scene.startingPositions[id]}]));
  if(fixture){boss.lockArena();for(const [i,p] of Object.values(players).entries())Object.assign(p,{x:boss.arenaLeft(1600)+[130,365,680][i],facing:1});}
  let hands=createGhostHandsEnemies().filter(e=>encounters.every(b=>e.x+160<b.arenaLeft(1600)||e.x-160>b.arenaLeft(1600)+1600)).map(e=>({...e,pose:{lean:0,lift:0},warned:new Set(),hitFlash:0}));
  const screamers=createScreamerDirector(),spells=createSpellProjectiles(),followers=createPartyFollowers(),arena=createBossArenaParty();
  let lead='slavik',time=0,worldFreed=false,victoryTime=0,wasLocked=false,pendingIntro=false,humanIds=new Set(),friendlyFire={},friendlyImpacts=[],friendlySerial=0;
  let view={x:0,width:1600};
  const entering=()=>boss.cameraLocked&&(arena.entering||!boss.cameraReady);
  const available=id=>{
    const enemy=encounters.find(b=>b.actor.character===id);
    if(enemy)return !worldFreed&&enemy.phase!=='inactive'&&enemy.visible(view);
    const p=players[id];return !!p&&!p.airborne&&p.mode!=='fall'&&p.x>=view.x&&p.x<=view.x+view.width;
  };
  const dialogue=createDialogueDirector({isAvailable:available});
  const voices=[createPumpkinDialogue,createEggDialogue,createHalushunDialogue,createWickDialogue].map(make=>make(dialogue,{isAvailable:available}));
  const voice=()=>voices[encounters.indexOf(boss)];
  followers.reset(players,lead);
  function chat(id){
    if(entering())return;
    if(boss.phase==='active'&&boss.near(players[id])){
      if(boss===wick)voice().hint(boss.next,true);
      else if(boss===halushun){if(boss.requiresCrouch)voice().duck(true);else voice().hint(boss.hintFor(id),true);}
      else if(boss===egg)voice().strategy();else voice().hint(boss.next,true);
    }else dialogue.startConversation('ambient',true);
  }
  function command(id,event,input={}){
    const p=players[id];if(!p||entering())return false;
    if(event.type==='ability'){
      const outcome=attemptAbility(p,event.slot);p.lastAbilityOutcome=outcome;
      if(outcome==='started'&&(boss===egg||boss===wick))boss.reserveCast(p);
      if(outcome!=='blocked')dialogue.onEvent(id,outcome==='refused'?'ability-refused':'ability-'+event.slot,{priority:true});
      return outcome==='started';
    }
    if(event.type==='jump')return event.action?requestTouchJump(p,event.action,input.axis):requestJump(p,input.axis??0);
    if(event.type==='fall')return requestFall(p);
    if(event.type==='talk'){chat(id);return true;}
    return false;
  }
  function tick(seconds,inputs={},controlled=new Set(['slavik']),options={}){
    const dt=Math.max(0,Math.min(.05,seconds));time+=dt;humanIds=controlled;friendlyFire=options.friendlyFire??{};
    friendlyImpacts=friendlyImpacts.filter(effect=>(effect.age+=dt)<effect.duration);
    const humans=[...controlled].filter(id=>players[id]);
    if(humans.length&&!boss.cameraLocked)lead=humans.reduce((a,b)=>players[a].x>=players[b].x?a:b);
    const active=players[lead],before=Object.fromEntries(HEROES.map(id=>[id,{...players[id]}]));
    if(!boss.cameraLocked&&!fixture)boss=encounters.reduce((a,b)=>Math.abs(active.x-a.actor.x)<=Math.abs(active.x-b.actor.x)?a:b);
    if(!worldFreed||boss===wick)boss.advance(dt,active,view,{combatReady:boss.cameraLocked&&!entering(),players});
    const npcTeam=Object.fromEntries(Object.entries(players).filter(([id])=>id===lead||!controlled.has(id)));
    if(!entering()){
      if(boss===egg)egg.autoJump(npcTeam,lead);
      if(boss===wick)wick.autoDodge(npcTeam,lead);
    }
    const arenaView={x:boss.arenaLeft(1600),width:1600};
    if(boss===halushun)arenaView.slots=[115,315,515,715].map(x=>arenaView.x+x);
    if(boss.cameraLocked!==wasLocked){followers.reset(players,lead);arena.reset();wasLocked=boss.cameraLocked;if(wasLocked)arena.beginEntry(players,arenaView);}
    if(arena.entering)arena.updateEntry(players,dt);
    else if(!entering()){
      for(const id of humans){const input=inputs[id]??{};step(players[id],input.axis??0,dt,!!input.crouch,!!input.held);}
      if(boss.cameraLocked){
        const slots=arenaView.slots??[120,352,584,816].map(x=>arenaView.x+x);
        arenaView.slots=slots.filter(x=>humans.every(id=>Math.abs(players[id].x-x)>=195));
        arena.update(npcTeam,lead,arenaView,dt,{crouchFor:p=>boss===wick?wick.dodgeFor(p).crouch:boss===halushun&&halushun.requiresCrouch});
      }else followers.update(npcTeam,lead,hands,dt);
    }
    if(boss.cameraLocked){
      const left=arena.entering?Math.min(arenaView.x,...Object.values(players).map(p=>p.x)):arenaView.x;
      hands=hands.filter(e=>e.x+160<left||e.x-160>arenaView.x+1600);
      if(!worldFreed)boss.blockPlayers(players,before,arena.entering?null:arenaView.x);
    }else if(!worldFreed)boss.blockPlayers(players,before);
    if(boss===egg)egg.applyHazards(players,before);
    if(boss===halushun)halushun.applyHazards(players,before,controlled,arenaView);
    if(boss===wick)wick.applyHazards(players,before,controlled,arenaView);
    for(const p of Object.values(players)){
      for(const enemy of hands)if(applyGhostHandsContact(p,before[p.character],enemy))enemy.hitFlash=1;
      const old=before[p.character].mode;
      if(time>2&&old!==p.mode){
        const trigger=old==='fall'?'fall':old==='land'?'jump':['walk','crouch','phone'].includes(p.mode)?p.mode:null;
        if(trigger)dialogue.onEvent(p.character,trigger);
      }
    }
    for(const enemy of hands){
      const nearest=nearestGhostTarget(players,enemy);advanceGhostHands(enemy.pose,time+enemy.phase,nearest.x,enemy.x,dt);enemy.hitFlash=Math.max(0,enemy.hitFlash-dt*2.5);
      for(const id of humans){const p=players[id],distance=Math.abs(p.x-enemy.x);if((enemy.x-p.x)*p.facing>0&&distance<450&&distance>155&&!enemy.warned.has(id)&&dialogue.onEvent(id,'hands',{priority:true}))enemy.warned.add(id);}
    }
    if(!worldFreed&&!(boss===wick&&boss.cameraLocked)){screamers.observe(players,before,controlled,hands,view);screamers.advance(players,before,dt,view);}else screamers.clearGhosts();
    const shotView=shot=>boss.cameraLocked?arenaView:{x:cameraLeft(players[shot.character].x,1600,WORLD.width),width:1600};
    spells.advance(dt,shotView,(shot,a,b)=>screamers.catchSpell(shot,a,b)||catchFriendlySpell(shot,a,b,players,before,controlled,friendlyFire,(target,hit)=>{
      requestHitFall(target,shot.direction,130);
      friendlyImpacts.push({id:++friendlySerial,...hit,age:0,duration:.55,result:'wrong',spell:shot.spell,width:shot.width,direction:shot.direction});
    })||!worldFreed&&boss.catchSpell(shot,a,b,shotView(shot)));
    spells.observe(players);if(!worldFreed)boss.resolveHits();
    for(const event of boss.takeEvents()){
      if(boss===wick&&event.type==='defeated'){worldFreed=true;victoryTime=time;hands=[];screamers.clearGhosts();}
      if(event.type==='intro'&&entering())pendingIntro=true;else voice().handle(event);
    }
    if(pendingIntro&&!entering()){pendingIntro=false;voice().handle({type:'intro'});}
    for(const ghost of screamers.ghosts)if(!ghost.defeated&&!ghost.commented){
      const p=Object.values(players).find(p=>available(p.character)&&ghost.x-p.x>-80&&ghost.x-p.x<620);
      if(p&&dialogue.onEvent(p.character,'screamer',{priority:true}))ghost.commented=true;
    }
    dialogue.advance(dt*1000);
    view={x:boss.cameraLocked?boss.cameraLeft(1600):cameraLeft(active.x,1600,WORLD.width),width:1600};
  }
  function snapshot(){
    return jsonCopy({time,players,bossIndex:encounters.indexOf(boss),bosses:encounters,entering:entering(),worldFreed,victoryTime,hands,screamers:screamers.ghosts,clears:screamers.clears,spells:spells.projectiles,speech:dialogue.getCurrent(),humans:[...humanIds],friendlyFire,friendlyImpacts,threats:Object.fromEntries(HEROES.map(id=>[id,wick.threatFor(players[id])]))});
  }
  return {tick,command,snapshot,players,encounters,screamers,spells,get boss(){return boss;},get entering(){return entering();}};
}

export function friendlyFireAllowed(shooter,target,humans,flags){
  return shooter!==target&&humans.has(shooter)&&humans.has(target)&&!!(flags[shooter]||flags[target]);
}
export function catchFriendlySpell(shot,from,to,players,beforePlayers,humans,flags,onHit){
  const hits=[];
  for(const [id,p] of Object.entries(players)){
    if(!friendlyFireAllowed(shot.character,id,humans,flags)||p.mode==='fall')continue;
    const before=beforePlayers[id]??p,c=CHARACTERS[id],height=(p.mode==='crouch'?292:436)*.8*c.scale*(p.mode==='crouch'?(c.crouchScale??1):1);
    const rx=shot.width*.28+28*.8*c.scale,ry=shot.width*.17+height/2;
    let enter=0,exit=1;
    for(const [a,b,r] of [[from.x-before.x,to.x-p.x,rx],[from.y-(WORLD.groundY+before.y-height/2),to.y-(WORLD.groundY+p.y-height/2),ry]]){
      const d=b-a;if(Math.abs(d)<1e-9){if(Math.abs(a)>r){exit=-1;break;}continue;}
      let first=(-r-a)/d,last=(r-a)/d;if(first>last)[first,last]=[last,first];enter=Math.max(enter,first);exit=Math.min(exit,last);
    }
    if(enter<=exit&&exit>=0&&enter<=1)hits.push({p,fraction:enter,x:from.x+(to.x-from.x)*enter,y:from.y+(to.y-from.y)*enter});
  }
  hits.sort((a,b)=>a.fraction-b.fraction);if(!hits.length)return false;
  onHit(hits[0].p,{x:hits[0].x,y:hits[0].y});return true;
}
