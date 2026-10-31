import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {randomBytes,randomInt} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {createCoopSimulation,HEROES} from './simulation.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode=()=>Array.from({length:6},()=>CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
export async function createGameServer({port=Number(process.env.PORT||8780),host=process.env.HOST||'0.0.0.0',allowedOrigins=process.env.ALLOWED_ORIGINS||'',allowFixtures=process.env.ENABLE_TEST_FIXTURES==='1'}={}){
  const rooms=new Map(),limits=new Map();
  const files=['index.html','style.css',...(await readFile(resolve(ROOT,'scripts/public-files.json'),'utf8').then(JSON.parse))];
  const allowedFiles=new Set(files),allowed=new Set(allowedOrigins.split(',').map(x=>x.trim()).filter(Boolean));
  const send=(ws,data)=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));};
  const failure=(ws,message,code='')=>send(ws,{type:'error',message,code});
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true,"version":"0.6.0"}');return;}
    let path;try{path=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';}catch{res.writeHead(400).end();return;}
    if(!['GET','HEAD'].includes(req.method)||!allowedFiles.has(path)){res.writeHead(404).end('Not found');return;}
    try{
      const data=await readFile(resolve(ROOT,path));
      const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.json':'application/json','.wav':'audio/wav'}[extname(path)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':path.startsWith('assets/')?'public, max-age=3600':'no-cache'}).end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404).end('Not found');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:12288,perMessageDeflate:{threshold:1024,serverNoContextTakeover:true,clientNoContextTakeover:true,concurrencyLimit:4,zlibDeflateOptions:{level:3}}});
  server.on('upgrade',(req,socket,head)=>{
    const origin=req.headers.origin;
    let sameOrigin=false;try{sameOrigin=new URL(origin).host===req.headers.host;}catch{}
    if(req.url!=='/rooms'||origin&&!sameOrigin&&!allowed.has(origin)){
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;
    }
    const ip=socket.remoteAddress,now=Date.now(),rate=limits.get(ip)||{time:now,count:0};
    if(now-rate.time>60000){rate.time=now;rate.count=0;}rate.count++;limits.set(ip,rate);
    if(rate.count>30){socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  function seats(room){return Object.fromEntries(HEROES.map(hero=>{const m=[...room.members.values()].find(m=>m.hero===hero);return [hero,{online:!!m?.ws,reserved:!!m,isHost:m===room.owner}];}));}
  function frame(room){
    const world=room.sim.snapshot();world.humans=[...room.members.values()].filter(m=>m.ws).map(m=>m.hero);
    world.friendlyFire=Object.fromEntries([...room.members.values()].filter(m=>m.ws).map(m=>[m.hero,!!m.friendlyFire]));
    return {type:'frame',code:room.code,epoch:room.epoch,seq:++room.seq,started:room.started,seats:seats(room),hostHero:room.owner?.hero,
      acks:Object.fromEntries([...room.members.values()].map(m=>[m.hero,m.ack])),world};
  }
  function publish(room){const data=JSON.stringify(frame(room));for(const m of room.members.values())if(m.ws?.readyState===WebSocket.OPEN&&m.ws.bufferedAmount<512000)m.ws.send(data);}
  function welcome(room,m){send(m.ws,{type:'welcome',room:room.code,hero:m.hero,token:m.token,host:room.owner===m,ack:m.ack});publish(room);}
  wss.on('connection',ws=>{
    let room=null,member=null,bucket=0,bucketAt=Date.now();ws.alive=true;
    ws.on('pong',()=>{ws.alive=true;});
    const helloTimeout=setTimeout(()=>{if(!member)ws.close(1008,'Join a room first');},15000);
    ws.on('message',raw=>{
      if(Date.now()-bucketAt>1000){bucket=0;bucketAt=Date.now();}if(++bucket>120){ws.close(1008,'Too many messages');return;}
      let msg;try{msg=JSON.parse(raw.toString());}catch{failure(ws,'Не вдалося прочитати повідомлення.');return;}
      if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
      if(msg.type==='hello'&&!member){
        if(!HEROES.includes(msg.hero)){failure(ws,'Обери свого героя.');return;}
        if(msg.action==='create'){
          if(rooms.size>=100){failure(ws,'Зараз немає вільних кімнат. Спробуй пізніше.');return;}
          let code;do{code=newCode();}while(rooms.has(code));
          const fixture=allowFixtures&&['hands','boss','egg','halushun','wick','ending'].includes(msg.fixture)?msg.fixture:'';
          room={code,members:new Map(),sim:createCoopSimulation({fixture:fixture==='hands'?'':fixture}),fixture,started:false,seq:0,epoch:0,lastActive:Date.now()};rooms.set(code,room);
        }else if(msg.action==='join'&&typeof msg.room==='string')room=rooms.get(msg.room.trim().toUpperCase());
        if(!room){failure(ws,'Такої кімнати немає. Перевір код або створи нову.','room-missing');return;}
        const resume=typeof msg.token==='string'?room.members.get(msg.token):null;
        if(resume){member=resume;if(member.ws)member.ws.close(1000,'Reconnected');}
        else{
          if([...room.members.values()].some(m=>m.hero===msg.hero)){failure(ws,'Цього героя вже обрали. Обери іншого.');room=null;return;}
          const token=randomBytes(24).toString('hex');member={token,hero:msg.hero,ws:null,input:{axis:0,crouch:false,held:false},inputAt:0,ack:0,commands:[],disconnectedAt:0};room.members.set(token,member);
          if(!room.owner)room.owner=member;
        }
        member.ws=ws;member.input={axis:0,crouch:false,held:false};member.commands=[];member.inputAt=Date.now();room.lastActive=Date.now();clearTimeout(helloTimeout);welcome(room,member);return;
      }
      if(!member||!room)return;
      if(msg.type==='leave'){
        room.members.delete(member.token);member.ws=null;
        if(room.owner===member)room.owner=[...room.members.values()].find(m=>m.ws)??[...room.members.values()][0];
        publish(room);ws.close(1000,'Left room');
      }else if(msg.type==='input'){
        member.input={axis:msg.axis===-1?-1:msg.axis===1?1:0,crouch:msg.crouch===true,held:msg.held===true};member.inputAt=Date.now();
      }else if(msg.type==='command'){
        if(!Number.isSafeInteger(msg.seq)||msg.seq<=member.ack||msg.seq>member.ack+1000||member.commands.some(c=>c.seq===msg.seq))return;
        if(!['jump','ability','talk','fall'].includes(msg.command)||msg.command==='ability'&&!['e','r'].includes(msg.slot)||msg.action&&!['jump','forward'].includes(msg.action))return;
        if(member.commands.length<10)member.commands.push({seq:msg.seq,type:msg.command,slot:msg.slot,action:msg.action});
      }else if(msg.type==='claim'&&HEROES.includes(msg.hero)){
        if([...room.members.values()].some(m=>m!==member&&m.hero===msg.hero)){failure(ws,'Цим героєм керує інший гравець.');return;}
        member.hero=msg.hero;member.input={axis:0,crouch:false,held:false};member.commands=[];welcome(room,member);
      }else if(msg.type==='friendly-fire'&&typeof msg.enabled==='boolean'){member.friendlyFire=msg.enabled;publish(room);}
      else if(msg.type==='start'&&room.owner===member){room.started=true;publish(room);}
      else if(msg.type==='reset'&&room.owner===member){room.sim=createCoopSimulation({fixture:room.fixture==='hands'?'':room.fixture});room.epoch++;for(const m of room.members.values()){m.commands=[];m.input={axis:0,crouch:false,held:false};}publish(room);}
      else if(msg.type==='ping')send(ws,{type:'pong',at:msg.at});
    });
    ws.on('error',()=>{});
    ws.on('close',()=>{
      clearTimeout(helloTimeout);
      if(member?.ws===ws){member.ws=null;member.input={axis:0,crouch:false,held:false};member.commands=[];member.disconnectedAt=Date.now();if(room.owner===member)room.owner=[...room.members.values()].find(m=>m.ws)??member;publish(room);}
    });
  });
  let tickIndex=0,last=performance.now(),accumulator=0;
  const timer=setInterval(()=>{
    const now=performance.now();accumulator+=Math.min(.1,(now-last)/1000);last=now;
    while(accumulator>=1/60){
      accumulator-=1/60;tickIndex++;
      for(const room of rooms.values()){
        const online=[...room.members.values()].filter(m=>m.ws);
        if(!online.length)continue;
        room.lastActive=Date.now();
        if(room.started){
          const inputs={};for(const m of online){inputs[m.hero]=Date.now()-m.inputAt<600?m.input:{axis:0,crouch:false,held:false};
            for(const cmd of m.commands){room.sim.command(m.hero,cmd,inputs[m.hero]);m.ack=Math.max(m.ack,cmd.seq);}m.commands=[];}
          room.sim.tick(1/60,inputs,new Set(online.map(m=>m.hero)),{friendlyFire:Object.fromEntries(online.map(m=>[m.hero,!!m.friendlyFire]))});
        }
        if(tickIndex%3===0)publish(room);
      }
    }
  },1000/60);
  const upkeep=setInterval(()=>{
    for(const ws of wss.clients){if(ws.alive===false){ws.terminate();continue;}ws.alive=false;ws.ping();}
    const now=Date.now();for(const [ip,r] of limits)if(now-r.time>60000)limits.delete(ip);
    for(const [code,room] of rooms){for(const [token,m] of room.members)if(!m.ws&&now-m.disconnectedAt>30000)room.members.delete(token);if(now-room.lastActive>10*60000)rooms.delete(code);}
  },15000);
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,host,resolveListen);});
  const address=server.address();
  return {server,rooms,port:address.port,url:`http://127.0.0.1:${address.port}`,async close(){clearInterval(timer);clearInterval(upkeep);for(const ws of wss.clients)ws.terminate();await new Promise(done=>wss.close(done));await new Promise(done=>server.close(done));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createGameServer();console.log(`Local: ${app.url}/`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
