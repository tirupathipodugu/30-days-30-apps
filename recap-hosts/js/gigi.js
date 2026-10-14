// Grandma Gigi: spring-driven 2D rig (SVG). No libraries.
(function(){
'use strict';
const NS='http://www.w3.org/2000/svg';
const $=id=>document.getElementById(id);
const D=Math.PI/180;
const rnd=(a,b)=>a+Math.random()*(b-a);
function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}

// ---- spring ----
class S{constructor(x,k,d){this.x=x;this.v=0;this.t=x;this.k=k;this.d=d;}
  step(dt){const a=this.k*(this.t-this.x)-this.d*this.v;this.v+=a*dt;this.x+=this.v*dt;}}
// smooth noise: sum of sines
function noise(seed){const p=[rnd(0,6.28),rnd(0,6.28),rnd(0,6.28)];return t=>(Math.sin(t*0.53+p[0]+seed)*0.5+Math.sin(t*1.31+p[1])*0.3+Math.sin(t*2.17+p[2])*0.2);}

// ---- build arms ----
function buildArm(side){
  const g=$(side<0?'armL':'armR');
  const sx=side*80, sy=-36;
  // one continuous sleeve: shoulder->elbow->wrist drawn as round-joined strokes in the same fill (updated per frame)
  const sleeveDark=el('path',{fill:'none',stroke:'#b8702f','stroke-width':31.5,'stroke-linecap':'round','stroke-linejoin':'round'},g);
  const sleeve=el('path',{fill:'none',stroke:'#d98b3a','stroke-width':29,'stroke-linecap':'round','stroke-linejoin':'round'},g);
  const sleeveKnit=el('path',{fill:'none',stroke:'url(#knit)','stroke-width':29,'stroke-linecap':'round','stroke-linejoin':'round'},g);
  const sleeveHi=el('path',{fill:'none',stroke:'#f6c27a','stroke-opacity':.22,'stroke-width':5,'stroke-linecap':'round','stroke-linejoin':'round'},g);
  // shawl drapes over the top of the sleeve, so the arm reads as coming out from under it
  el('ellipse',{cx:side*-3,cy:-2,rx:17,ry:17,fill:'#d98b3a'},g);
  el('ellipse',{cx:side*-3,cy:-2,rx:17,ry:17,fill:'url(#knit)'},g);
  const up=el('g',{},g);
  const fo=el('g',{},up);
  const hand=el('g',{},fo);
  el('rect',{x:-13,y:-8,width:26,height:10,rx:5,fill:'#f6d48f'},hand);
  const sk='#eab296', skD='#c98a6c';
  const finger=(par,x1,y1,x2,y2,w)=>{el('path',{d:`M${x1} ${y1} L${x2} ${y2}`,stroke:skD,fill:'none','stroke-width':w+1.4,'stroke-linecap':'round'},par);el('path',{d:`M${x1} ${y1} L${x2} ${y2}`,stroke:'#f2c0a2',fill:'none','stroke-width':w,'stroke-linecap':'round'},par);};
  // relaxed / open hand: palm + thumb + 4 fingers
  const open=el('g',{},hand);
  finger(open,side*-8,8,side*-16,22,6);
  el('path',{d:`M-10 0 Q-13 14 -10 25 Q-5 31 0 31 Q7 31 10 25 Q13 14 10 0 Z`,fill:'url(#skinL)',stroke:skD,'stroke-width':.8},open);
  [[-7,36],[-2.4,39],[2.4,39],[7,35]].forEach(([x,y])=>finger(open,x,26,x*1.1,y,4.6));
  el('path',{d:'M-6 14 Q0 18 6 13',stroke:skD,fill:'none','stroke-width':.9,opacity:.7},open);
  // pointing hand: fist with curled knuckles + extended index + thumb
  const point=el('g',{opacity:0},hand);
  el('path',{d:'M-10 0 Q-13 14 -10 24 Q-4 32 2 31 Q10 30 11 22 Q13 12 10 0 Z',fill:'url(#skinL)',stroke:skD,'stroke-width':.8},point);
  [-5,0,5].forEach(x=>el('ellipse',{cx:x-side*2,cy:28,rx:3,ry:3.4,fill:'#f2c0a2',stroke:skD,'stroke-width':.8},point));
  finger(point,side*6,24,side*6,50,5.4);
  el('ellipse',{cx:side*6,cy:49,rx:1.6,ry:1.3,fill:'#fbe3d6'},point);
  finger(point,side*-9,8,side*-3,24,5.6);
  const arm={sleeve:[sleeveDark,sleeve,sleeveKnit,sleeveHi]};
  // phone hand: hand + upright phone
  const phone=el('g',{opacity:0},hand);
  el('path',{d:'M-10 0 Q-13 14 -10 26 Q-6 34 0 34 Q8 34 10 26 Q13 14 10 0 Z',fill:'url(#skinL)'},phone);
  const ph=el('g',{},phone);
  const phInner=el('g',{transform:'translate(0 -62)'},ph);
  el('rect',{x:-30,y:-52,width:60,height:104,rx:10,fill:'url(#phoneG)'},phInner);
  el('rect',{x:-26,y:-45,width:52,height:88,rx:6,fill:'#fdf3e3'},phInner);
  el('text',{x:0,y:-22,'text-anchor':'middle','font-size':7,'font-weight':700,fill:'#b0476b'},phInner).textContent='LOOK, DEAR';
  el('text',{x:0,y:2,'text-anchor':'middle','font-size':9.5,'font-weight':800,fill:'#2b2420'},phInner).textContent='[ONE';
  el('text',{x:0,y:14,'text-anchor':'middle','font-size':9.5,'font-weight':800,fill:'#2b2420'},phInner).textContent='NUMBER]';
  el('text',{x:0,y:32,'text-anchor':'middle','font-size':6,fill:'#6d5f55'},phInner).textContent='[what it means]';
  // fingers wrapped over phone edge
  for(let i=0;i<3;i++)el('ellipse',{cx:side*-26,cy:-60+i*9,rx:5,ry:4,fill:'#eab296'},phInner);
  return {g,sx,sy,up,fo,hand,open,point,phone,ph,side,sleeves:arm.sleeve,
    a1:new S(0,38,9),a2:new S(0,30,7.5),a3:new S(0,55,9),
    pOpen:new S(1,60,14),pPoint:new S(0,60,14),pPhone:new S(0,60,14)};
}
const L=buildArm(-1), R=buildArm(1);
L.g.setAttribute('transform',`translate(${L.sx} ${L.sy})`);
R.g.setAttribute('transform',`translate(${R.sx} ${R.sy})`);

// ---- poses (degrees; positive = swing toward screen-left) ----
// [a1, a2(relative), a3(relative), handPose]
const POSE={
  restL:[-8,-50,-14,'open'], restR:[8,50,14,'open'],
  pointR:[-156,-2,-4,'point'],
  psstL:[30,152,-6,'point'],
  phoneL:[38,168,0,'phone'],
  explainL:[24,-176,12,'open'], explainR:[-24,176,-12,'open'],
  shockL:[34,160,-20,'open'], shockR:[-34,-160,20,'open'],
  laughL:[-6,-58,-14,'open'], laughR:[6,58,14,'open'],
};
function setArm(arm,p){arm.a1.t=p[0];arm.a2.t=p[1];arm.a3.t=p[2];arm.pose=p[3];}
setArm(L,POSE.restL);setArm(R,POSE.restR);
for(const a of [L,R]){a.a1.x=a.a1.t;a.a2.x=a.a2.t;a.a3.x=a.a3.t;}

// ---- expressions ----
const EXPR={
  neutral:{brow:0,browTilt:0,asym:0,lidU:.18,lidL:.06,smile:.35,smileAsym:0,open:0,wide:.5,blush:.25,tilt:0,pitch:0},
  happy:{brow:2.5,browTilt:-2,asym:0,lidU:.12,lidL:.32,smile:1,smileAsym:0,open:.18,wide:.75,blush:.6,tilt:-3,pitch:-2},
  surprised:{brow:9,browTilt:4,asym:0,lidU:0,lidL:0,smile:-.1,smileAsym:0,open:.8,wide:.15,blush:.35,tilt:0,pitch:-5},
  sly:{brow:1,browTilt:0,asym:6,lidU:.45,lidL:.18,smile:.55,smileAsym:.55,open:0,wide:.55,blush:.35,tilt:7,pitch:3},
  laughing:{brow:4,browTilt:-3,asym:0,lidU:.58,lidL:.5,smile:1,smileAsym:0,open:.62,wide:.85,blush:.8,tilt:-4,pitch:-7},
};
const ex={};for(const k in EXPR.neutral)ex[k]=new S(EXPR.neutral[k],40,12);
let exprName='neutral';
function setExpr(n){exprName=n;const e=EXPR[n];for(const k in e)ex[k].t=e[k];}

// ---- head / body springs ----
const head={roll:new S(0,60,11),pitch:new S(0,70,11),yaw:new S(0,50,10),dy:new S(0,80,12)};
const body={sway:new S(0,8,5),shift:new S(0,6,5)};
const gaze={x:new S(0,700,48),y:new S(0,700,48)};
const bun={r:new S(0,140,5),y:new S(0,160,7)};
const jaw=new S(0,500,34), mWide=new S(.5,400,30), mRound=new S(0,400,30);
const nz={roll:noise(1),pitch:noise(2),yaw:noise(3),sway:noise(4),shift:noise(5),armL:noise(6),armR:noise(7)};

// ---- hair strands (verlet) ----
const strandG=$('strands');
function mkStrand(anchorId,n,seg,dir,w){
  const pts=[];for(let i=0;i<n;i++)pts.push({x:0,y:0,px:0,py:0});
  const p=el('path',{'stroke-width':w},strandG);
  return {a:$(anchorId),pts,seg,dir,p,init:false};
}
const strands=[mkStrand('anchorL',6,8,[-0.35,1],2.4),mkStrand('anchorL',5,8,[-0.15,1],1.6),mkStrand('anchorR',6,8,[0.3,1],2.2),mkStrand('anchorB',4,7,[-0.8,-0.5],1.4)];
function anchorPos(a){const m=strandG.getCTM().inverse().multiply(a.getCTM());return {x:m.e,y:m.f};}
function stepStrands(dt){
  for(const s of strands){
    const A=anchorPos(s.a);
    if(!s.init){s.pts.forEach((p,i)=>{p.x=p.px=A.x+s.dir[0]*s.seg*i;p.y=p.py=A.y+s.dir[1]*s.seg*i;});s.init=true;}
    const g=s.dir[1]<0?-120:420;
    for(let i=1;i<s.pts.length;i++){const p=s.pts[i];const vx=(p.x-p.px)*0.95,vy=(p.y-p.py)*0.95;p.px=p.x;p.py=p.y;p.x+=vx;p.y+=vy+(s.dir[1]<0?0:g*dt*dt);
      // gentle pull toward rest shape (hair has some stiffness)
      const rx=A.x+s.dir[0]*s.seg*i, ry=A.y+Math.abs(s.dir[1])*s.seg*i*(s.dir[1]<0?-1:1);p.x+=(rx-p.x)*0.035;p.y+=(ry-p.y)*0.035;}
    s.pts[0].x=A.x;s.pts[0].y=A.y;
    for(let it=0;it<4;it++)for(let i=1;i<s.pts.length;i++){const a=s.pts[i-1],b=s.pts[i];const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,diff=(d-s.seg)/d;
      if(i===1){b.x-=dx*diff;b.y-=dy*diff;}else{a.x+=dx*diff*.5;a.y+=dy*diff*.5;b.x-=dx*diff*.5;b.y-=dy*diff*.5;}}
    const P=s.pts;let d=`M${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
    for(let i=1;i<P.length-1;i++){const mx=(P[i].x+P[i+1].x)/2,my=(P[i].y+P[i+1].y)/2;d+=` Q${P[i].x.toFixed(1)} ${P[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;}
    s.p.setAttribute('d',d);
  }
}

// ---- blink & saccades ----
let blink=0, blinkT=rnd(1.5,4), blinkPhase=-1, doubleBlink=false;
let sacT=rnd(.4,2), lookAtCard=0;
function stepBlink(dt){
  blinkT-=dt;
  if(blinkPhase<0&&blinkT<=0){blinkPhase=0;doubleBlink=Math.random()<0.15;}
  if(blinkPhase>=0){blinkPhase+=dt;const c=.07,o=.13;
    blink=blinkPhase<c?blinkPhase/c:blinkPhase<c+o?1-(blinkPhase-c)/o:0;
    if(blinkPhase>=c+o){if(doubleBlink){doubleBlink=false;blinkPhase=0;}else{blinkPhase=-1;blinkT=rnd(1.8,5.5);}}}
  sacT-=dt;
  if(sacT<=0){sacT=talking?rnd(.5,1.6):rnd(.3,2.4);
    if(lookAtCard>0){gaze.x.t=3.2;gaze.y.t=-2.4;}
    else{const near=talking?0.6:1;gaze.x.t=rnd(-3,3)*near;gaze.y.t=rnd(-1.6,1.6)*near;}
    if(Math.random()<.3&&blinkPhase<0)blinkT=Math.min(blinkT,.02);// blinks often accompany big eye moves
  }
}

// ---- gestures ----
let gestTimers=[], gestName='rest', explainOn=false, laughOn=0;
function clearGest(){gestTimers.forEach(clearTimeout);gestTimers=[];explainOn=false;}
function later(ms,f){gestTimers.push(setTimeout(f,ms));}
// timers are virtual so the test hook can step time deterministically
let vtime=0; const vq=[];
function vlater(sec,f){vq.push({t:vtime+sec,f});}
function runVq(){for(let i=vq.length-1;i>=0;i--)if(vq[i].t<=vtime){const f=vq[i].f;vq.splice(i,1);f();}}
function rest(){setArm(L,POSE.restL);setArm(R,POSE.restR);explainOn=false;lookAtCard=0;gestName='rest';if(exprName!=='happy'&&exprName!=='neutral')setExpr(talking?'happy':'neutral');}
let gestId=0;
function gesture(name,hold){
  const id=++gestId;const done=s=>vlater(s,()=>{if(id===gestId)rest();});
  explainOn=false;lookAtCard=0;gestName=name;
  if(name==='point'){setArm(R,POSE.pointR);setArm(L,POSE.restL);lookAtCard=1;head.yaw.v+=40;head.roll.v-=30;done(hold||2.6);}
  else if(name==='psst'){setArm(L,POSE.psstL);setArm(R,POSE.restR);setExpr('sly');head.roll.v+=40;done(hold||2.4);}
  else if(name==='phone'){setArm(L,POSE.phoneL);setArm(R,[-14,112,-14,'open']);head.pitch.v+=20;done(hold||3);}
  else if(name==='explain'){setArm(L,POSE.explainL);setArm(R,POSE.explainR);explainOn=true;done(hold||3.2);}
  else if(name==='shock'){setArm(L,POSE.shockL);setArm(R,POSE.shockR);setExpr('surprised');head.dy.v-=60;head.pitch.v-=60;done(hold||2);}
  else if(name==='laugh'){setArm(L,POSE.laughL);setArm(R,POSE.laughR);setExpr('laughing');laughOn=hold||2.4;done(hold||2.6);}
  else if(name==='nod'){nod(1);}
  else rest();
}
function nod(s){head.pitch.v+=90*s;ex.brow.v+=30*s;}

// ---- speech ----
const SAMPLE="Oh, come here, dear. Psst! You will not *believe* what happened in AI today. Somebody launched a *brand* new model, and look at this number... *[ONE NUMBER]*! *Shocking.* Ha ha! Anyway. Now go eat something, dear.";
const CUES={'Psst!':'psst','believe':'explain','brand':'point','number...':'phone','Shocking.':'shock','Ha':'laugh','Anyway.':'happy','Now':'happyNod'};
let talking=false, words=[], wIdx=-1, wStart=0, talkT=0, soundOn=true, utter=null, lastBoundary=-1;
function parse(text){const out=[];let ci=0;const clean=text.replace(/\*/g,'');
  text.split(/\s+/).forEach(w=>{const emph=w.startsWith('*');const word=w.replace(/\*/g,'');const idx=clean.indexOf(word,ci);ci=idx+word.length;
    const letters=word.replace(/[^a-z]/gi,'');let dur=0.11+letters.length*0.062;let pause=/[.!?]$/.test(word)?0.42:/[,;]$/.test(word)?0.2:/\.\.\.$/.test(word)?0.5:0.03;
    out.push({w:word,emph,ci:idx,dur,pause,letters:letters.toLowerCase()});});
  return {clean,out};}
function vis(ch){if(!ch)return [0,.5,0];if('aáh'.includes(ch))return [.9,.65,0];if('ei'.includes(ch))return [.45,.95,0];if('o'.includes(ch))return [.7,.2,1];if('uwq'.includes(ch))return [.35,.1,1];
  if('mbp'.includes(ch))return [0,.45,0];if('fv'.includes(ch))return [.12,.6,0];if('ly'.includes(ch))return [.4,.6,0];if('td n s z c k g j r x'.includes(ch))return [.28,.65,0];return [.35,.55,0];}
function startWord(i){wIdx=i;wStart=talkT;const W=words[i];if(!W)return;
  if(W.emph)nod(1.1);
  const c=CUES[W.w];
  if(c==='happy')setExpr('happy');else if(c==='happyNod'){setExpr('happy');nod(1.4);gesture('explain',2.2);}
  else if(c)gesture(c, c==='phone'?3.6:undefined);
  if(!c&&i%6===3&&gestName==='rest')gesture('explain',1.8);
  $('capText').textContent=captionFor(i);}
function captionFor(i){const s=Math.max(0,i-2);return words.slice(s,s+4).map(x=>x.w).join(' ');}
function say(text,silent){stopTalk();const P=parse(text);words=P.out;talking=true;talkT=0;wIdx=-1;lastBoundary=-1;
  $('caption').setAttribute('opacity',1);setExpr('happy');
  const useVoice=!silent&&soundOn&&'speechSynthesis' in window;
  if(useVoice){utter=new SpeechSynthesisUtterance(P.clean.replace(/\[ONE NUMBER\]/,'one number'));
    const vs=speechSynthesis.getVoices();const pick=vs.find(v=>/en/i.test(v.lang)&&/female|zira|susan|hazel|libby|sonia|samantha|karen|serena|aria|jenny/i.test(v.name))||vs.find(v=>/en/i.test(v.lang));
    if(pick)utter.voice=pick;utter.rate=.92;utter.pitch=1.15;
    utter.onboundary=e=>{if(e.name&&e.name!=='word')return;const k=words.findIndex(x=>x.ci>=e.charIndex-1);if(k>lastBoundary){lastBoundary=k;if(k!==wIdx)startWord(k);}};
    utter.onend=()=>{if(wIdx>=words.length-2)endTalk();else utter=null;};utter.onerror=()=>{utter=null;};
    speechSynthesis.cancel();speechSynthesis.speak(utter);}
  startWord(0);}
function stopTalk(){if('speechSynthesis' in window)speechSynthesis.cancel();endTalk();}
function endTalk(){if(!talking)return;talking=false;$('caption').setAttribute('opacity',0);jaw.t=0;setExpr('happy');vlater(1.2,()=>{if(!talking)setExpr('neutral');});}
function stepTalk(dt){if(!talking)return;talkT+=dt;const W=words[wIdx];if(!W){endTalk();return;}
  const el_=talkT-wStart;
  // timeline mode advances by itself; voice mode waits for boundary events but has a safety advance
  const voice=utter&&soundOn&&speechSynthesis.speaking;
  const limit=W.dur+W.pause+(voice?0.9:0);
  if(el_>=limit){if(wIdx+1<words.length){if(!voice||lastBoundary<0||el_>limit)startWord(wIdx+1);}else if(!voice)endTalk();}
  if(el_<W.dur&&W.letters.length){const ci=Math.min(W.letters.length-1,Math.floor(el_/W.dur*W.letters.length));const v=vis(W.letters[ci]);
    const wob=0.82+0.18*Math.sin(talkT*21);jaw.t=v[0]*wob*(W.emph?1.25:1);mWide.t=v[1];mRound.t=v[2];}
  else{jaw.t=0;mWide.t=.5;mRound.t=0;}
}

// ---- layout ----
let wide=false;
function layout(){const svg=$('stage');
  if(!wide){svg.setAttribute('viewBox','0 0 360 640');$('bgRect').setAttribute('width',360);$('card').setAttribute('transform','translate(30 46)');
    $('char').setAttribute('transform','translate(176 444)');$('capBg').setAttribute('x',20);$('capBg').setAttribute('y',560);$('capBg').setAttribute('width',320);$('capText').setAttribute('x',180);$('capText').setAttribute('y',594);
    $('room').setAttribute('transform','');}
  else{svg.setAttribute('viewBox','0 0 640 360');$('bgRect').setAttribute('width',640);$('card').setAttribute('transform','translate(318 70) scale(.98)');
    $('char').setAttribute('transform','translate(170 288) scale(.78)');$('capBg').setAttribute('x',150);$('capBg').setAttribute('y',296);$('capBg').setAttribute('width',340);$('capText').setAttribute('x',320);$('capText').setAttribute('y',330);
    $('room').setAttribute('transform','translate(250 -190)');}
  $('wrap').classList.toggle('wide',wide);$('fmtV').setAttribute('aria-pressed',!wide);$('fmtW').setAttribute('aria-pressed',wide);}

// ---- main step ----
let T=0, prevRoll=0, prevPitch=0;
const f1=x=>x.toFixed(2);
function step(dt){
  dt=Math.min(dt,0.05);
  const n=Math.max(1,Math.ceil(dt/(1/120))), h=dt/n;
  for(let i=0;i<n;i++)sub(h);
  render(dt);
}
function sub(dt){
  T+=dt;vtime+=dt;runVq();
  stepBlink(dt);stepTalk(dt);
  const e=EXPR[exprName];
  const talkAmp=talking?1.6:1;
  head.roll.t=nz.roll(T*0.7)*2.2*talkAmp+ex.tilt.x+(lookAtCard?-5:0);
  head.pitch.t=nz.pitch(T*0.8)*1.6*talkAmp+ex.pitch.x+(laughOn>0?Math.sin(T*22)*2.5-4:0);
  head.yaw.t=nz.yaw(T*0.5)*0.35*talkAmp+(lookAtCard?0.6:0)+(exprName==='sly'?-0.4:0);
  head.dy.t=(laughOn>0?Math.abs(Math.sin(T*11))*-3:0);
  body.sway.t=nz.sway(T*0.25)*1.4+(laughOn>0?Math.sin(T*11)*1.2:0);
  body.shift.t=nz.shift(T*0.2)*5;
  if(laughOn>0)laughOn-=dt;
  for(const k in head)head[k].step(dt);for(const k in body)body[k].step(dt);
  gaze.x.step(dt);gaze.y.step(dt);for(const k in ex)ex[k].step(dt);
  jaw.step(dt);mWide.step(dt);mRound.step(dt);
  // bun inertia: reacts to head angular acceleration
  const dr=(head.roll.x-prevRoll)/dt, dp=(head.pitch.x-prevPitch)/dt;prevRoll=head.roll.x;prevPitch=head.pitch.x;
  bun.r.v-=dr*0.9*dt*60*0.12;bun.y.v-=dp*0.5*dt*60*0.12;bun.r.step(dt);bun.y.step(dt);
  // arms: overlay explaining beats + idle noise
  for(const A of [L,R]){
    const s=A.side;const base=POSE[(A===L?'rest':'rest')+(A===L?'L':'R')];
    if(explainOn){const ph=T*3.1+(A===L?0:1.7);A.a2.t=(A===L?POSE.explainL:POSE.explainR)[1]+Math.sin(ph)*10*-s;A.a3.t=(A===L?POSE.explainL:POSE.explainR)[2]+Math.sin(ph-0.8)*16;}
    A.a1.step(dt);A.a2.step(dt);A.a3.step(dt);
    A.pOpen.t=A.pose==='open'?1:0;A.pPoint.t=A.pose==='point'?1:0;A.pPhone.t=A.pose==='phone'?1:0;
    A.pOpen.step(dt);A.pPoint.step(dt);A.pPhone.step(dt);
  }
}
const breath=()=>Math.sin(T*2*Math.PI/4.2);
function render(dt){
  const b=breath();
  const sway=body.sway.x, shift=body.shift.x;
  $('root').setAttribute('transform',`translate(${f1(shift)} 0) rotate(${f1(sway)} 0 240)`);
  $('torso').setAttribute('transform',`translate(0 ${f1(-b*1.2)}) scale(1 ${(1+b*0.008).toFixed(4)})`);
  const shY=-b*2.2;
  const hr=head.roll.x, hp=head.pitch.x, hy=head.yaw.x;
  $('head').setAttribute('transform',`translate(${f1(hy*6)} ${f1(shY+head.dy.x+hp*0.35)}) rotate(${f1(hr)} 0 -70)`);
  $('neckG').setAttribute('transform',`translate(${f1(hy*3)} ${f1(shY*0.6)})`);
  $('feat').setAttribute('transform',`translate(${f1(hy*5)} ${f1(hp*0.9)})`);
  $('hairFront').setAttribute('transform',`translate(${f1(hy*2)} ${f1(hp*0.3)})`);
  $('bun').setAttribute('transform',`translate(${f1(-hy*4)} ${f1(bun.y.x*0.4)}) rotate(${f1(bun.r.x)} 0 -172)`);
  // eyes
  const lidU=Math.min(1,ex.lidU.x+blink*(1-ex.lidU.x)), lidL=ex.lidL.x*(1-blink*0.3);
  const asy=ex.asym.x;
  // turning: the far side of the face foreshortens
  const sqL=1-Math.max(0,-hy)*0.32, sqR=1-Math.max(0,hy)*0.32;
  $('eyeL').setAttribute('transform',`translate(-22 -126) scale(${sqL.toFixed(3)} 1)`);
  $('eyeR').setAttribute('transform',`translate(22 -126) scale(${sqR.toFixed(3)} 1)`);
  $('lensL').setAttribute('transform',`translate(-22 -125) scale(${sqL.toFixed(3)} 1) translate(22 125)`);
  $('lensR').setAttribute('transform',`translate(22 -125) scale(${sqR.toFixed(3)} 1) translate(-22 125)`);
  $('browL').firstElementChild.setAttribute('transform',`scale(${sqL.toFixed(3)} 1)`);
  $('browR').firstElementChild.setAttribute('transform',`scale(${sqR.toFixed(3)} 1)`);
  [['eyeL',-1],['eyeR',1]].forEach(([id,s])=>{const g=$(id);
    const lu=Math.min(1,lidU+(s<0?-asy*0.02:asy*0.035)), ll=lidL;
    const uh=lu*17, lh=ll*9;
    g.querySelector('.lidU').setAttribute('height',f1(uh));
    const lr=g.querySelector('.lidL');lr.setAttribute('y',f1(9-lh));lr.setAttribute('height',f1(lh+1));
    const sc=exprName==='surprised'?0.85:1;
    g.querySelector('.iris').setAttribute('transform',`translate(${f1(gaze.x.x+hy*1.5)} ${f1(gaze.y.y!==undefined?gaze.y.x:0)}) scale(${sc})`);
    const ey=-9+uh;const cy=Math.min(ey,8);
    g.querySelector('.lash').setAttribute('d',lu>0.97?`M-11 0 Q0 ${f1(3+ll*3)} 11 0`:`M-11.5 ${f1(Math.max(-1,cy*0.55))} Q0 ${f1(cy-1)} 11.5 ${f1(Math.max(-1,cy*0.55))}`);
  });
  // brows
  const br=ex.brow.x, bt=ex.browTilt.x;
  $('browL').setAttribute('transform',`translate(-23 ${f1(-146-br+asy*0.5)}) rotate(${f1(bt+asy*0.6)})`);
  $('browR').setAttribute('transform',`translate(23 ${f1(-146-br-asy)}) rotate(${f1(-bt+asy*0.4)})`);
  // mouth
  const open=Math.max(ex.open.x, jaw.x*(1-ex.open.x*0.4)+ex.open.x*0.4);
  const wideV=talking?mWide.x*0.6+ex.wide.x*0.4:ex.wide.x, round=talking?mRound.x:0;
  const sm=ex.smile.x, sa=ex.smileAsym.x;
  const w=11+wideV*8-round*5-open*2;
  const sL=sm-sa*0.4, sR=sm+sa*0.6;
  const cyL=-sL*5, cyR=-sR*5;
  const top=-1.5-open*4+sm*1.2, bot=1.5+open*17+sm*5;
  const dIn=`M${f1(-w)} ${f1(cyL)} Q0 ${f1(top*1.6)} ${f1(w)} ${f1(cyR)} Q0 ${f1(bot*1.6- (open<.05?bot*1.2:0))} ${f1(-w)} ${f1(cyL)} Z`;
  $('mouthIn').setAttribute('d',dIn);$('mouthClipPath').setAttribute('d',dIn);
  $('mouthIn').setAttribute('opacity',open>0.03?1:0);$('mouthTeeth').setAttribute('opacity',open>0.03?1:0);
  $('teeth').setAttribute('y',f1(top*1.6-2));
  $('tongue').setAttribute('cy',f1(bot*1.4));
  $('mouthLine').setAttribute('d',open>0.03?dIn:`M${f1(-w)} ${f1(cyL)} Q0 ${f1(4+sm*5)} ${f1(w)} ${f1(cyR)}`);
  const bl=ex.blush.x;$('blushL').setAttribute('opacity',f1(bl*0.45));$('blushR').setAttribute('opacity',f1(bl*0.45));
  // arms
  for(const A of [L,R]){
    A.g.setAttribute('transform',`translate(${A.sx} ${f1(A.sy+shY)})`);
    const idle=(A===L?nz.armL:nz.armR)(T*0.6)*2;
    const a1=A.a1.x+idle, a2=A.a2.x+idle*0.6, a3=A.a3.x+idle;
    A.up.setAttribute('transform',`rotate(${f1(a1)})`);
    {const r1=a1*D,r2=(a1+a2)*D;const ex_=-92*Math.sin(r1),ey_=92*Math.cos(r1);const wx=ex_-74*Math.sin(r2),wy=ey_+74*Math.cos(r2);
     const sx0=-4*Math.sin(r1),sy0=4*Math.cos(r1);
     const d=`M${f1(sx0)} ${f1(sy0)} L${f1(ex_)} ${f1(ey_)} L${f1(wx)} ${f1(wy)}`;
     A.sleeves.forEach((p,i)=>p.setAttribute('d',i===3?`M${f1(sx0-6*Math.cos(r1)*A.side)} ${f1(sy0)} L${f1(ex_-5*Math.cos(r1)*A.side)} ${f1(ey_)} L${f1(wx-4*Math.cos(r2)*A.side)} ${f1(wy)}`:d));}
    A.fo.setAttribute('transform',`translate(0 92) rotate(${f1(a2)})`);
    A.hand.setAttribute('transform',`translate(0 80) rotate(${f1(a3)})`);
    A.open.setAttribute('opacity',f1(A.pOpen.x));A.point.setAttribute('opacity',f1(A.pPoint.x));A.phone.setAttribute('opacity',f1(A.pPhone.x));
    A.open.setAttribute('display',A.pOpen.x<.02?'none':'inline');A.point.setAttribute('display',A.pPoint.x<.02?'none':'inline');A.phone.setAttribute('display',A.pPhone.x<.02?'none':'inline');
    A.ph.setAttribute('transform',`rotate(${f1(-(a1+a2+a3+sway))})`);
  }
  // card glow when pointed at
  $('cardGlow').setAttribute('opacity',f1(Math.max(0,R.pPoint.x)*0.9));
  $('cardInner').setAttribute('transform',`translate(0 ${f1(Math.sin(T*1.3)*1.5)})`);
  stepStrands(dt);
}

// ---- UI ----
const exprList=[['neutral','Calm'],['happy','Happy'],['surprised','Shocked'],['sly','Sly gossip'],['laughing','Laughing']];
exprList.forEach(([k,lab])=>{const b=document.createElement('button');b.textContent=lab;b.onclick=()=>{setExpr(k);if(k==='laughing'){laughOn=2.4;vlater(2.6,()=>setExpr('happy'));}if(k==='surprised'){head.dy.v-=60;}};$('exprBtns').appendChild(b);});
[['explain','Explain'],['point','Point at card'],['psst','"Psst!" finger'],['phone','Show phone'],['shock','Gasp'],['laugh','Laugh'],['nod','Nod'],['rest','Hands down']].forEach(([k,lab])=>{const b=document.createElement('button');b.textContent=lab;b.onclick=()=>gesture(k);$('gestBtns').appendChild(b);});
$('play').onclick=()=>say(SAMPLE,false);
$('stop').onclick=()=>{stopTalk();rest();setExpr('neutral');};
$('sound').onclick=()=>{soundOn=!soundOn;$('sound').textContent='Sound: '+(soundOn?'on':'off (silent demo)');$('sound').setAttribute('aria-pressed',soundOn);if(!soundOn&&'speechSynthesis' in window)speechSynthesis.cancel();};
$('fmtV').onclick=()=>{wide=false;layout();};
$('fmtW').onclick=()=>{wide=true;layout();};
if(!('speechSynthesis' in window))$('voiceNote').textContent='This browser has no built-in voice, so she talks silently.';
else{speechSynthesis.getVoices();}
layout();

// ---- loop + test hook ----
let last=performance.now(), manual=false;
function loop(now){const dt=(now-last)/1000;last=now;if(!manual)step(dt);requestAnimationFrame(loop);}
requestAnimationFrame(loop);
step(1/60);
window.__host={step(sec){manual=true;let s=sec;while(s>0){const d=Math.min(s,1/60);step(d);s-=d;}manual=false;last=performance.now();},
  setExpr,gesture,say:(t,silent)=>say(t||SAMPLE,silent!==false),stop:stopTalk,
  state:()=>({T,expr:exprName,gest:gestName,talking,wIdx,blink,arms:[L.a1.x,L.a2.x,R.a1.x,R.a2.x]}),
  layout:w=>{wide=!!w;layout();}};
})();
