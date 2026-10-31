import {step,requestJump,requestTouchJump,requestFall,CHARACTERS} from './engine.mjs';
import {ROOM_SERVER_URL} from './multiplayer-config.mjs';

const lerp=(a,b,t)=>a+(b-a)*t;
export function createRemoteBoss(source){
  let data={},origin=0;
  const methods={
    receive(next,cameraX){if(next.cameraLocked&&!data.cameraLocked)origin=cameraX;data=next;},
    visible(view){const b=data.bounds??source.bounds;return b.right>view.x&&b.left<view.x+view.width;},
    near(player){return Math.abs(player.x-(data.actor??source.actor).x)<1400;},
    arenaLeft(width){return Math.max(0,(data.bounds??source.bounds).right+45-width);},
    cameraLeft(width){const target=methods.arenaLeft(width),blend=data.cameraBlend??1;return origin+(target-origin)*blend;},
    threatFor(player){return data.threats?.[player.character]??null;}
  };
  return new Proxy(source,{get(target,key){return methods[key]??(Object.hasOwn(data,key)?data[key]:Reflect.get(target,key));}});
}

export function createMultiplayer(){
  let ws=null,room='',hero='slavik',token='',connected=false,started=false,lastFrame=null;
  let buffers=[],predicted=null,offsetX=0,offsetY=0,epoch=-1,seq=0,roundTrip=60,lastSent=0,lastPing=0,attempt=0,retryTimer=null,leaving=false;
  let input={axis:0,crouch:false,held:false},pending=[];
  const listeners=new Set();
  const emit=(type,message)=>{for(const listener of listeners)listener({type,message});};
  function endpoint(){
    if(!ROOM_SERVER_URL&&location.hostname.endsWith('.github.io'))throw new Error('Кімнати поки недоступні. Спробуй пізніше.');
    const url=new URL(ROOM_SERVER_URL||location.origin);url.protocol=url.protocol==='https:'||url.protocol==='wss:'?'wss:':'ws:';url.pathname='/rooms';url.search='';url.hash='';return url.href;
  }
  const send=data=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));};
  const storageKey=code=>'poltava-rescue:'+code;
  function remember(){sessionStorage.setItem(storageKey(room),JSON.stringify({token,hero}));}
  function ingest(frame){
    const now=performance.now();
    if(frame.epoch!==epoch){epoch=frame.epoch;buffers=[];predicted=null;offsetX=offsetY=0;pending=[];}
    lastFrame=frame;started=frame.started;buffers.push({frame,at:now});if(buffers.length>12)buffers.shift();
    const auth=frame.world.players[hero];
    const oldX=predicted?predicted.x+offsetX:auth.x,oldY=predicted?predicted.y+offsetY:auth.y;
    predicted={...auth};pending=pending.filter(event=>event.seq>(frame.acks[hero]??0));
    for(const event of pending)predictCommand(event);
    if(started&&!frame.world.entering)step(predicted,input.axis,Math.min(.08,roundTrip/2000),input.crouch,input.held);
    offsetX=Math.abs(oldX-predicted.x)<90?oldX-predicted.x:0;
    offsetY=Math.abs(oldY-predicted.y)<90?oldY-predicted.y:0;
    emit('frame');
  }
  function connect(action,code,choice){
    clearTimeout(retryTimer);leaving=false;hero=choice;
    if(action==='join'){
      room=code.trim().toUpperCase();let saved;try{saved=JSON.parse(sessionStorage.getItem(storageKey(room)));}catch{}
      token=saved?.token??'';if(saved?.hero)hero=saved.hero;
    }else{room='';token='';}
    open(action);
  }
  function open(action='join'){
    let url;try{url=endpoint();}catch(error){emit('error',error.message);return;}
    emit('connecting');
    ws=new WebSocket(url);
    ws.addEventListener('open',()=>send({type:'hello',action,room,hero,token,fixture:new URLSearchParams(location.search).get('test')}));
    ws.addEventListener('message',event=>{
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.type==='welcome'){
        room=data.room;hero=data.hero;token=data.token;seq=data.ack??0;pending=[];connected=true;attempt=0;remember();
        predicted=null;offsetX=offsetY=0;buffers=[];
        const url=new URL(location.href);url.searchParams.set('room',room);url.searchParams.set('hero',hero);history.replaceState({},'',url);
        emit('welcome');
      }else if(data.type==='frame')ingest(data);
      else if(data.type==='pong')roundTrip=Math.max(1,Math.min(2000,Date.now()-data.at));
      else if(data.type==='error'){
        if(data.code==='room-missing'&&!connected){if(room)sessionStorage.removeItem(storageKey(room));room='';token='';started=false;lastFrame=null;buffers=[];predicted=null;pending=[];emit('left');}
        emit('error',data.message);
        if(!connected){leaving=true;ws.close();}
      }
    });
    ws.addEventListener('close',()=>{
      connected=false;input={axis:0,crouch:false,held:false};
      if(leaving)return;
      if(room&&token){emit('reconnecting');retryTimer=setTimeout(()=>open('join'),Math.min(10000,750*2**attempt++));}
      else emit('error','Не вдалося підключитися до кімнат. Спробуй ще раз.');
    });
    ws.addEventListener('error',()=>{});
  }
  function predictCommand(event){
    if(!predicted||lastFrame?.world.entering)return;
    if(event.command==='jump')event.action?requestTouchJump(predicted,event.action,input.axis):requestJump(predicted,input.axis);
    if(event.command==='fall')requestFall(predicted);
  }
  function command(command,details={}){
    if(!connected||!started)return;
    const event={type:'command',command,...details,seq:++seq};pending.push(event);predictCommand(event);send(event);
  }
  function setInput(next,force=false){
    const changed=next.axis!==input.axis||next.crouch!==input.crouch||next.held!==input.held;input={...next};
    const now=performance.now();if(connected&&(changed||force||now-lastSent>100)){send({type:'input',...input});lastSent=now;}
    if(connected&&now-lastPing>5000){send({type:'ping',at:Date.now()});lastPing=now;}
  }
  function sample(seconds,nextInput){
    setInput(nextInput);if(!buffers.length)return null;
    const newest=buffers.at(-1),target=newest.frame.world.time+Math.min(.15,(performance.now()-newest.at)/1000)-.075;
    let a=buffers[0].frame.world,b=newest.frame.world;
    for(let i=1;i<buffers.length;i++)if(buffers[i].frame.world.time>=target){a=buffers[i-1].frame.world;b=buffers[i].frame.world;break;}
    const t=Math.max(0,Math.min(1,(target-a.time)/Math.max(.0001,b.time-a.time))),base=t<.5?a:b;
    const world={...base,time:lerp(a.time,b.time,t),players:{},bosses:[]};
    for(const id of Object.keys(b.players)){
      const first=a.players[id],last=b.players[id],p={...(t<.5?first:last)};
      p.x=lerp(first.x,last.x,t);p.y=lerp(first.y,last.y,t);
      for(const field of ['abilityTime','phoneTime','fallTime','jumpAge'])if(first.mode===last.mode&&Number.isFinite(first[field]))p[field]=lerp(first[field],last[field],t);
      world.players[id]=p;
    }
    world.bosses=b.bosses.map((last,i)=>{
      const first=a.bosses[i],result={...(t<.5?first:last),animationTime:first.animation===last.animation?lerp(first.animationTime,last.animationTime,t):last.animationTime};
      result.cameraBlend=lerp(first.cameraBlend,last.cameraBlend,t);
      if(first.turn===last.turn&&Number.isFinite(first.turnAge))result.turnAge=lerp(first.turnAge,last.turnAge,t);
      if(first.animation===last.animation)result.pose=Object.fromEntries(Object.entries(last.pose).map(([key,value])=>[key,typeof value==='number'?lerp(first.pose[key]??value,value,t):value]));
      return result;
    });
    for(const collection of ['spells','screamers'])world[collection]=base[collection].map(item=>{
      const first=a[collection].find(p=>p.id===item.id),last=b[collection].find(p=>p.id===item.id);if(!first||!last)return {...item};
      const result={...item};for(const key of ['x','y','age','defeatAge'])if(Number.isFinite(first[key])&&Number.isFinite(last[key]))result[key]=lerp(first[key],last[key],t);return result;
    });
    if(predicted&&connected&&started){
      if(!b.entering)step(predicted,input.axis,Math.min(.05,seconds),input.crouch,input.held);
      offsetX*=Math.exp(-seconds*14);offsetY*=Math.exp(-seconds*14);
      world.players[hero]={...predicted,x:predicted.x+offsetX,y:predicted.y+offsetY};
    }
    return world;
  }
  function leave(){leaving=true;clearTimeout(retryTimer);send({type:'leave'});ws?.close();if(room)sessionStorage.removeItem(storageKey(room));connected=false;started=false;room='';token='';lastFrame=null;buffers=[];predicted=null;pending=[];emit('left');}
  return {connect,command,sample,setInput,leave,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},claim(id){send({type:'claim',hero:id});},start(){send({type:'start'});},reset(){send({type:'reset'});},
    toggleFriendlyFire(){send({type:'friendly-fire',enabled:!lastFrame?.world.friendlyFire?.[hero]});},
    get connected(){return connected;},get started(){return started;},get hero(){return hero;},get room(){return room;},get frame(){return lastFrame;},get host(){return lastFrame?.hostHero===hero;},get latency(){return roundTrip;}};
}

export function mountMultiplayerLobby(net){
  const panel=document.createElement('section');panel.className='coop-lobby';panel.setAttribute('aria-label','Спільна гра');
  panel.innerHTML=`<div class="coop-card"><span class="coop-eyebrow">ПРИГОДА НА ТРЬОХ</span><h1>Славік, Даша і Катя<br><span>рятують Полтаву</span></h1><p>Обери героя. Поклич друзів у кімнату — або починай, а вони приєднаються згодом.</p><div id="coop-entry"><label for="coop-hero">Мій герой</label><select id="coop-hero"><option value="slavik">Славік · SlaVStaR</option><option value="dasha">Даша · PurpleDog</option><option value="katya">Катя · Katy Cool</option></select><button id="coop-create" class="coop-primary">Створити кімнату</button><div class="coop-divider">або приєднайся до друзів</div><form id="coop-join-form"><label for="coop-code">Код кімнати</label><div class="coop-code-row"><input id="coop-code" maxlength="6" autocomplete="off" placeholder="ABC234" aria-label="Код кімнати" required><button type="submit">Приєднатися</button></div></form></div><div id="coop-waiting" hidden><span class="coop-room-label">КІМНАТА</span><strong id="coop-room-code"></strong><div id="coop-seats" class="coop-seats"></div><button id="coop-copy" class="coop-secondary">Копіювати запрошення</button><button id="coop-start" class="coop-primary">Почати пригоду</button><p id="coop-wait-text">Чекаємо на початок пригоди…</p><button id="coop-leave" class="coop-link">Вийти з кімнати</button></div><p id="coop-message" role="status" aria-live="polite"></p></div>`;
  document.body.append(panel);
  const bar=document.createElement('div');bar.className='coop-bar';bar.hidden=true;bar.innerHTML='<span id="coop-bar-label"></span><button id="friendly-fire-toggle" aria-pressed="false" title="Взаємні влучання заклинаннями з твоїм героєм">Frendli Fire · вимкнено</button><button id="coop-invite">Запросити друзів</button><button id="coop-exit">Вийти</button>';document.getElementById('game-card').prepend(bar);
  const find=id=>document.getElementById(id),message=find('coop-message'),entry=find('coop-entry'),waiting=find('coop-waiting');let lobbyStamp='';
  const params=new URLSearchParams(location.search);find('coop-code').value=params.get('room')??'';
  if(['slavik','dasha','katya'].includes(params.get('hero')))find('coop-hero').value=params.get('hero');
  function copy(){const url=new URL(location.href);url.search='';url.searchParams.set('room',net.room);navigator.clipboard?.writeText(url.href).then(()=>{message.textContent='Запрошення скопійовано.';find('coop-bar-label').textContent='Запрошення скопійовано · '+net.room;}).catch(()=>{message.textContent='Код кімнати: '+net.room;});}
  find('coop-create').addEventListener('click',()=>net.connect('create','',find('coop-hero').value));
  find('coop-join-form').addEventListener('submit',event=>{event.preventDefault();net.connect('join',find('coop-code').value,find('coop-hero').value);});
  find('coop-copy').addEventListener('click',copy);find('coop-invite').addEventListener('click',copy);
  find('coop-start').addEventListener('click',()=>net.start());find('coop-leave').addEventListener('click',()=>net.leave());find('coop-exit').addEventListener('click',()=>net.leave());
  find('friendly-fire-toggle').addEventListener('click',()=>net.toggleFriendlyFire());
  net.onChange(event=>{
    if(event.type==='connecting'){message.textContent='Підключаємося…';return;}
    if(event.type==='error'){message.textContent=event.message;return;}
    if(event.type==='reconnecting'){panel.hidden=false;message.textContent='Зв’язок зник. Повертаємо тебе в пригоду…';return;}
    if(event.type==='left'){panel.hidden=false;entry.hidden=false;waiting.hidden=true;bar.hidden=true;message.textContent='Ти вийшов із кімнати.';return;}
    if(event.type==='welcome'){message.textContent='Твій герой — '+CHARACTERS[net.hero].name;entry.hidden=true;waiting.hidden=false;find('coop-room-code').textContent=net.room;}
    if(event.type==='frame'){
      const stamp=JSON.stringify([net.frame.seats,net.frame.started,net.hero,net.connected,net.frame.world.friendlyFire]);if(stamp===lobbyStamp)return;lobbyStamp=stamp;
      panel.hidden=net.started&&net.connected;bar.hidden=!net.started;
      find('coop-start').hidden=!net.host;find('coop-wait-text').hidden=net.host;
      find('coop-seats').replaceChildren(...Object.entries(net.frame.seats).map(([id,seat])=>{const item=document.createElement('div');item.className='coop-seat'+(id===net.hero?' is-you':'');item.textContent=CHARACTERS[id].name+' · '+(seat.online?(id===net.hero?'це ти':'у грі'):seat.reserved?'гра підхопила керування':'автоматично');return item;}));
      find('coop-bar-label').textContent='Кімната '+net.room+' · Ти — '+CHARACTERS[net.hero].name+' · '+Object.values(net.frame.seats).filter(s=>s.online).length+'/3';
      const fire=!!net.frame.world.friendlyFire?.[net.hero];find('friendly-fire-toggle').setAttribute('aria-pressed',String(fire));find('friendly-fire-toggle').textContent='Frendli Fire · '+(fire?'увімкнено':'вимкнено');
      find('reset').disabled=!net.host;find('reset').title=net.host?'Почати всім спочатку':'Почати спочатку може автор кімнати';
      for(const button of document.querySelectorAll('[data-character]')){const seat=net.frame.seats[button.dataset.character];button.disabled=button.dataset.character!==net.hero&&seat.reserved;}
    }
  });
  const savedCode=params.get('room');let saved;
  try{saved=JSON.parse(sessionStorage.getItem('poltava-rescue:'+savedCode));}catch{}
  if(savedCode&&saved?.token)queueMicrotask(()=>net.connect('join',savedCode,saved.hero));
}
