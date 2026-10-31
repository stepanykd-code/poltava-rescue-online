import {WORLD,CHARACTERS,requestHitFall} from './engine.mjs';
import {SCREAMER_FLIGHT,screamerWave} from './screamer-rig.mjs';

export function screamerContact(ghost,beforeGhost,player,before){
 if(player.mode==='fall')return false;
 let enter=0,exit=1;
 function clip(a,b){const delta=b-a;if(Math.abs(delta)<1e-9)return a>=0;const root=-a/delta;if(delta>0)enter=Math.max(enter,root);else exit=Math.min(exit,root);return enter<=exit;}
 const a=beforeGhost.x-before.x,b=ghost.x-player.x;
 if(!clip(a+62,b+62)||!clip(62-a,62-b))return false;
 const scale=.8*CHARACTERS[player.character].scale;
 const top=p=>WORLD.groundY+p.y-(480-(p.mode==='crouch'?188:44))*scale*(p.mode==='crouch'?(CHARACTERS[player.character].crouchScale??1):1);
 return clip(beforeGhost.y+46-top(before),ghost.y+46-top(player))&&clip(WORLD.groundY+before.y-beforeGhost.y+42,WORLD.groundY+player.y-ghost.y+42)&&enter<=exit;
}

export function createScreamerDirector(random=Math.random){
 let clears=0,serial=0,flights=new Map(),ghosts=[];
 function reset(){clears=0;serial=0;flights.clear();ghosts=[];}
 function spawn(view,leader){ghosts.push({id:++serial,x:Math.max(view.x+view.width+200,leader.x+460),y:480,age:0,touched:new Set()});}
 function observe(players,beforePlayers,controlledId,enemies,view){
  const controlled=id=>controlledId instanceof Set?controlledId.has(id):id===controlledId;
  for(const [id,player] of Object.entries(players)){
   const before=beforePlayers[id];
   if(!flights.has(id)&&(before.airborne||player.airborne))flights.set(id,{start:before.x,controlled:controlled(id)&&before.airborne&&before.mode==='jump'});
   const flight=flights.get(id);if(!flight)continue;
   if(player.mode==='fall'){flights.delete(id);continue;}
   if(player.airborne)continue;
   flights.delete(id);
   if(!flight.controlled||!controlled(id))continue;
   for(const enemy of enemies){
    const radius=enemy.halfWidth+18,start=flight.start-enemy.x,end=player.x-enemy.x;
    if(Math.abs(start)<=radius||Math.abs(end)<=radius||start*end>=0)continue;
    clears++;
    if(clears===2||(clears>2&&random()<.5))spawn(view,player);
   }
  }
 }
 function advance(players,beforePlayers,seconds,view){
  const dt=Math.max(0,Math.min(.05,seconds));
  for(const ghost of ghosts){
   ghost.beforeX=ghost.x;ghost.beforeY=ghost.y;
   if(ghost.defeated){ghost.defeatAge+=dt;ghost.age+=dt;ghost.x-=SCREAMER_FLIGHT.speed*dt*.15;continue;}
   const before={x:ghost.x,y:ghost.y};ghost.age+=dt;ghost.x-=SCREAMER_FLIGHT.speed*dt;ghost.y=480+screamerWave(ghost.age);
   for(const [id,player] of Object.entries(players)){
    if(ghost.touched.has(id)||!screamerContact(ghost,before,player,beforePlayers[id]))continue;
    if(requestHitFall(player,-1,0)){ghost.touched.add(id);player.screamerHits=(player.screamerHits??0)+1;}
   }
  }
  const left=Math.min(view.x,...Object.values(players).map(p=>p.x))-650;
  ghosts=ghosts.filter(ghost=>ghost.x>left&&(!ghost.defeated||ghost.defeatAge<.45));
 }
 function catchSpell(shot,from,to){
  for(const ghost of ghosts){
   if(ghost.defeated)continue;
   let enter=0,exit=1;
   const rx=52+shot.width*.34,ry=50+shot.width*.22;
   for(const [a,b,r] of [[from.x-(ghost.beforeX??ghost.x),to.x-ghost.x,rx],[from.y-(ghost.beforeY??ghost.y),to.y-ghost.y,ry]]){
    const d=b-a;if(Math.abs(d)<1e-9){if(Math.abs(a)>r){exit=-1;break;}continue;}
    let first=(-r-a)/d,last=(r-a)/d;if(first>last)[first,last]=[last,first];enter=Math.max(enter,first);exit=Math.min(exit,last);
   }
   if(enter<=exit&&exit>=0&&enter<=1){ghost.defeated=true;ghost.defeatAge=0;ghost.defeatColor=shot.spell.color;return true;}
  }
  return false;
 }
 return {reset,clearGhosts(){ghosts=[];flights.clear();},observe,advance,catchSpell,get clears(){return clears;},get ghosts(){return ghosts;}};
}
