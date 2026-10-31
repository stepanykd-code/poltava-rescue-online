export function createRescueAudio(){
  let context=null,musicBuffer=null,bank=null,cues=null,music=null,master=null,musicGain=null,effects=null;
  let muted=localStorage.getItem('poltava-rescue-muted')==='1',loading=null,started=false,epoch='',previous=null,rounds={},seen=new Set();
  const button=document.createElement('button');button.type='button';button.className='coop-sound';button.id='sound-toggle';document.getElementById('game-card').prepend(button);
  function label(){button.textContent=muted?'♪ Звук вимкнено':'♫ Звук увімкнено';button.setAttribute('aria-pressed',String(!muted));button.setAttribute('aria-label',muted?'Увімкнути звук':'Вимкнути звук');}
  label();
  async function activate(){
    if(!context){
      context=new AudioContext();master=context.createGain();master.gain.value=muted?0:.72;master.connect(context.destination);
      musicGain=context.createGain();musicGain.gain.value=.22;musicGain.connect(master);effects=context.createGain();effects.gain.value=.8;effects.connect(master);
      loading=Promise.all([fetch('./assets/poltava-night-loop.wav').then(r=>r.arrayBuffer()),fetch('./assets/rescue-sounds.wav').then(r=>r.arrayBuffer()),fetch('./assets/audio-cues.json').then(r=>r.json())]).then(async([loop,data,metadata])=>{[musicBuffer,bank]=await Promise.all([context.decodeAudioData(loop),context.decodeAudioData(data)]);cues=metadata.cues;startMusic();}).catch(()=>{button.title='Не вдалося завантажити звук. Онови сторінку.';});
    }
    if(context.state==='suspended')await context.resume();await loading;
  }
  function startMusic(){if(!started||!musicBuffer||music)return;music=context.createBufferSource();music.buffer=musicBuffer;music.loop=true;music.connect(musicGain);music.start();}
  function sound(name,gain=.8){
    if(muted||!bank||!cues?.[name]||context.state!=='running')return;
    const cue=cues[name],source=context.createBufferSource(),volume=context.createGain();source.buffer=bank;volume.gain.value=gain;source.connect(volume);volume.connect(effects);source.start(0,cue.start,cue.duration);source.onended=()=>{source.disconnect();volume.disconnect();};
  }
  function warn(name){sound(name,.95);if(!musicGain)return;const now=context.currentTime;musicGain.gain.cancelScheduledValues(now);musicGain.gain.setTargetAtTime(.07,now,.03);musicGain.gain.setTargetAtTime(.22,now+.9,.3);}
  function once(key,name,warning=false){if(seen.has(key))return;seen.add(key);warning?warn(name):sound(name);}
  button.addEventListener('click',async()=>{muted=!muted;localStorage.setItem('poltava-rescue-muted',muted?'1':'0');label();await activate();master.gain.setTargetAtTime(muted?0:.72,context.currentTime,.04);});
  for(const event of ['pointerdown','keydown'])document.addEventListener(event,()=>{activate().catch(()=>{});},{once:true,capture:true});
  function update(world,{playing,hero,round}){
    started=playing;if(!playing){if(music){music.stop();music=null;}return;}startMusic();
    if(epoch!==round){epoch=round;previous=null;seen=new Set();rounds={};}
    const self=world.players[hero],near=p=>Math.abs(p.x-self.x)<850;
    for(const [id,p] of Object.entries(world.players)){
      const old=previous?.players[id];if(!old||!near(p))continue;
      if(p.mode==='jump'&&old.mode!=='jump')sound('jump',id===hero?.6:.3);
      if(old.airborne&&!p.airborne&&p.mode!=='fall')sound('land',.35);
      if(p.mode==='fall'&&old.mode!=='fall')sound('fall',.6);
    }
    for(const shot of world.spells)if(near(shot.origin))once('spell:'+shot.id,'cast-'+shot.character);
    for(const hit of world.friendlyImpacts??[])if(near(hit))once('friendly-hit:'+hit.id,'hit');
    for(const ghost of world.screamers){if(!near(ghost))continue;once('ghost:'+ghost.id,'ghost-appear');if(ghost.defeated)once('ghost-out:'+ghost.id,'ghost-defeat');}
    for(const [i,boss] of world.bosses.entries()){
      if(Math.abs(boss.actor.x-self.x)>2000)continue;
      const old=previous?.bosses[i],key='boss:'+i+':';
      if(boss.phase==='defeat'&&old?.phase!=='defeat')once(key+'defeat','boss-defeat');
      for(const impact of boss.impacts)once(key+'hit:'+impact.id,impact.result==='wrong'?'boss-wrong':'boss-correct');
      if(i===0&&boss.animation==='anger'&&old?.animation!=='anger')sound('boss-wrong',.6);
      if(i===1){
        if(boss.turn==='windup'&&old?.turn!=='windup')warn('egg-warning');
        for(const wave of boss.waves)once(key+'wave:'+wave.id,'egg-attack');
      }
      if(i===2){
        if(boss.turn==='windup'&&old?.turn!=='windup'){rounds[i]=(rounds[i]??0)+1;warn('steam-warning');}
        if(boss.turn==='steam'&&boss.emitted<boss.burstCount&&boss.turnAge>=boss.emitted*.95-.35)once(key+'prepare:'+(rounds[i]??0)+':'+boss.emitted,'steam-warning',true);
        for(const wave of boss.waves)once(key+'wave:'+wave.id,'steam-attack');
      }
      if(i===3){
        if(boss.turn==='series'&&old?.turn!=='series')rounds[i]=(rounds[i]??0)+1;
        const interval=boss.progress>=6?1.7:[2,1.85,1.7][boss.stage-1],kind=boss.pattern[boss.emitted];
        if(boss.turn==='series'&&kind&&boss.turnAge>=boss.emitted*interval)once(key+'prepare:'+(rounds[i]??0)+':'+boss.emitted,kind==='jump'?'wick-jump-warning':'wick-duck-warning',true);
        for(const wave of boss.waves)once(key+'wave:'+wave.id,wave.kind==='jump'?'wick-fire':'wick-high');
      }
    }
    if(world.worldFreed&&!previous?.worldFreed)once('victory','victory');
    previous=world;
  }
  return {update,sound,activate};
}
