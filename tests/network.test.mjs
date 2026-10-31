import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createGameServer} from '../server/index.mjs';

const app=await createGameServer({port:0,host:'127.0.0.1'}),clients=[];
async function client(){
  const ws=new WebSocket(app.url.replace('http:','ws:')+'/rooms'),messages=[],waiting=new Set();clients.push(ws);
  ws.on('message',raw=>{const msg=JSON.parse(raw);messages.push(msg);if(messages.length>200)messages.shift();for(const waiter of waiting)if(waiter.test(msg)){waiting.delete(waiter);clearTimeout(waiter.timer);waiter.resolve(msg);}});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,messages,send:msg=>ws.send(JSON.stringify(msg)),wait(test,timeout=6000){const found=messages.find(test);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const waiter={test,resolve,timer:setTimeout(()=>{waiting.delete(waiter);reject(new Error('Timed out waiting for a room message'));},timeout)};waiting.add(waiter);});}};
}
try{
  assert.equal((await fetch(app.url+'/health')).status,200);
  assert.equal((await fetch(app.url+'/server/index.mjs')).status,404,'Server code must never be served as a public asset');
  const a=await client();a.send({type:'hello',action:'create',hero:'slavik'});const owner=await a.wait(m=>m.type==='welcome');assert.match(owner.room,/^[A-Z2-9]{6}$/);
  const b=await client();b.send({type:'hello',action:'join',room:owner.room,hero:'dasha'});const second=await b.wait(m=>m.type==='welcome');
  const c=await client();c.send({type:'hello',action:'join',room:owner.room,hero:'katya'});await c.wait(m=>m.type==='welcome');
  const intruder=await client();intruder.send({type:'hello',action:'join',room:owner.room,hero:'katya'});assert.match((await intruder.wait(m=>m.type==='error')).message,/вже обрали/);
  a.send({type:'start'});const initial=await a.wait(m=>m.type==='frame'&&m.started&&m.world.humans.length===3),begin=initial.world.players;
  a.send({type:'input',axis:-1,hero:'katya',held:true});b.send({type:'input',axis:1,held:true});c.send({type:'input',axis:0,crouch:true,held:true});
  const moved=await a.wait(m=>m.type==='frame'&&m.seq>initial.seq&&m.world.players.slavik.x<begin.slavik.x-35&&m.world.players.dasha.x>begin.dasha.x+35);
  assert.equal(moved.world.players.katya.x,begin.katya.x);assert.equal(moved.world.players.katya.mode,'crouch');
  for(const peer of [b,c]){const same=await peer.wait(m=>m.type==='frame'&&m.seq===moved.seq);assert.deepEqual(same.world,moved.world,'All three clients receive the same authoritative world');}
  assert(!JSON.stringify(moved).includes(owner.token),'Resume tokens must not leak to the party');
  a.send({type:'friendly-fire',enabled:true,hero:'katya'});
  const fire=await a.wait(m=>m.type==='frame'&&m.world.friendlyFire.slavik===true);
  assert.equal(fire.world.friendlyFire.dasha,false);assert.equal(fire.world.friendlyFire.katya,false,'A player cannot toggle somebody else');
  a.send({type:'friendly-fire',enabled:false});await a.wait(m=>m.type==='frame'&&m.seq>fire.seq&&m.world.friendlyFire.slavik===false);
  b.send({type:'reset'});a.send({type:'input',axis:0});b.send({type:'input',axis:0});c.send({type:'input',axis:0});
  c.send({type:'command',seq:1,command:'ability',slot:'e'});c.send({type:'command',seq:1,command:'ability',slot:'e'});
  const launched=await c.wait(m=>m.type==='frame'&&m.world.spells.some(s=>s.character==='katya'));
  assert.equal(launched.epoch,initial.epoch,'Non-host cannot reset the room');assert.equal(launched.world.spells.filter(s=>s.character==='katya').length,1);assert.equal(launched.acks.katya,1);
  b.ws.close();const dropped=await a.wait(m=>m.type==='frame'&&m.seats.dasha.reserved&&!m.seats.dasha.online);assert(!dropped.world.humans.includes('dasha'));
  const resumed=await client();resumed.send({type:'hello',action:'join',room:owner.room,hero:'dasha',token:second.token});assert.equal((await resumed.wait(m=>m.type==='welcome')).hero,'dasha');
  const restored=await a.wait(m=>m.type==='frame'&&m.seq>dropped.seq&&m.seats.dasha.online);assert(restored.world.humans.includes('dasha'));
  const separate=await client();separate.send({type:'hello',action:'create',hero:'katya'});const otherRoom=await separate.wait(m=>m.type==='welcome');assert.notEqual(otherRoom.room,owner.room);
  a.send({type:'reset'});const reset=await a.wait(m=>m.type==='frame'&&m.epoch===initial.epoch+1);assert.equal(reset.world.bosses[0].progress,0);assert.equal(reset.world.spells.length,0);
  const otherState=await separate.wait(m=>m.type==='frame');assert.equal(otherState.epoch,0);assert.equal(otherState.started,false);
  c.send({type:'leave'});await a.wait(m=>m.type==='frame'&&m.seq>reset.seq&&!m.seats.katya.reserved);
  const replacement=await client();replacement.send({type:'hello',action:'join',room:owner.room,hero:'katya'});await replacement.wait(m=>m.type==='welcome');
  console.log('Passed: real three-client WebSockets, shared snapshots, independent input, seat ownership, one-shot commands, host-only reset, AI takeover/reconnect, explicit leave, private tokens, isolated rooms and private server files.');
}finally{for(const ws of clients)ws.terminate();await app.close();}
