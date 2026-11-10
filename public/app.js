'use strict';
/* =========================================================
   Helpers
   ========================================================= */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MND=['jan.','feb.','mar.','apr.','mai','jun.','jul.','aug.','sep.','okt.','nov.','des.'];
const fdate=t=>{const d=new Date(t);return d.getDate()+'. '+MND[d.getMonth()]+' '+d.getFullYear()};
const fclock=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const ftime=t=>fdate(t)+', '+fclock(t);
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const REDUCE=matchMedia('(prefers-reduced-motion: reduce)').matches;
function toast(t){document.querySelectorAll('.toast').forEach(e=>e.remove());const el=document.createElement('div');el.className='toast';el.textContent=t;document.body.appendChild(el);setTimeout(()=>el.remove(),2600)}

/* =========================================================
   Static content
   ========================================================= */
const BIZ=[
  ['PO','Politiet','Etat','Patrulje, etterforskning og utrykning. Krever opplæring etter opptak.','ansetter','politi'],
  ['AM','Ambulanse og sykehus','Etat','Akuttmottak, ambulanse og behandling. Ingen respawn.','ansetter','ambulanse'],
  ['NM','Novex Motorverksted','Bedrift','Verksted, tuning og bilberging døgnet rundt.','ansetter','mekaniker'],
  ['BB','Bergeland Bil','Bedrift','Nybil- og bruktbilforhandler i sentrum.','ansetter','selger'],
  ['NK','Nordlys Kafé','Bedrift','Kafé og møteplass på torget.','fullt',null],
  ['FT','Fjordtaxi','Bedrift','Taxi og privatsjåfør i hele byen.','fullt',null],
  ['AH','Advokatfirmaet Holm','Bedrift','Forsvar, kontrakter og juridisk rådgivning.','fullt',null],
  ['NB','Novex Bank','Bedrift','Lån, kontoer og verditransport.','fullt',null]
];
const CARS=[
  /* bilde: legg et skjermbilde fra serveren i img/biler/ med dette navnet, så vises det i stedet for 3D-modellen */
  {n:'Volta Strada XR',cls:'Superbil',color:0xd4111c,hex:'#d4111c',kind:'super',pris:'3 950 000 kr',topp:'340 km/t',hk:'720 hk',acc:'2,9 s',plate:'NV 10007',bilde:'img/biler/bil1.jpg'},
  {n:'Kaido GT-S',cls:'Sportscoupé',color:0xc9ccd1,hex:'#c9ccd1',kind:'coupe',pris:'1 290 000 kr',topp:'315 km/t',hk:'600 hk',acc:'3,2 s',plate:'EL 31470',bilde:'img/biler/bil2.jpg'},
  {n:'Bulldog V8',cls:'Muskelbil',color:0x141416,hex:'#141416',kind:'muscle',pris:'890 000 kr',topp:'280 km/t',hk:'710 hk',acc:'3,7 s',plate:'DR 66812',bilde:'img/biler/bil3.jpg'},
  {n:'Fjordline GT',cls:'Sport',color:0xf3f3f3,hex:'#f3f3f3',kind:'sport',pris:'2 150 000 kr',topp:'305 km/t',hk:'540 hk',acc:'3,6 s',plate:'EK 20519',bilde:'img/biler/bil4.jpg'},
  {n:'Nordkapp X5',cls:'SUV',color:0x2a2d33,hex:'#2a2d33',kind:'suv',pris:'1 480 000 kr',topp:'210 km/t',hk:'340 hk',acc:'6,2 s',plate:'DR 77125',bilde:'img/biler/bil5.jpg'},
  {n:'Tesmo V',cls:'Elbil',color:0x9ea3a8,hex:'#9ea3a8',kind:'ev',pris:'890 000 kr',topp:'233 km/t',hk:'480 hk',acc:'3,9 s',plate:'EK 50094',bilde:'img/biler/bil6.jpg'}
];
const CLIPS=[
  /* traileren spilles på repeat i «Novex på film» */
  {k:'dag',t:'Trailer',s:'Novex Rollespill',video:'video/klipp1.mp4'}
];
const CLIP_LEN=10;

/* =========================================================
   3D ENGINE (three.js r128)
   ========================================================= */
const G={ok:typeof THREE!=='undefined',t:0};
function canvasTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);return t}
function makeGlow(){return canvasTex(64,64,(g)=>{const r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.22,'rgba(255,255,255,.7)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,64)})}
function makeWin(variant){
  const lit=['#ffe8c2','#ffffff','#ffd9a0','#ff3340'],cells=[];
  for(let i=0;i<16;i++)cells.push(Math.random()<.34?lit[variant===3&&Math.random()<.5?3:Math.floor(Math.random()*3)]:null);
  const facade=['#a39b91','#bdb6ab','#93969b','#ae9f8e'][variant];
  const mk=(day)=>{const t=canvasTex(64,64,(g)=>{g.fillStyle=day?facade:'#000';g.fillRect(0,0,64,64);
    cells.forEach((c,i)=>{const x=(i%4)*16+3,y=Math.floor(i/4)*16+3;
      if(day){g.fillStyle='#33404d';g.fillRect(x,y,10,11);g.fillStyle='rgba(255,255,255,.28)';g.fillRect(x,y,10,3)}
      else{g.fillStyle=c||'#000';g.fillRect(x,y,10,11)}})});
    t.wrapS=t.wrapT=THREE.RepeatWrapping;return t};
  return {day:mk(true),lit:mk(false)};
}

function makeCar(color,kind,opts={}){
  const PRE={
    sedan:{L:4.6,H:.95,W:2,cL:2.4,cH:.75,cX:-.15,y:.5,r:.42},
    sport:{L:4.8,H:.75,W:2.05,cL:2.0,cH:.6,cX:-.45,y:.42,r:.44,nose:1.2},
    super:{L:4.9,H:.6,W:2.2,cL:1.6,cH:.55,cX:-.3,y:.36,r:.47,nose:1.6,wing:'low',intake:1},
    coupe:{L:4.6,H:.78,W:2.02,cL:2.0,cH:.62,cX:-.35,y:.42,r:.44,nose:.9,wing:'high'},
    muscle:{L:5.0,H:.9,W:2.08,cL:1.9,cH:.6,cX:-.65,y:.48,r:.47,scoop:1,stripes:1},
    suv:{L:4.7,H:1.25,W:2.05,cL:3.0,cH:.85,cX:-.3,y:.65,r:.5},
    ev:{L:4.6,H:.9,W:2,cL:2.9,cH:.7,cX:-.05,y:.5,r:.42},
    police:{L:4.7,H:1.0,W:2,cL:2.5,cH:.75,cX:-.15,y:.5,r:.42}
  };
  const P=PRE[kind]||PRE.sedan,W=P.W,top=P.y+P.H;
  const g=new THREE.Group();
  const paint=new THREE.MeshPhongMaterial({color,shininess:opts.show?120:40,specular:opts.show?0x666666:0x222222});
  const glass=new THREE.MeshPhongMaterial({color:0x0b0d12,shininess:150,specular:0x888888});
  const dark=new THREE.MeshPhongMaterial({color:0x111214,shininess:30});
  const add=(geo,mat,x,y,z,rz)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);if(rz)m.rotation.z=rz;g.add(m);return m};
  add(new THREE.BoxGeometry(P.L,P.H,W),paint,0,P.y+P.H/2,0);
  add(new THREE.BoxGeometry(P.cL,P.cH,W-.2),glass,P.cX,top+P.cH/2,0);
  if(!opts.lite){
  add(new THREE.BoxGeometry(P.cL*.8,.08,W-.3),paint,P.cX,top+P.cH+.04,0);
  if(P.nose)add(new THREE.BoxGeometry(P.nose,.28,W*.98),paint,P.L/2-P.nose/2+.05,top+.02,0,-.2);
  if(P.wing){const hgt=P.wing==='high'?.48:.16,x=-P.L/2+.35;
    [.6,-.6].forEach(z=>add(new THREE.BoxGeometry(.12,hgt,.08),dark,x,top+hgt/2,z*(W/2)));
    add(new THREE.BoxGeometry(.55,.06,W*.96),P.wing==='high'?dark:paint,x,top+hgt+.03,0)}
  if(P.intake)[1,-1].forEach(s=>add(new THREE.BoxGeometry(.9,.32,.04),dark,-.7,P.y+P.H*.55,s*(W/2+.01)));
  if(P.scoop)add(new THREE.BoxGeometry(.9,.2,.7),dark,P.L*.24,top+.1,0);
  if(P.stripes){const sm=new THREE.MeshPhongMaterial({color:0xf4f4f4,shininess:60});[.26,-.26].forEach(z=>{add(new THREE.BoxGeometry(P.L*.98,.02,.2),sm,0,top+.011,z);add(new THREE.BoxGeometry(P.cL*.8,.02,.2),sm,P.cX,top+P.cH+.09,z)})}
  }
  const tyre=new THREE.MeshPhongMaterial({color:0x0a0a0a,shininess:5});
  const rim=new THREE.MeshPhongMaterial({color:kind==='super'?0x2a2a2a:0x9a9a9a,shininess:90});
  const wg=new THREE.CylinderGeometry(P.r,P.r,.34,opts.show?24:8),rg=new THREE.CylinderGeometry(P.r*.62,P.r*.62,.36,opts.show?18:8);
  [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([a,b])=>{const w=add(wg,tyre,a*P.L*.31,P.r,b*(W/2-.05));w.rotation.x=Math.PI/2;
    if(opts.show){const r=add(rg,rim,w.position.x,w.position.y,w.position.z);r.rotation.x=Math.PI/2}});
  const hl=new THREE.MeshBasicMaterial({color:0xffffff}),tl=new THREE.MeshBasicMaterial({color:0xff1a28});
  const lz=W/2-.38;
  if(!opts.lite)[lz,-lz].forEach(z=>{add(new THREE.BoxGeometry(.06,.14,.45),hl,P.L/2+.01,P.y+P.H*.7,z);add(new THREE.BoxGeometry(.06,.13,.5),tl,-P.L/2-.01,P.y+P.H*.72,z)});
  if(opts.glow){
    const sp=(c,s,x,y,z)=>{const m=new THREE.Sprite(new THREE.SpriteMaterial({map:G.glow,color:c,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}));m.scale.set(s,s,1);m.position.set(x,y,z);g.add(m);return m};
    [lz,-lz].forEach(z=>{sp(0xfff4e0,2.2,P.L/2+.3,P.y+P.H*.7,z);sp(0xff1a28,1.6,-P.L/2-.2,P.y+P.H*.72,z)});
    const beam=new THREE.Mesh(new THREE.PlaneGeometry(14,3.4),new THREE.MeshBasicMaterial({map:G.beam,color:0xfff0d0,transparent:true,opacity:.28,blending:THREE.AdditiveBlending,depthWrite:false}));
    beam.rotation.x=-Math.PI/2;beam.position.set(P.L/2+7,.06,0);g.add(beam);
  }
  if(kind==='police'){
    add(new THREE.BoxGeometry(P.L+.02,.22,W+.02),new THREE.MeshPhongMaterial({color:0x1d3fa0}),0,P.y+P.H*.45,0);
    add(new THREE.BoxGeometry(.4,.14,1.3),new THREE.MeshBasicMaterial({color:0x222222}),P.cX,top+P.cH+.15,0);
    const mk=(c,z)=>{const m=new THREE.Sprite(new THREE.SpriteMaterial({map:G.glow,color:c,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}));m.position.set(P.cX,top+P.cH+.3,z);m.scale.set(5,5,1);g.add(m);return m};
    g.userData.flash=[mk(0x2a5cff,.4),mk(0xff1a28,-.4)];
  }
  return g;
}

function buildCity(){
  const scene=new THREE.Scene();
  const FOG=0x140708;
  scene.background=canvasTex(4,256,(g,w,h)=>{const r=g.createLinearGradient(0,0,0,h);r.addColorStop(0,'#040303');r.addColorStop(.55,'#12060a');r.addColorStop(.8,'#3a0b10');r.addColorStop(1,'#140708');g.fillStyle=r;g.fillRect(0,0,w,h)});
  scene.fog=new THREE.FogExp2(FOG,.0036);
  const amb=new THREE.AmbientLight(0x3c2a2c,1.0),hemi=new THREE.HemisphereLight(0x8a2a30,0x050505,.55),moon=new THREE.DirectionalLight(0xbfc8ff,.35);
  moon.position.set(-1,2,1);scene.add(amb,hemi,moon);

  const R=4,S=62,BL=44,L=(R+1)*S;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(L*3,L*3),new THREE.MeshLambertMaterial({color:0x0f0d0e}));ground.rotation.x=-Math.PI/2;scene.add(ground);
  // road markings
  const dash=canvasTex(8,64,(g)=>{g.fillStyle='#000';g.fillRect(0,0,8,64);g.fillStyle='#fff';g.fillRect(0,0,8,30)});dash.wrapT=THREE.RepeatWrapping;dash.repeat.set(1,L*2/8);
  const dashMat=new THREE.MeshBasicMaterial({map:dash,color:0xbdb3a6,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false});
  const roads=[];for(let k=-R-1;k<=R;k++)roads.push(k*S+S/2);
  roads.forEach(p=>{
    const a=new THREE.Mesh(new THREE.PlaneGeometry(.35,L*2),dashMat);a.rotation.x=-Math.PI/2;a.position.set(p,.05,0);scene.add(a);
    const b=new THREE.Mesh(new THREE.PlaneGeometry(.35,L*2),dashMat);b.rotation.x=-Math.PI/2;b.rotation.z=Math.PI/2;b.position.set(0,.05,p);scene.add(b);
  });
  const wins=[0,1,2,3].map(makeWin);
  const winMats=wins.map(t=>new THREE.MeshLambertMaterial({color:0x2a2828,map:t.day,emissive:0xffffff,emissiveMap:t.lit,emissiveIntensity:.95}));
  const roofMat=new THREE.MeshLambertMaterial({color:0x151314});
  const walk=new THREE.MeshLambertMaterial({color:0x1d1a1b});
  const glowMat=(c)=>new THREE.SpriteMaterial({map:G.glow,color:c,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true});
  const blinkers=[];
  // Alle faste deler slås sammen til noen få meshes per materiale, så byen tegnes med få draw calls
  const merge=new Map();
  const addGeo=(geo,mats)=>{
    const pos=geo.attributes.position,nor=geo.attributes.normal,uv=geo.attributes.uv,idx=geo.index;
    const groups=geo.groups.length?geo.groups:[{start:0,count:idx?idx.count:pos.count,materialIndex:0}];
    groups.forEach(gr=>{
      const m=Array.isArray(mats)?mats[gr.materialIndex]:mats;
      let e=merge.get(m);if(!e){e={p:[],n:[],u:[],i:[]};merge.set(m,e)}
      const map=new Map();
      for(let k=gr.start;k<gr.start+gr.count;k++){
        const vi=idx?idx.getX(k):k;let ni=map.get(vi);
        if(ni===undefined){ni=e.p.length/3;map.set(vi,ni);e.p.push(pos.getX(vi),pos.getY(vi),pos.getZ(vi));e.n.push(nor.getX(vi),nor.getY(vi),nor.getZ(vi));e.u.push(uv?uv.getX(vi):0,uv?uv.getY(vi):0)}
        e.i.push(ni);
      }
    });
    geo.dispose();
  };
  const signRed=new THREE.MeshBasicMaterial({color:0xff1f2e}),signWhite=new THREE.MeshBasicMaterial({color:0xffffff});
  const lampPts=[],neonPts=[],neonCol=[];
  for(let i=-R;i<=R;i++)for(let j=-R;j<=R;j++){
    const cx=i*S,cz=j*S;
    addGeo(new THREE.BoxGeometry(BL+6,.5,BL+6).translate(cx,.25,cz),walk);
    const dist=Math.hypot(i,j)/(R*1.42);
    for(let a=0;a<2;a++)for(let b=0;b<2;b++){
      if(Math.random()<.12)continue;
      const w=14+Math.random()*6,d=14+Math.random()*6;
      const h=10+Math.random()*30+(1-dist)*(40+Math.random()*90);
      const geo=new THREE.BoxGeometry(w,h,d);
      const uv=geo.attributes.uv;
      for(let f=0;f<6;f++){if(f===2||f===3)continue;const sx=(f<2?d:w)/12,sy=h/12;for(let v=0;v<4;v++){const ix=f*4+v;uv.setXY(ix,uv.getX(ix)*sx,uv.getY(ix)*sy)}}
      const wm=winMats[Math.floor(Math.random()*4)];
      const px=cx+(a-.5)*22,pz=cz+(b-.5)*22;
      geo.translate(px,h/2+.5,pz);addGeo(geo,[wm,wm,roofMat,roofMat,wm,wm]);
      if(h>85){const s=new THREE.Sprite(glowMat(0xff2030));s.scale.set(7,7,1);s.position.set(px,h+1.5,pz);scene.add(s);blinkers.push(s)}
      if(Math.random()<.22){
        const red=Math.random()<.7,sy=6+Math.random()*10;
        addGeo(new THREE.PlaneGeometry(9,2.2).translate(px,sy,pz+d/2+.05),red?signRed:signWhite);
        neonPts.push(px,sy,pz+d/2+.6);neonCol.push(...(red?[1,.12,.18]:[.85,.85,.85]));
      }
    }
  }
  // gatelys i kryssene
  const pole=new THREE.MeshLambertMaterial({color:0x222222});
  roads.forEach(x=>roads.forEach(z=>{addGeo(new THREE.BoxGeometry(.3,9,.3).translate(x+9,4.5,z+9),pole);lampPts.push(x+9,9.2,z+9)}));
  for(const [m,e] of merge){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(e.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(e.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(e.u,2));
    g.setIndex(e.i);g.computeBoundingSphere();scene.add(new THREE.Mesh(g,m));
  }
  // lys som punkter: én draw call for alle gatelys og én for all neon
  const glowPoints=(arr,col,size,color,opacity)=>{
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
    if(col)g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    const p=new THREE.Points(g,new THREE.PointsMaterial({map:G.glow,size,color,vertexColors:!!col,transparent:true,opacity,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true}));
    scene.add(p);return p;
  };
  glowPoints(lampPts,null,18,0xffc88a,1);
  if(neonPts.length)glowPoints(neonPts,neonCol,26,0xffffff,.6);
  // traffic
  const cols=[0xf2f2f2,0x111113,0xd4111c,0x8a8f96,0xf2f2f2,0x111113,0x2a2a2e,0xb51019];
  const kinds=['sedan','sport','suv','ev','super','coupe','muscle','sedan'];
  const cars=[];
  function addCar(axis,road,dir,speed,kind,color,along,lite){
    const g=makeCar(color,kind,{glow:true,lite});
    const c={g,axis,road,dir,speed,along:along??(Math.random()*2-1)*L,lane:dir*3.6};
    g.rotation.y=axis==='x'?(dir>0?0:Math.PI):(dir>0?-Math.PI/2:Math.PI/2);
    scene.add(g);cars.push(c);return c;
  }
  const hero=addCar('x',roads[5],1,26,'sport',0xd4111c,-L*.6);
  const police=addCar('x',roads[4],1,48,'police',0xf4f4f4,-L*.9);
  for(let n=0;n<36;n++){const ax=Math.random()<.5?'x':'z';addCar(ax,roads[Math.floor(Math.random()*roads.length)],Math.random()<.5?1:-1,16+Math.random()*20,kinds[n%kinds.length],cols[n%cols.length],undefined,true)}
  const gateCar=addCar('z',roads[5],-1,22,'sedan',0xf2f2f2,L*.3);
  function update(dt,t){
    cars.forEach(c=>{
      c.along+=c.speed*c.dir*dt;
      if(c.along>L)c.along=-L;if(c.along<-L)c.along=L;
      if(c.axis==='x')c.g.position.set(c.along,0,c.road+c.lane);else c.g.position.set(c.road-c.lane,0,c.along);
    });
    const f=Math.floor(t*6)%2;
    if(police.g.userData.flash){police.g.userData.flash[0].visible=!!f;police.g.userData.flash[1].visible=!f}
    const bl=(Math.sin(t*3)>0);blinkers.forEach(b=>b.visible=bl);
  }
  // dagslys: brukes av klippet «Dagtid i byen»
  const nightBg=scene.background;
  const dayBg=canvasTex(512,256,(g,w,h)=>{const r=g.createLinearGradient(0,0,0,h);r.addColorStop(0,'#3d7cd0');r.addColorStop(.62,'#9fc5ea');r.addColorStop(1,'#dbe7f0');g.fillStyle=r;g.fillRect(0,0,w,h);
    for(let n=0;n<16;n++){const cx=Math.random()*w,cy=20+Math.random()*h*.45,s=10+Math.random()*22;g.fillStyle='rgba(255,255,255,.85)';for(let k=0;k<7;k++){g.beginPath();g.arc(cx+(k-3)*s*.7,cy+Math.sin(k*1.7)*s*.35,s*(.6+Math.random()*.5),0,Math.PI*2);g.fill()}}});
  const glows=[];scene.traverse(o=>{if(o.isSprite||o.isPoints||(o.material&&o.material.map===G.beam))glows.push(o)});
  let isDay=false;
  function setDay(on){
    if(on===isDay)return;isDay=on;
    scene.background=on?dayBg:nightBg;scene.fog.color.setHex(on?0xc9d8e6:FOG);scene.fog.density=on?.0022:.0036;
    amb.color.setHex(on?0xffffff:0x3c2a2c);amb.intensity=on?.7:1.0;
    hemi.color.setHex(on?0xd2e6ff:0x8a2a30);hemi.groundColor.setHex(on?0x7a6a58:0x050505);hemi.intensity=on?.75:.55;
    moon.color.setHex(on?0xfff1d8:0xbfc8ff);moon.intensity=on?.95:.35;
    winMats.forEach(m=>{m.color.setHex(on?0xffffff:0x2a2828);m.emissiveIntensity=on?0:.95});
    roofMat.color.setHex(on?0x7d766e:0x151314);walk.color.setHex(on?0xb6afa5:0x1d1a1b);ground.material.color.setHex(on?0x57534f:0x0f0d0e);
    dashMat.color.setHex(on?0x8a857c:0xbdb3a6);
    glows.forEach(o=>{if(on){o.userData.v=o.visible;o.visible=false}else o.visible=o.userData.v!==undefined?o.userData.v:true});
  }
  update(0,0);
  return {scene,update,setDay,hero,police,gateCar,roads,S,L};
}

function fwd(c){return c.axis==='x'?new THREE.Vector3(c.dir,0,0):new THREE.Vector3(0,0,c.dir)}
function setCam(k,cam,t,city,mx=0,my=0){
  const v=new THREE.Vector3();
  if(k==='hero'){const a=.6+t*.025+mx*.25,r=235;cam.position.set(Math.cos(a)*r,92-my*30,Math.sin(a)*r);cam.lookAt(0,28,0);return}
  if(k==='dag'){const c=city.hero,p=c.g.position,f=fwd(c);cam.position.copy(p).addScaledVector(f,-30);cam.position.y=10+Math.sin(t*.4)*.6;v.copy(p).addScaledVector(f,45);v.y=1;cam.lookAt(v);return}
  if(k==='natt'||k==='utrykning'){
    const c=k==='natt'?city.hero:city.police,p=c.g.position,f=fwd(c),side=new THREE.Vector3(-f.z,0,f.x);
    const back=k==='natt'?15:10,up=k==='natt'?5.5:2.8,s=k==='natt'?2.5:-3.2;
    cam.position.copy(p).addScaledVector(f,-back).addScaledVector(side,s);cam.position.y=up+Math.sin(t*1.3)*.2;
    v.copy(p).addScaledVector(f,28);v.y=k==='natt'?2.5:2;cam.lookAt(v);return}
  if(k==='ovenfra'){const a=t*.06+1.2;cam.position.set(Math.cos(a)*140,250,Math.sin(a)*140);cam.lookAt(0,0,0);return}
  if(k==='gate'){const x=city.roads[5];cam.position.set(x+4.5,3.2,-40+Math.sin(t*.25)*6);cam.lookAt(x-2,5,90);return}
}

function initGL(){
  if(!G.ok){G.cine={r:null,clip:0,elapsed:0,playing:!REDUCE};return}
  G.glow=makeGlow();
  G.beam=canvasTex(64,16,(g)=>{const r=g.createLinearGradient(0,0,64,0);r.addColorStop(0,'rgba(255,255,255,.9)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,16)});
  G.city=buildCity();
  const mk=(cv,alpha)=>{try{const r=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:!!alpha});r.setPixelRatio(Math.min(devicePixelRatio||1,1.25));return r}catch(e){return null}};
  G.hero={r:null,cam:null,vis:false,mx:0,my:0,tx:0,ty:0};
  G.cine={r:null,cam:null,vis:false,clip:0,start:0,playing:!REDUCE,elapsed:0};
  G.show={r:null,vis:false};
  if(!G.cine.r)G.cine.r=null;
  initShow();
  setTimeout(makeStills,500);
  resizeGL();addEventListener('resize',resizeGL);
  const io=new IntersectionObserver(es=>es.forEach(e=>{const k=e.target.dataset.gl;if(G[k])G[k].vis=e.isIntersecting}),{threshold:0});
  $('#hero').dataset.gl='hero';$('#screen').dataset.gl='cine';
  io.observe($('#hero'));io.observe($('#screen'));
  $('#hero').addEventListener('pointermove',e=>{const b=e.currentTarget.getBoundingClientRect();G.hero.tx=(e.clientX-b.left)/b.width-.5;G.hero.ty=(e.clientY-b.top)/b.height-.5});
  let last=performance.now(),acc=0,slow=0,pr=Math.min(devicePixelRatio||1,1.25);
  const frame=(now)=>{
    const raw=(now-last)/1000;last=now;acc+=Math.min(.1,raw);
    const home=!$('#home').hidden;
    if(home&&!document.hidden&&G.show.vis&&acc>=1/31){
      const dt=Math.min(acc,.1);acc=0;
      G.t+=dt;G.city.update(dt,G.t);
      if(G.hero.vis&&G.hero.r){const h=G.hero;h.mx+=(h.tx-h.mx)*.08;h.my+=(h.ty-h.my)*.08;setCam('hero',h.cam,G.t,G.city,h.mx,h.my);h.r.render(G.city.scene,h.cam)}
      if(G.show.vis&&G.show.r)showFrame(dt);
      // senk oppløsningen litt hvis maskinen ikke klarer å følge med
      slow=raw>.045?slow+1:Math.max(0,slow-1);
      if(slow>30&&pr>.6){pr=Math.max(.6,pr-.2);slow=0;[G.hero.r,G.show.r].forEach(r=>r&&r.setPixelRatio(pr));resizeGL()}
    }
    if(!REDUCE)requestAnimationFrame(frame);
  };
  if(REDUCE){cineFrame(0);G.show.r&&showFrame(0)}
  else requestAnimationFrame(frame);
}
function resizeGL(){
  [['hero','#heroCv'],['cine','#cineCv'],['show','#showCv']].forEach(([k,s])=>{
    const o=G[k];if(!o||!o.r)return;const cv=$(s),w=cv.clientWidth,h=cv.clientHeight;if(!w||!h)return;
    o.r.setSize(w,h,false);const cam=o.cam;if(cam){cam.aspect=w/h;cam.updateProjectionMatrix()}
  });
  if(REDUCE&&G.ok){cineFrame(0);G.show.r&&showFrame(0)}
}
function makeStills(){
  const need=[...document.querySelectorAll('img[data-still]')].some(i=>!i.dataset.realOk);if(!need)return;
  let r;try{const cv=document.createElement('canvas');r=new THREE.WebGLRenderer({canvas:cv,antialias:true,preserveDrawingBuffer:true});r.setPixelRatio(1);r.setSize(1280,800,false)}catch(e){return}
  const cam=new THREE.PerspectiveCamera(46,1280/800,.5,2400);
  const shots=[['gate',3],['utrykning',6],['ovenfra',2],['natt',9]];
  shots.forEach(([k,adv])=>{
    for(let i=0;i<adv*10;i++){G.t+=.1;G.city.update(.1,G.t)}
    setCam(k,cam,G.t,G.city);r.render(G.city.scene,cam);
    const url=r.domElement.toDataURL('image/jpeg',.86);
    document.querySelectorAll(`img[data-still="${k}"]`).forEach(i=>{if(!i.dataset.realOk)i.src=url});
  });
  r.dispose();r.forceContextLoss&&r.forceContextLoss();
}

/* ---- cinema ---- */
function renderClips(){
  if(!$('#clips'))return;
  $('#clips').innerHTML=CLIPS.map((c,i)=>`<button class="clip ${i===G.cine?.clip?'on':''}" data-clip="${i}"><b>${c.t}</b><small>${c.s}</small><span class="prog"><i id="prog${i}"></i></span></button>`).join('');
}
function setClip(i){
  const c=G.cine;if(!c)return;c.clip=i;c.elapsed=0;
  $('#cineTitle').textContent=CLIPS[i].t;$('#cineSub').textContent=CLIPS[i].s;
  document.querySelectorAll('.clip').forEach((b,j)=>b.classList.toggle('on',j===i));
  document.querySelectorAll('.clip .prog i').forEach((p,j)=>p.style.width=j<i?'100%':'0');
  const v=$('#cineVideo');c.vidOn=false;v.hidden=true;v.pause();$('#screen').classList.remove('vid');
  if(CLIPS[i].video){v.dataset.want=CLIPS[i].video;v.src=CLIPS[i].video;v.load()}else{v.removeAttribute('src');v.dataset.want=''}
  if(REDUCE)cineFrame(0);
}
function nextClip(){setClip((G.cine.clip+1)%CLIPS.length);document.querySelectorAll('.clip .prog i').forEach(p=>p.style.width='0')}
function bindCineVideo(){
  const v=$('#cineVideo');if(!v||v._bound)return;v._bound=1;
  v.addEventListener('loadeddata',()=>{const c=G.cine;if(!c||v.dataset.want!==CLIPS[c.clip].video)return;c.vidOn=true;v.hidden=false;$('#screen').classList.add('vid');if(c.playing)v.play().catch(()=>{})});
  v.addEventListener('error',()=>{if(G.cine)G.cine.vidOn=false;v.hidden=true;$('#screen').classList.remove('vid')});
  v.addEventListener('ended',()=>{if(G.cine&&G.cine.playing)nextClip()});
}
function cineFrame(dt){
  const c=G.cine;if(!c||!c.r)return;
  const v=$('#cineVideo');
  if(c.playing&&!c.vidOn){c.elapsed+=dt;if(c.elapsed>CLIP_LEN){nextClip();return}}
  const p=$('#prog'+c.clip);
  if(p)p.style.width=Math.min(100,(c.vidOn&&v.duration?v.currentTime/v.duration:c.elapsed/CLIP_LEN)*100)+'%';
  if(c.vidOn)return;
  const day=!!CLIPS[c.clip].day;
  if(day)G.city.setDay(true);
  setCam(CLIPS[c.clip].k,c.cam,G.t,G.city);c.r.render(G.city.scene,c.cam);
  if(day)G.city.setDay(false);
}

/* ---- showroom ---- */
function initShow(){
  const S=G.show;if(!S.r)return;
  S.scene=new THREE.Scene();
  S.cam=new THREE.PerspectiveCamera(32,1.45,.1,100);S.cam.position.set(9.5,3.4,9.5);S.cam.lookAt(0,.9,0);
  S.scene.add(new THREE.AmbientLight(0x6a5a5c,.7));
  const key=new THREE.DirectionalLight(0xffffff,.9);key.position.set(5,10,6);S.scene.add(key);
  const rim=new THREE.PointLight(0xff2030,2.2,30);rim.position.set(-6,3,-5);S.scene.add(rim);
  const fill=new THREE.PointLight(0xffffff,.8,30);fill.position.set(6,2,-6);S.scene.add(fill);
  const disk=new THREE.Mesh(new THREE.CylinderGeometry(5.6,5.8,.25,64),new THREE.MeshPhongMaterial({color:0x161213,shininess:120,specular:0x444444}));disk.position.y=-.12;S.scene.add(disk);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(5.75,.06,8,96),new THREE.MeshBasicMaterial({color:0xff1a28}));ring.rotation.x=Math.PI/2;ring.position.y=.02;S.scene.add(ring);
  const halo=new THREE.Mesh(new THREE.RingGeometry(5.8,8,64),new THREE.MeshBasicMaterial({color:0xff1a28,transparent:true,opacity:.12,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.position.y=-.2;S.scene.add(halo);
  S.pivot=new THREE.Group();S.scene.add(S.pivot);S.rot=.6;S.vel=0;S.drag=false;
  const st=$('#stage');let lx=0;
  st.addEventListener('pointerdown',e=>{S.drag=true;lx=e.clientX;st.setPointerCapture(e.pointerId)});
  st.addEventListener('pointermove',e=>{if(!S.drag)return;const d=(e.clientX-lx)*.01;lx=e.clientX;S.rot+=d;S.vel=d;if(REDUCE)showFrame(0)});
  ['pointerup','pointercancel'].forEach(n=>st.addEventListener(n,()=>S.drag=false));
  setCar(0);
}
let curCar=0;
function setCar(i){
  const c=CARS[i];curCar=i;
  document.querySelectorAll('.carbtn').forEach((b,j)=>b.classList.toggle('on',j===i));
  $('#specs').innerHTML=[['Pris',c.pris],['Toppfart',c.topp],['Effekt',c.hk],['0–100',c.acc]].map(s=>`<div><span>${s[0]}</span><b>${s[1]}</b></div>`).join('');
  $('#plate').textContent=c.plate;
  const st=$('#stage'),ph=$('#stagePhoto');st.classList.remove('has-photo');ph.hidden=true;
  if(c.bilde){const t=new Image();t.onload=()=>{if(curCar!==i)return;ph.src=c.bilde;ph.alt=c.n;ph.hidden=false;st.classList.add('has-photo')};t.src=c.bilde}
  const S=G.show;if(!S||!S.pivot)return;
  S.pivot.clear();const car=makeCar(c.color,c.kind,{show:true});car.scale.setScalar(1.22);S.pivot.add(car);
  if(REDUCE)showFrame(0);
}
function showFrame(dt){
  const S=G.show;if(!S.scene)return;
  if(!S.drag){S.vel*=.95;S.rot+=S.vel+(REDUCE?0:dt*.35)}
  S.pivot.rotation.y=S.rot;S.r.render(S.scene,S.cam);
}

/* ---- tilt ---- */
function bindTilt(root){
  if(REDUCE||!matchMedia('(hover:hover)').matches)return;
  root.querySelectorAll('[data-tilt]').forEach(el=>{
    const t=el.querySelector('.frame,.in');if(!t||el._tilt)return;el._tilt=1;
    el.addEventListener('pointermove',e=>{const b=el.getBoundingClientRect(),x=(e.clientX-b.left)/b.width-.5,y=(e.clientY-b.top)/b.height-.5;t.style.transform=`rotateY(${x*12}deg) rotateX(${-y*10}deg) translateZ(0)`});
    el.addEventListener('pointerleave',()=>t.style.transform='');
  });
}

function phead(t,p,eb){return `<section class="phead"><div class="wrap"><div class="eyebrow">${eb}</div><h1>${t}</h1>${p?`<p>${p}</p>`:''}</div></section>`}
function bizCard(b){return `<div class="bcard" data-tilt><div class="in"><div class="mark">${b[0]}</div><h3>${b[1]}</h3><p>${b[3]}</p><div class="foot"><span>${b[2]}</span><span class="pill ${b[4]}">${b[4]==='ansetter'?'Ansetter':'Fullt'}</span></div>${b[5]?`<button class="btn sm" data-new="${b[5]}">Søk stilling</button>`:''}</div></div>`}

function vConnect(){
  return phead('Koble til','Tre steg fra skrivebordet til byen. Du må ha godkjent whitelist for å komme inn.','Kom i gang')+`
  <div class="wrap page"><div class="howto">
    <div class="card"><span class="mono red">Steg 1</span><h3>Installer FiveM</h3><p class="muted">Last ned FiveM fra fivem.net og logg inn med Cfx.re-kontoen din. Du trenger en lovlig kopi av GTA V.</p><div style="margin-top:16px"><a class="btn sm" href="https://fivem.net" target="_blank" rel="noopener">Åpne fivem.net</a></div></div>
    <div class="card"><span class="mono red">Steg 2</span><h3>Bli whitelistet</h3><p class="muted">Send whitelist-søknad i spillerpanelet. Du får svar der, som regel innen 48 timer.</p><div style="margin-top:16px"><a class="btn sm red" href="#whitelist">Søk whitelist</a></div></div>
    <div class="card"><span class="mono red">Steg 3</span><h3>Koble til</h3><p class="muted">Start FiveM, trykk <span class="kbd">F8</span> og lim inn kommandoen under.</p><div style="margin-top:16px"><button class="copy" style="background:var(--ink)" data-copy="connect ${esc(CFG.connect)}">connect ${esc(CFG.connect)} <span>Kopier</span></button></div></div>
  </div>
  <div class="notice" style="margin-top:28px"><span>Får du ikke koblet til? Sjekk at whitelisten er godkjent under Mine søknader, eller opprett en ticket.</span><a class="btn sm" href="#tickets">Opprett ticket</a></div></div>`;
}
function vRules(){
  const P=[
    ['Historien først','Spill for å lage gode øyeblikk, ikke for å vinne. Et tap kan være starten på en bedre historie.'],
    ['Gi motparten en sjanse','Den andre siden skal alltid kunne svare, reagere og påvirke hvordan det ender.'],
    ['Bruk skjønn','Ikke alt står skrevet. Spør deg selv om det du gjør gjør byen bedre for andre.']
  ];
  const R=[
    {t:'Respekt og miljø',i:'Novex skal være et sted folk vil komme tilbake til.',r:[
      ['Folkeskikk','Vi har nulltoleranse for rasisme, hets, trakassering og personangrep. Det gjelder i spillet, på Discord og i tickets.'],
      ['Tabutemaer','Seksuelle overgrep, selvskading og terror brukes ikke i RP på Novex. Heller ikke som spøk, trussel eller del av en bakgrunnshistorie.'],
      ['Konflikter blir i byen','Det som skjer mellom karakterer, skal ikke bli en personlig konflikt mellom spillerne.'],
      ['Alder','Spillere må være minst 16 år. Alle karakterer skal være myndige.']]},
    {t:'I karakter og utenfor',i:'Du og karakteren din er to forskjellige personer.',r:[
      ['Det karakteren vet','Karakteren vet bare det den selv har sett, hørt eller fått vite i byen.'],
      ['Metagaming','Informasjon fra Discord, streamer, klipp eller private meldinger skal aldri brukes i spillet.'],
      ['Masker','En maskert person kan ikke gjenkjennes bare på stemmen eller klærne uten at det er bygget opp i RP.'],
      ['Flere karakterer','Karakterene dine deler ikke kunnskap, penger, kjøretøy eller eiendeler.']]},
    {t:'Realistisk spill',i:'Spill som om det var på ekte, med de begrensningene det gir.',r:[
      ['FailRP','Handlinger som ikke kunne skjedd i virkeligheten, er ikke lov. Du hopper ikke ned fra et tak og løper videre.'],
      ['Skader','Spill på skadene dine til du har fått behandling.'],
      ['Ikke stopp scenarioet','Fullfør situasjonen selv om du mener noen bryter reglene. Ta det i en ticket etterpå.'],
      ['Powergaming','Du bestemmer ikke hva som skjer med andre, og du bruker ikke /me til å tvinge fram et resultat.']]},
    {t:'Liv og vold',i:'Vold er tungt og skal ha en grunn.',r:[
      ['Verdsett livet','Blir du truet med våpen, oppfører du deg som en som er redd for å dø. Ingen karakter er udødelig.'],
      ['RDM','Du kan ikke skade eller drepe noen uten forhistorie, dialog og en grunn som henger sammen.'],
      ['VDM','Kjøretøy er ikke våpen. Å kjøre på folk med vilje er ikke lov uten et svært godt RP-grunnlag.'],
      ['Ny start','Dør karakteren og våkner på sykehuset uten å ha blitt behandlet på stedet, husker den ikke hva som skjedde. Du drar ikke tilbake til stedet på 20 minutter.'],
      ['Ute av situasjonen','Blir du lagt ned i en skuddveksling, er du ferdig med den situasjonen. Du kommer ikke tilbake med nytt utstyr.'],
      ['Utlogging','Ikke logg ut for å slippe unna ran, arrestasjon eller konsekvenser. Krasjer du, kommer du tilbake så fort du kan eller gir beskjed i en ticket.']]},
    {t:'Kriminalitet',i:'Krim skal gi spenning for begge sider, ikke bare fortjeneste.',r:[
      ['Hvem du raner','Nye spillere og tilfeldige forbipasserende er ikke mål uten oppbygging. Du kan ikke kreve at noen tømmer bankkontoen.'],
      ['Før restart','Ingen nye kriminelle scenarioer de siste 20 minuttene før en planlagt restart. Det som allerede er i gang, kan fullføres.'],
      ['Antall','Uten godkjenning fra staff kan maks 5 kriminelle og 6 tjenestepersoner delta i samme scenario. Sjåfører og speidere teller med.'],
      ['Gisler','En gissel kan holdes i maks 90 minutter. Lengre scenarioer må godkjennes i en ticket på forhånd.'],
      ['Utrykningskjøretøy','Politibiler og ambulanser stjeles bare når scenarioet gir en tydelig grunn, ikke fordi du trenger skyss.'],
      ['Store scenarioer','Angrep på politistasjonen, bevisrommet eller lignende krever en godkjent ticket med plan og deltakere.']]},
    {t:'Cooldown etter ran',i:'Etter et ran får alle som deltok en felles cooldown på alle typer ran.',cool:true,r:[
      ['Felles for alle ran','Du kan ikke bytte til en annen type ran for å komme unna cooldownen. Den lengste cooldownen du har, gjelder.'],
      ['Hvem som får den','Alle som planla, deltok, kjørte, speidet eller hjalp til etterpå, får samme cooldown.']]},
    {t:'Jobber og utstyr',i:'Det du får på jobb, tilhører jobben.',r:[
      ['Tjenesteutstyr','Våpen, radio, håndjern, medisinsk utstyr og uniformer brukes bare i tjeneste.'],
      ['Ikke del ut','Tjenesteutstyr selges ikke, gis ikke bort og flyttes ikke til andre karakterer.'],
      ['Tjenestekjøretøy','Politibiler, ambulanser og firmabiler brukes bare mens du er på jobb.']]},
    {t:'Trygge soner',i:'Noen steder i byen skal alltid være trygge.',r:[
      ['Hvor','Sykehuset, politistasjonen og garasjene i sentrum er trygge soner.'],
      ['Hva som gjelder','Ingen ran, vold, trusler eller kidnapping i trygge soner. Du kan heller ikke løpe inn i en for å slippe unna et scenario.']]},
    {t:'Gjenger',i:'En gjeng finnes for å lage RP, ikke bare for å samle våpen og penger.',r:[
      ['Godkjenning','Gjenger må godkjennes gjennom gjengsøknad i spillerpanelet.'],
      ['Størrelse','En ny gjeng kan ha maks 12 medlemmer. Staff kan utvide grensen senere.'],
      ['Identitet','Gjengen skal ha navn, roller, interne regler og en historie.'],
      ['Konflikter','Krig mellom gjenger krever forhistorie, som trusler, mislykkede forhandlinger eller strid om område. Etter en avsluttet konflikt starter dere ikke ny på samme grunnlag.'],
      ['Felles ansvar','Bryter gjengen reglene gjentatte ganger, kan staff reagere mot hele gruppen.']]},
    {t:'Juks og feil',i:'Alle spiller på like vilkår.',r:[
      ['Bugs','Feil i spillet meldes i en ticket. Å utnytte dem til penger eller gjenstander gir utestengelse.'],
      ['Programmer','Modmenyer, makroer og grafikkinnstillinger som fjerner busker, røyk eller mørke er ikke lov.']]},
    {t:'Support og reaksjoner',i:'Staff passer på at byen fungerer for alle.',r:[
      ['Melde en sak','Fullfør scenarioet, ta vare på klipp hvis du har det, og opprett en ticket med hva som skjedde.'],
      ['Ærlighet','Vær ærlig og saklig mot staff. Å lyve i en sak gir strengere reaksjon.'],
      ['Reaksjoner','Staff kan gi veiledning, advarsel, kick, midlertidig eller permanent utestengelse, eller fjerne penger, kjøretøy og eiendeler.'],
      ['Skjønn','Staff kan reagere på oppførsel som skader RP for andre, selv om den ikke står ordrett i regelverket.']]}
  ];
  const COOL=[['Butikkran','2 timer'],['Minibank','3 timer'],['Verditransport','24 timer'],['Smykkebutikk','48 timer'],['Bankfilial','48 timer'],['Hovedbanken','4 dager']];
  return phead('Regelverket','Alle spillere må kjenne reglene. Brudd kan føre til advarsel, utestengelse eller fjernet whitelist. Sist oppdatert 9. nov. 2026.','Regler')+`
  <div class="wrap page">
    <div class="principles">${P.map(p=>`<div class="princ"><h3>${p[0]}</h3><p>${p[1]}</p></div>`).join('')}</div>
    <div class="rules" style="margin-top:56px">
    <nav>${R.map((s,i)=>`<a href="#regler" data-jump="r${i}">§${i+1} ${s.t}</a>`).join('')}</nav>
    <div>${R.map((s,i)=>`<div class="rsec" id="r${i}"><h2>§${i+1} ${s.t}</h2><p class="rintro">${s.i}</p>
      ${s.cool?`<div class="tbl" style="margin:0 0 18px"><table class="cool"><thead><tr><th>Type ran</th><th>Cooldown</th></tr></thead><tbody>${COOL.map(c=>`<tr><td>${c[0]}</td><td class="mono">${c[1]}</td></tr>`).join('')}</tbody></table></div>`:''}
      ${s.r.map((r,j)=>`<div class="rule"><span class="p">${i+1}.${j+1}</span><div><b>${r[0]}</b><span>${r[1]}</span></div></div>`).join('')}</div>`).join('')}</div>
  </div></div>`;
}
function vBiz(){
  return phead('Bedrifter og etater','Alle bedrifter drives av spillere. Vil du jobbe et sted, søker du stilling. Vil du starte noe eget, sender du en bedriftssøknad.','Byen')+`
  <div class="wrap page"><div class="row"><a class="btn red" href="#stillinger">Se ledige stillinger</a><button class="btn" data-new="bedrift">Søk om egen bedrift</button></div>
  <div class="bgrid">${BIZ.map(bizCard).join('')}</div></div>`;
}


/* =========================================================
   STATE + API
   ========================================================= */
const {FORMS,JOBS,CATS,validate,PERMS,PERM_KEYS,PRESETS,appPerm}=window.NOVEX_FORMS;
const can=p=>!!(ST.user&&ST.user.perms&&ST.user.perms.includes(p));
const PLABEL=Object.fromEntries(PERMS.map(p=>[p.k,p.label]));
const STATUS={utkast:'Utkast',sendt:'Til behandling',godkjent:'Godkjent',avslatt:'Avslått'};
const TSTATUS={apen:'Venter på staff',besvart:'Besvart',lukket:'Lukket'};
const CFG={connect:'play.novexrp.no',invite:'',trailer:'',loginEnabled:true};
const ST={ready:false,user:null,apps:[],tickets:[]};
const V={cur:null,ticket:null,ticketData:null,ticketFrom:'tickets',ticketLoading:false,tab:'alle',errors:{},newT:false,staff:null,staffLoading:false,staffTab:'venter',staffT:'apen',tSort:'nyeste',tQ:'',myT:'alle',mySort:'nyeste',myQ:'',team:null,teamLoading:false,tEdit:null,tFound:null};
const tno=id=>1000+Number(id);
const app=$('#app');
const PANEL=['panel','soknader','whitelist','stillinger','tickets','soknad','ticket','staff','team'];
let route='hjem';

async function api(method,url,body){
  const opt={method,headers:{'X-Novex':'1'},credentials:'same-origin'};
  if(body!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
  let r;
  try{r=await fetch(url,opt)}catch(e){throw {status:0,error:'Får ikke kontakt med serveren. Sjekk nettet og prøv igjen.'}}
  let data={};try{data=await r.json()}catch(e){}
  if(!r.ok){
    if(r.status===401&&ST.user){ST.user=null;render(true)}
    throw Object.assign({status:r.status,error:data.error||'Noe gikk galt. Prøv igjen.'},data);
  }
  return data;
}
const errToast=e=>toast((e&&e.error)||'Noe gikk galt. Prøv igjen.');

async function loadMe(){
  try{
    const [c,m]=await Promise.all([api('GET','/api/config'),api('GET','/api/me')]);
    Object.assign(CFG,c);ST.user=m.user;applyConfig();
    if(ST.user)await Promise.all([loadApps(),loadTickets()]);
  }catch(e){ST.loadError=e.error;setupHeroVideo()}
  ST.ready=true;refresh(true);
}
async function loadApps(){ST.apps=(await api('GET','/api/apps')).apps}
async function loadTickets(){ST.tickets=(await api('GET','/api/tickets')).tickets}
async function loadStatus(){
  const el=$('#live');
  try{
    const s=await api('GET','/api/status');
    if(s.online===null){el.hidden=true;return}
    el.hidden=false;el.classList.toggle('off',!s.online);
    el.innerHTML=s.online?`<i></i>LIVE <span class="mono">${s.players}</span>/${s.max||'–'}`:'<i></i>OFFLINE';
  }catch(e){}
}
function applyConfig(){
  const cmd='connect '+CFG.connect;
  document.querySelectorAll('[data-copy]').forEach(b=>{b.dataset.copy=cmd;if(b.firstChild&&b.firstChild.nodeType===3)b.firstChild.textContent=cmd+' '});
  $('#fConnect').textContent=cmd;
  setupHeroVideo();
  $('#wmSub').textContent=CFG.invite?CFG.invite.replace(/^https?:\/\//,''):cmd;
  const d=$('#discordLink');if(CFG.invite)d.href=CFG.invite;else d.hidden=true;
  if(CFG.trailer&&/^[\w-]{6,20}$/.test(CFG.trailer)){
    const t=$('#trailer');t.hidden=false;
    t.innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${CFG.trailer}?rel=0" title="Novex RP trailer" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`;
  }
}
const findApp=id=>ST.apps.find(a=>a.id===Number(id));
const activeWL=()=>ST.apps.find(a=>a.form==='whitelist'&&(a.status==='utkast'||a.status==='sendt'));
const approvedWL=()=>!!(ST.user&&ST.user.whitelisted);
function replaceApp(a){const i=ST.apps.findIndex(x=>x.id===a.id);if(i>=0)ST.apps[i]=a;else ST.apps.unshift(a)}

/* =========================================================
   ROUTER
   ========================================================= */
function typing(){const a=document.activeElement;return a&&app.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)}
function refresh(force){updateNav();if(!PANEL.includes(route))return;if(!force&&typing())return;render(true)}
function updateNav(){$('#panelBtn').textContent=ST.user?ST.user.name:'Logg inn'}
function render(keepScroll){
  route=(location.hash||'#hjem').slice(1)||'hjem';
  document.querySelectorAll('#links a').forEach(a=>a.classList.toggle('on',a.dataset.r===route));
  $('#links').classList.remove('open');$('#menuBtn').setAttribute('aria-expanded','false');
  updateNav();
  const home=!['koble-til','regler','bedrifter',...PANEL].includes(route);
  $('#home').hidden=!home;app.hidden=home;
  if(home){if(G.ok)requestAnimationFrame(resizeGL);return}
  let html;
  if(route==='koble-til')html=vConnect();
  else if(route==='regler')html=vRules();
  else if(route==='bedrifter')html=vBiz();
  else html=vPanel();
  app.innerHTML=html;bindTilt(app);
  if(!keepScroll)scrollTo(0,0);
  if(ST.user){
    if(route==='staff'&&ST.user.isStaff&&!V.staff)loadStaff();
    if(route==='team'&&can('staff.manage')&&!V.team)loadTeam();
    if(route==='ticket'&&V.ticket&&(!V.ticketData||V.ticketData.ticket.id!==V.ticket))loadTicket();
  }
}
const loading=t=>`<div class="loading">${t}</div>`;

/* =========================================================
   PANEL VIEWS
   ========================================================= */
const LOGIN_ERR={oppsett:'Discord-innlogging er ikke satt opp på serveren ennå.',avbrutt:'Innloggingen ble avbrutt. Prøv igjen.',state:'Innloggingen tok for lang tid. Prøv igjen.',discord:'Discord svarte ikke. Prøv igjen om litt.',medlem:'Du må være med i Discord-serveren vår for å logge inn.'};
function vLogin(){
  const msg=LOGIN_ERR[new URLSearchParams(location.search).get('feil')];
  return phead('Spillerpanel','Logg inn med Discord for å søke whitelist, jobb og sende tickets til staff.','Logg inn')+`
  <div class="wrap page"><div class="reg"><div class="card">
    <h3>Logg inn</h3>
    ${msg?`<div class="reply bad"><p>${msg}</p></div>`:''}
    ${ST.loadError?`<div class="reply bad"><p>${esc(ST.loadError)}</p></div>`:''}
    <p class="muted">Vi bruker Discord-kontoen din til å kjenne deg igjen. Vi lagrer brukernavnet, avataren og Discord-ID-en din.</p>
    ${CFG.loginEnabled?`<a class="btn discord" href="/auth/discord">Logg inn med Discord</a>`:`<div class="notice"><span>Discord-innlogging er ikke satt opp ennå. Eieren må legge inn Discord-nøklene i .env.</span></div>`}
  </div></div></div>`;
}
function avatar(u,cls=''){return `<div class="av ${cls}"><img src="${esc(u.avatarUrl)}" alt=""></div>`}
function vPanel(){
  if(!ST.ready)return `<div class="wrap page">${loading('Kobler til spillerpanelet …')}</div>`;
  if(!ST.user)return vLogin();
  const u=ST.user,openT=ST.tickets.filter(t=>t.status!=='lukket').length;
  const nav=[['panel','Oversikt'],['soknader','Mine søknader',ST.apps.length],['whitelist','Whitelist'],['stillinger','Stillinger'],['tickets','Tickets',openT]];
  if(u.isStaff)nav.push(['staff','Staff',V.staff&&V.staff.overview?V.staff.overview.pending:0]);
  if(can('staff.manage'))nav.push(['team','Staff-team']);
  const act=route==='soknad'?'soknader':route==='ticket'?V.ticketFrom:route;
  const views={panel:pOverview,soknader:pApps,whitelist:pWhitelist,stillinger:pJobs,tickets:pTickets,soknad:pForm,ticket:pTicket,staff:()=>u.isStaff?pStaff():pOverview(),team:()=>can('staff.manage')?pTeam():pOverview()};
  return `<div class="wrap panel">
    <aside class="side">
      <div class="who">${avatar(u)}<div><b>${esc(u.name)}</b><small>${u.isStaff?esc(u.staffTitle||'Staff'):'Spillerpanel'}</small></div></div>
      ${nav.map(n=>`<a href="#${n[0]}" class="${act===n[0]?'on':''}">${n[1]}${n[2]?`<span class="count">${n[2]}</span>`:''}</a>`).join('')}
      <hr><a href="#hjem" id="logoutBtn">Logg ut</a>
    </aside>
    <main>${(views[route]||pOverview)()}</main></div>`;
}
const pill=s=>`<span class="pill ${s}">${STATUS[s]||s}</span>`;
const tpill=s=>`<span class="pill ${s}">${TSTATUS[s]||s}</span>`;

function pOverview(){
  const u=ST.user,apps=ST.apps;
  const wl=activeWL()||apps.find(a=>a.form==='whitelist');
  let wlCard;
  if(approvedWL())wlCard=`<div class="row"><span class="pill godkjent">Whitelistet</span><span class="muted">Koble til med <span class="mono">connect ${esc(CFG.connect)}</span></span></div><div><a class="btn sm" href="#koble-til">Slik kobler du til</a></div>`;
  else if(wl)wlCard=`<div class="row">${pill(wl.status)}<button class="btn sm" data-open="${wl.id}">${wl.status==='utkast'?'Fortsett søknaden':'Se søknaden'}</button></div>${wl.reply?`<div class="reply ${wl.status==='godkjent'?'ok':'bad'}"><b>Svar fra staff</b><p>${esc(wl.reply)}</p></div>`:''}`;
  else wlCard=`<p class="muted">Du har ikke søkt whitelist ennå.</p><div><button class="btn red sm" data-new="whitelist">Start søknad</button></div>`;
  return `<div class="stack" style="margin-top:0">
    <div class="card dark profile">${avatar(u,'lg')}
      <div style="flex:1;min-width:0"><h2>${esc(u.name)}</h2>
      <div class="kv"><div><span>Discord-ID</span><b class="mono">${esc(u.id)}</b></div><div><span>Tilgang</span><b>${u.isStaff?esc(u.staffTitle||'Staff'):approvedWL()?'Whitelistet':'Spiller'}</b></div><div><span>Registrert</span><b>${fdate(u.createdAt)}</b></div></div></div></div>
    <div class="card" style="display:grid;gap:14px"><h3>Whitelist</h3>${wlCard}</div>
    <div><h3 style="font-size:34px;margin-bottom:14px">Søknadene dine</h3>${apps.length?`<div class="list">${apps.slice(0,5).map(a=>`<button class="li" data-open="${a.id}"><span class="l"><b>${FORMS[a.form]?FORMS[a.form].title:a.form}</b>${pill(a.status)}</span><small>Opprettet ${fdate(a.createdAt)}</small></button>`).join('')}</div>`:`<p class="muted">Ingen søknader ennå.</p>`}</div>
  </div>`;
}

function pApps(){
  const groups=['alle','Whitelist','Stillinger','Bedrift','Gjeng','Staff'];
  const list=ST.apps.filter(a=>FORMS[a.form]&&(V.tab==='alle'||FORMS[a.form].group===V.tab));
  return `<h1 class="ph">Mine søknader</h1><p class="pintro">Utkast, innsendte søknader og svar fra staff.</p>
    <div class="tabs">${groups.map(g=>`<button data-tab="${g}" class="${V.tab===g?'on':''}">${g==='alle'?'Alle':g}</button>`).join('')}</div>
    ${list.length?`<div class="tbl"><table><thead><tr><th>Søknad</th><th>Status</th><th>Sendt inn</th><th>Svar</th></tr></thead><tbody>
    ${list.map(a=>`<tr data-open="${a.id}"><td><b>${FORMS[a.form].title}</b><small>${FORMS[a.form].group}</small></td><td>${pill(a.status)}</td><td>${a.submittedAt?fdate(a.submittedAt):'Ikke sendt'}</td><td>${a.reply?'Ja':'Ingen'}</td></tr>`).join('')}
    </tbody></table></div>`:`<div class="empty" style="margin-top:22px"><h3>Ingen søknader her</h3><p>Søk whitelist, jobb, bedrift, gjeng eller staff fra Stillinger.</p><a class="btn" href="#stillinger">Gå til stillinger</a></div>`}`;
}

function pWhitelist(){
  const a=activeWL();let box;
  if(approvedWL())box=`<div class="card" style="display:grid;gap:12px"><div class="row"><b>Du er whitelistet.</b><span class="pill godkjent">Godkjent</span></div><p class="muted">Koble til i FiveM med <span class="mono">connect ${esc(CFG.connect)}</span>.</p><div><a class="btn sm" href="#koble-til">Slik kobler du til</a></div></div>`;
  else if(a)box=`<div class="card" style="display:grid;gap:12px"><div class="row"><b>Du har allerede en aktiv whitelist-søknad.</b>${pill(a.status)}</div><p class="muted">Du kan bare ha én aktiv whitelist-søknad om gangen.</p><div><button class="btn red" data-open="${a.id}">${a.status==='utkast'?'Fortsett søknaden':'Se søknaden'}</button></div></div>`;
  else box=`<div class="card" style="display:grid;gap:12px"><b>Klar til å søke?</b><p class="muted">Søknaden har ${FORMS.whitelist.q.length} spørsmål og tar rundt 15 minutter. Svarene lagres som utkast underveis.</p><div><button class="btn red" data-new="whitelist">Start søknad</button></div></div>`;
  return `<h1 class="ph">Whitelist</h1><p class="pintro">Serveren er whitelistet. Søknaden leses av staff, og du får svar her i panelet. Les <a href="#regler">regelverket</a> før du begynner.</p><div class="stack">${box}</div>`;
}

function pJobs(){
  const job=j=>{const f=FORMS[j.k];return `<div class="card job"><div class="spread"><h3>${f.title}</h3><span class="pill ${j.open?'ansetter':'fullt'}">${j.open?'Åpen':'Stengt'}</span></div><p>${j.desc}</p><div class="meta"><span>Sted <b>${j.kind}</b></span><span>Plasser <b>${j.plass}</b></span></div><div><button class="btn sm red" data-new="${j.k}" ${j.open?'':'disabled'}>Søk stilling</button></div></div>`};
  const other=[['bedrift','Bedrift','Start eller overta en bedrift i byen.'],['gjeng','Gjeng','Registrer en kriminell gruppering. Krever 3 eller flere medlemmer.'],['staff','Staff','Bli en del av teamet som holder serveren i gang.']];
  return `<h1 class="ph">Stillinger</h1><p class="pintro">Søk jobb i etater og bedrifter, eller søk om å starte bedrift eller gjeng.</p>
    ${approvedWL()?'':`<div class="notice" style="margin-top:20px"><span>Du må være whitelistet for å sende disse søknadene. Du kan likevel fylle ut utkast nå.</span><a class="btn sm" href="#whitelist">Til whitelist</a></div>`}
    <div class="ghead">Etater og bedrifter</div><div class="jobs">${JOBS.map(job).join('')}</div>
    <div class="ghead">Andre søknader</div><div class="jobs">${other.map(o=>`<div class="card job"><h3>${o[1]} søknad</h3><p>${o[2]}</p><div><button class="btn sm" data-new="${o[0]}">Start søknad</button></div></div>`).join('')}</div>`;
}

function pForm(){
  const a=findApp(V.cur);
  if(!a)return pApps();
  const f=FORMS[a.form],edit=a.status==='utkast';
  const head=`<button class="back" data-go="soknader">Mine søknader</button><h1 class="ph" style="margin-top:14px">${f.title}</h1><div class="row" style="margin-top:12px">${pill(a.status)}<span class="muted">Opprettet ${ftime(a.createdAt)}</span></div>`;
  if(!edit){
    return head+`${a.reply?`<div class="reply ${a.status==='godkjent'?'ok':a.status==='avslatt'?'bad':''}" style="margin-top:24px"><b>Svar fra staff</b><p>${esc(a.reply)}</p></div>`:`<p class="muted" style="margin-top:24px">Søknaden ble sendt ${ftime(a.submittedAt)}. Staff svarer deg her i panelet.</p>`}
      <div class="form answers">${f.q.map(q=>`<div><b>${esc(q.label)}</b><p>${esc(a.answers[q.id]||'–')}</p></div>`).join('')}</div>
      ${a.status==='avslatt'?`<div class="bar"><span></span><button class="btn red" data-new="${a.form}">Søk på nytt</button></div>`:''}`;
  }
  return head+`<p class="muted" style="margin-top:22px">${f.intro}</p>
    <form class="form" id="appForm" novalidate>${f.q.map((q,i)=>{
      const v=esc(a.answers[q.id]||''),id='f_'+q.id,er=V.errors[q.id];
      const ctl=q.type==='textarea'?`<textarea id="${id}" name="${q.id}" maxlength="5000">${v}</textarea>`
        :q.type==='select'?`<select id="${id}" name="${q.id}" class="short"><option value="">Velg …</option>${q.options.map(o=>`<option ${a.answers[q.id]===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`
        :`<input id="${id}" name="${q.id}" type="${q.type==='number'?'number':'text'}" class="short" value="${v}" maxlength="200">`;
      return `<div class="q"><label for="${id}"><span class="n">${String(i+1).padStart(2,'0')}</span>${esc(q.label)} ${q.req?'<span class="req">(påkrevd)</span>':''}</label>${q.hint?`<span class="hint">${esc(q.hint)}</span>`:''}${ctl}${q.min?`<span class="hint mono" data-cnt="${q.id}">${(a.answers[q.id]||'').length} / ${q.min} tegn</span>`:''}${er?`<span class="err">${er}</span>`:''}</div>`}).join('')}
    </form>
    <div class="bar"><div class="row"><button class="btn danger sm" id="delApp">Slett utkast</button><span class="saved" id="saved">Utkastet lagres automatisk</span></div><button class="btn red" id="submitApp">Send inn søknad</button></div>`;
}

function pTickets(){
  const list=ST.tickets;
  return `<h1 class="ph">Mine tickets</h1><p class="pintro">Saker du har sendt til staff, og svarene du har fått. Søknader finner du under <a href="#soknader">Mine søknader</a>.</p>
${CFG.discordTickets?`<div class="notice" style="margin-top:20px"><span>Du kan også opprette tickets i Discord-serveren med <b>/ticket</b>. Saken og svarene vises begge steder.</span>${CFG.invite?`<a class="btn sm" href="${esc(CFG.invite)}" target="_blank" rel="noopener">Åpne Discord</a>`:''}</div>`:''}
  ${V.newT?`<div class="card" style="margin-top:24px;display:grid;gap:14px">
    <h3>Ny ticket</h3>
    <div class="q" style="padding:0;border:0"><label for="tCat">Kategori</label><select id="tCat" class="short">${CATS.map(c=>`<option>${c}</option>`).join('')}</select></div>
    <div class="q" style="padding:0;border:0"><label for="tSub">Emne</label><input type="text" id="tSub" maxlength="80" placeholder="Kort beskrivelse av saken"></div>
    <div class="q" style="padding:0;border:0"><label for="tBody">Beskrivelse</label><textarea id="tBody" maxlength="4000" placeholder="Hva skjedde? Ta med tidspunkt, navn og lenke til klipp."></textarea><span class="err" id="tErr" hidden></span></div>
    <div class="row"><button class="btn red" id="tSend">Send ticket</button><button class="btn ghost" id="tCancel">Avbryt</button></div>
  </div>`:`<div style="margin-top:22px"><button class="btn red" data-newt>Ny ticket</button></div>`}
  <div style="margin-top:22px">${list.length?ticketTools(list,false)
  :V.newT?'':`<div class="empty"><h3>Du har ingen tickets</h3><p>Trenger du hjelp eller vil rapportere noe, oppretter du en ticket her.</p><button class="btn red" data-newt>Opprett en ticket</button></div>`}</div>`;
}

function pTicket(){
  const d=V.ticketData,from=V.ticketFrom;
  const back=`<button class="back" data-go="${from}">${from==='staff'?'Staff':'Mine tickets'}</button>`;
  if(!d||d.ticket.id!==V.ticket)return back+loading('Henter ticketen …');
  const t=d.ticket,asStaff=can('tickets.view')&&!d.isOwner,mayClose=d.isOwner||can('tickets.close');
  return back+`<h1 class="ph" style="margin-top:14px">${esc(t.subject)}</h1>
  <div class="row" style="margin-top:12px"><span class="mono muted">#${tno(t.id)}</span>${tpill(t.status)}<span class="muted">${esc(t.category)} · opprettet ${ftime(t.createdAt)}${d.owner&&asStaff?` · fra ${esc(d.owner.name)} (<span class="mono">${esc(d.owner.id)}</span>)`:''}</span>${t.channelUrl?`<a class="btn sm ghost" href="${esc(t.channelUrl)}" target="_blank" rel="noopener">Åpne i Discord</a>`:''}</div>
  <div class="thread">${d.messages.map(m=>`<div class="msg ${m.staff?'staff':''}"><header><b>${m.staff?`Novex <span class="r">Staff</span>${m.staffName?' · '+esc(m.staffName):''}`:esc(m.name)}</b><span>${ftime(m.createdAt)}${m.source==='discord'?' · via Discord':''}</span></header><p>${esc(m.body)}</p></div>`).join('')}</div>
  ${t.status==='lukket'?`<div class="bar"><span class="muted">Ticketen er lukket.</span>${mayClose?'<button class="btn" id="tReopen">Åpne igjen</button>':''}</div>`
  :`<div class="card" style="margin-top:20px;display:grid;gap:12px"><label for="tReply"><b>${asStaff?'Svar som staff':'Skriv et svar'}</b></label><textarea id="tReply" maxlength="4000"></textarea><div class="spread">${mayClose?'<button class="btn ghost sm" id="tClose">Lukk ticket</button>':'<span></span>'}<button class="btn red" id="tReplyBtn">Send svar</button></div></div>`}`;
}

async function loadTicket(){
  const id=V.ticket;if(!id||V.ticketLoading)return;V.ticketLoading=true;
  try{V.ticketData=await api('GET','/api/tickets/'+id)}
  catch(e){V.ticketLoading=false;errToast(e);V.ticketData=null;V.ticket=null;go(V.ticketFrom);return}
  V.ticketLoading=false;if(route==='ticket')refresh();
}
async function loadStaff(){
  if(V.staffLoading)return;V.staffLoading=true;
  try{
    const [ov,ap,tk]=await Promise.all([api('GET','/api/staff/overview'),api('GET','/api/staff/apps?vis='+(V.staffTab==='venter'?'venter':'behandlet')),api('GET','/api/staff/tickets')]);
    V.staff={overview:ov,apps:ap.apps,tickets:tk.tickets};
  }catch(e){errToast(e);V.staff={overview:{},apps:[],tickets:[]}}
  V.staffLoading=false;if(route==='staff')refresh();
}
/* ---------- ticket-lister: filtrer på status, søk, sorter etter navn A–Å ---------- */
const TFILTER=[['apen','Venter'],['besvart','Besvart'],['lukket','Lukket'],['alle','Alle']];
const collate=new Intl.Collator('nb',{sensitivity:'base',numeric:true});
function tcfg(staff){return staff?{f:'staffT',s:'tSort',q:'tQ'}:{f:'myT',s:'mySort',q:'myQ'}}
function tSortName(t,staff){return staff?(t.user&&t.user.name)||'':t.subject||''}
function filterTickets(list,staff){
  const c=tcfg(staff),f=V[c.f],q=V[c.q].trim().toLowerCase().replace(/^#/,'');
  let out=list.filter(t=>f==='alle'||t.status===f);
  if(q)out=out.filter(t=>[t.subject,t.category,String(tno(t.id)),staff&&t.user?t.user.name:'',staff&&t.user?t.user.username:'',t.last?t.last.body:''].some(v=>String(v||'').toLowerCase().includes(q)));
  const so=V[c.s];
  if(so==='navn'||so==='navn-z'){out.sort((a,b)=>collate.compare(tSortName(a,staff),tSortName(b,staff))||b.updatedAt-a.updatedAt);if(so==='navn-z')out.reverse()}
  else if(so==='eldste')out.sort((a,b)=>a.updatedAt-b.updatedAt);
  else out.sort((a,b)=>b.updatedAt-a.updatedAt);
  return out;
}
function letterOf(n){const ch=(n||'').trim().charAt(0).toLocaleUpperCase('nb');return /\p{L}/u.test(ch)?ch:'#'}
function ticketRow(t,staff){
  const l=t.last,attr=staff?`data-sticket="${t.id}"`:`data-ticket="${t.id}"`;
  const lastLine=l&&t.messages>1?`<span class="tlast ${l.staff?'st':''}"><b>${l.staff?'Svar fra '+esc(l.name):esc(l.name)}:</b> ${esc(l.body)}${l.body.length>=160?' …':''}</span>`:'';
  return `<button class="li tk" ${attr}><span class="l"><span class="mono muted">#${tno(t.id)}</span><b>${esc(t.subject)}</b>${tpill(t.status)}</span><small>${esc(t.category)}${staff?' · '+esc(t.user.name):''} · ${t.messages} ${t.messages===1?'melding':'meldinger'}${t.replies?` · ${t.replies} svar fra staff`:' · ikke svart ennå'} · ${fdate(t.updatedAt)}</small>${lastLine}</button>`;
}
function ticketListHtml(list,staff){
  const c=tcfg(staff),out=filterTickets(list,staff),so=V[c.s];
  if(!out.length)return `<p class="muted" style="margin-top:6px">${V[c.q].trim()?'Ingen tickets passer søket.':V[c.f]==='alle'?'Ingen tickets.':'Ingen tickets her.'}</p>`;
  if(so==='navn'||so==='navn-z'){
    const groups=[];out.forEach(t=>{const k=letterOf(tSortName(t,staff));const g=groups[groups.length-1];if(g&&g.k===k)g.items.push(t);else groups.push({k,items:[t]})});
    return `<nav class="az" aria-label="Hopp til bokstav">${groups.map(g=>`<a href="#" data-az="${esc(g.k)}">${esc(g.k)}</a>`).join('')}</nav>`+groups.map(g=>`<div class="tgroup" id="az-${staff?'s':'m'}-${esc(g.k)}"><div class="letter">${esc(g.k)}<span>${g.items.length}</span></div><div class="list">${g.items.map(t=>ticketRow(t,staff)).join('')}</div></div>`).join('');
  }
  return `<div class="list">${out.map(t=>ticketRow(t,staff)).join('')}</div>`;
}
function ticketTools(list,staff){
  const c=tcfg(staff),cnt=k=>k==='alle'?list.length:list.filter(t=>t.status===k).length;
  const az=staff?'Spiller A–Å':'Emne A–Å',za=staff?'Spiller Å–A':'Emne Å–A';
  return `<div class="tabs">${TFILTER.map(([k,n])=>`<button data-tf="${k}" data-staffl="${staff?1:0}" class="${V[c.f]===k?'on':''}">${n} <span class="mono">${cnt(k)}</span></button>`).join('')}</div>
  <div class="ttools"><input type="search" id="${staff?'tQs':'tQm'}" placeholder="${staff?'Søk etter spiller, emne eller #nummer':'Søk i ticketene dine'}" value="${esc(V[c.q])}" maxlength="60" autocomplete="off">
  <label class="tsort"><span>Sorter</span><select id="${staff?'tSs':'tSm'}">${[['nyeste','Nyeste først'],['eldste','Eldste først'],['navn',az],['navn-z',za]].map(([v,n])=>`<option value="${v}" ${V[c.s]===v?'selected':''}>${n}</option>`).join('')}</select></label></div>
  <div id="${staff?'tkS':'tkM'}" style="margin-top:14px">${ticketListHtml(list,staff)}</div>`;
}
function pStaff(){
  const s=V.staff;
  if(!s)return `<h1 class="ph">Staff</h1>`+loading('Henter søknader og tickets …');
  const o=s.overview;
  const appCard=a=>`<div class="card" style="display:grid;gap:14px">
    <div class="spread"><div class="row"><div class="av"><img src="${esc(a.user.avatarUrl)}" alt=""></div><div><h3 style="font-size:28px">${FORMS[a.form]?FORMS[a.form].title:a.form}</h3><small class="muted">${esc(a.user.name)} · <span class="mono">${esc(a.user.id)}</span></small></div></div>${pill(a.status)}</div>
    <span class="muted" style="font-size:14px">Sendt ${ftime(a.submittedAt)}${a.decidedAt?` · behandlet ${ftime(a.decidedAt)}${a.decidedBy?' av '+esc(a.decidedBy):''}`:''}</span>
    <details><summary style="cursor:pointer;font-weight:700">Vis svar (${FORMS[a.form]?FORMS[a.form].q.length:0})</summary><div class="answers" style="margin-top:8px">${(FORMS[a.form]?FORMS[a.form].q:[]).map(q=>`<div><b>${esc(q.label)}</b><p>${esc(a.answers[q.id]||'–')}</p></div>`).join('')}</div></details>
    ${a.status==='sendt'?`<label for="r_${a.id}" class="muted" style="font-size:14px">Begrunnelse til søkeren</label><textarea id="r_${a.id}" style="min-height:80px" maxlength="2000"></textarea>
    <div class="row"><button class="btn red sm" data-decide="godkjent" data-id="${a.id}">Godkjenn</button><button class="btn danger sm" data-decide="avslatt" data-id="${a.id}">Avslå</button></div>`
    :`<div class="reply ${a.status==='godkjent'?'ok':'bad'}"><b>Svar sendt</b><p>${esc(a.reply)}</p></div>`}
  </div>`;
  const anyApps=['apps.whitelist','apps.jobs','apps.staff'].some(can);
  return `<div class="spread"><h1 class="ph">Staff</h1><div class="row">${CFG.discordTickets&&can('discord.manage')?'<button class="btn sm ghost" id="botRegister">Registrer Discord-kommandoer</button>':''}${can('staff.manage')?'<a class="btn sm ghost" href="#team">Staff-team</a>':''}<button class="btn sm" id="staffReload">Oppdater</button></div></div>
  <div class="row" style="margin-top:14px"><span class="muted" style="font-size:14px">Du er <b>${esc(ST.user.staffTitle||'Staff')}</b>. Rettigheter:</span><div class="tags">${ST.user.perms.map(p=>`<span class="ptag">${esc(PLABEL[p]||p)}</span>`).join('')||'<span class="ptag">Ingen</span>'}</div></div>
  <div class="stats" style="margin-top:20px"><div class="stat"><b>${o.pending??0}</b><span>Søknader venter</span></div><div class="stat"><b>${o.openTickets??0}</b><span>Tickets venter</span></div><div class="stat"><b>${o.users??0}</b><span>Registrerte spillere</span></div><div class="stat"><b>${o.whitelisted??0}</b><span>Whitelistet</span></div></div>
  ${anyApps?`<div class="ghead">Søknader</div>
  <div class="tabs"><button data-stab="venter" class="${V.staffTab==='venter'?'on':''}">Venter</button><button data-stab="behandlet" class="${V.staffTab==='behandlet'?'on':''}">Behandlet</button></div>
  <div class="stack">${s.apps.length?s.apps.map(appCard).join(''):`<p class="muted">${V.staffTab==='venter'?'Ingen søknader venter.':'Ingen behandlede søknader ennå.'}</p>`}</div>`:''}
  ${can('tickets.view')?`<div class="ghead">Tickets</div>
  ${ticketTools(s.tickets,true)}`:''}
  ${!anyApps&&!can('tickets.view')?'<div class="empty" style="margin-top:28px"><h3>Ingen oppgaver ennå</h3><p>Du er staff, men har ikke fått rettigheter til søknader eller tickets. Spør eieren.</p></div>':''}`;
}

/* ---------- staff-team: legg til staff og velg rettigheter ---------- */
async function loadTeam(){
  if(V.teamLoading)return;V.teamLoading=true;
  try{V.team=await api('GET','/api/staff/team')}catch(e){errToast(e);V.team={team:[],log:[]}}
  V.teamLoading=false;if(route==='team')refresh(true);
}
const grantable=p=>ST.user.isOwner||(can(p)&&p!=='staff.manage');
function editableMember(m){
  if(m.owner||m.id===ST.user.id)return false;
  if(ST.user.isOwner)return true;
  return !m.perms.includes('staff.manage')&&m.perms.every(can);
}
const LOGV={'la til':'la til','endret':'endret','fjernet':'fjernet'};
function pTeam(){
  const T=V.team;
  if(!T)return `<h1 class="ph">Staff-team</h1>`+loading('Henter staff …');
  const E=V.tEdit;
  const editor=E?`<div class="card" style="display:grid;gap:16px;margin-top:22px" id="tmEditor">
    <div class="spread"><div class="row"><div class="av"><img src="${esc(E.avatarUrl||'')}" alt=""></div><div><h3 style="font-size:30px">${esc(E.name)}</h3><small class="muted mono">${esc(E.id)}</small></div></div>${E.isNew?'<span class="ptag red">Ny staff</span>':''}</div>
    <div class="q" style="padding:0;border:0"><label for="tmTitle">Tittel</label><input type="text" id="tmTitle" class="short" maxlength="30" value="${esc(E.title)}" placeholder="F.eks. Moderator"><span class="hint">Vises i panelet. Rettighetene under bestemmer hva personen får gjøre.</span></div>
    <div><b style="display:block;margin-bottom:8px">Hurtigvalg</b><div class="row">${PRESETS.map((p,i)=>`<button class="btn sm ghost" data-preset="${i}" ${p.perms.every(grantable)?'':'disabled'}>${esc(p.name)}</button>`).join('')}</div></div>
    <div><b style="display:block;margin-bottom:8px">Rettigheter</b><div class="perms">${PERMS.map(p=>{const ok=grantable(p.k);return `<label class="perm ${ok?'':'off'}"><input type="checkbox" data-perm="${p.k}" ${E.perms.includes(p.k)?'checked':''} ${ok?'':'disabled'}><span><b>${esc(p.label)}</b><small>${esc(p.desc)}${ok?'':p.k==='staff.manage'?' Bare eieren kan gi denne.':' Du har ikke denne selv.'}</small></span></label>`}).join('')}</div></div>
    <div class="spread"><div class="row"><button class="btn red" id="tmSave">${E.isNew?'Legg til som staff':'Lagre endringer'}</button><button class="btn ghost" id="tmCancel">Avbryt</button></div>${E.isNew?'':'<button class="btn danger sm" id="tmRemove">Fjern fra staff</button>'}</div>
  </div>`:'';
  const add=E?'':`<div class="card" style="display:grid;gap:12px;margin-top:22px">
    <h3>Legg til staff</h3>
    <p class="muted" style="font-size:15px">Søk etter noen som har logget inn på nettsiden, eller skriv inn Discord-ID-en deres.</p>
    <div class="row"><input type="text" id="tmQ" class="short" placeholder="Navn, brukernavn eller Discord-ID" maxlength="40" autocomplete="off"><button class="btn" id="tmFind">Søk</button></div>
    ${V.tFound?(V.tFound.length?`<div class="found">${V.tFound.map(p=>`<button data-pick="${esc(p.id)}"><div class="av"><img src="${esc(p.avatarUrl)}" alt=""></div><span><b>${esc(p.name)}</b> <small class="muted">@${esc(p.username)} · <span class="mono">${esc(p.id)}</span></small></span></button>`).join('')}</div>`:'<p class="muted" style="font-size:14px">Fant ingen som har logget inn. Skriv inn hele Discord-ID-en for å legge dem til likevel.</p>'):''}
    <span class="hint muted" style="font-size:13px">Discord-ID finner du ved å slå på Utviklermodus i Discord og høyreklikke på personen → Kopier bruker-ID.</span>
  </div>`;
  const member=m=>`<div class="member"><div class="who2"><div class="av"><img src="${esc(m.avatarUrl)}" alt=""></div><div><div class="row" style="gap:8px"><b>${esc(m.name)}</b><span class="ptag ${m.owner?'red':'ink'}">${esc(m.title)}</span>${m.id===ST.user.id?'<small>(deg)</small>':''}</div><div class="tags">${m.owner?'<span class="ptag">Alle rettigheter</span>':m.perms.length?m.perms.map(p=>`<span class="ptag">${esc(PLABEL[p]||p)}</span>`).join(''):'<span class="ptag">Ingen rettigheter</span>'}</div><small class="mono">${esc(m.id)}${m.lastLogin?` · sist innlogget ${fdate(m.lastLogin)}`:' · har ikke logget inn ennå'}</small></div></div>${editableMember(m)?`<button class="btn sm" data-tedit="${esc(m.id)}">Endre</button>`:m.owner?'<small>Styres i Netlify</small>':''}</div>`;
  return `<button class="back" data-go="staff">Staff</button><div class="spread" style="margin-top:14px"><h1 class="ph">Staff-team</h1><button class="btn sm" id="teamReload">Oppdater</button></div>
  <p class="pintro">Gi folk staff-tilgang og velg nøyaktig hva de får gjøre. ${ST.user.isOwner?'Som eier kan du gi alle rettigheter.':'Du kan bare gi rettigheter du har selv.'} Staff med «Se og svare på tickets» får også tilgang til ticket-kanalene i Discord.</p>
  ${editor}${add}
  <div class="ghead">Staff (${T.team.length})</div>
  <div class="list" style="margin-top:14px">${T.team.map(member).join('')}</div>
  ${T.roleStaff?`<p class="muted" style="font-size:14px;margin-top:12px">Alle med staff-rollen i Discord får i tillegg: ${T.roleStaff.map(p=>esc(PLABEL[p]||p)).join(', ')}. Legger du dem til her, gjelder rettighetene du velger.</p>`:''}
  ${T.log&&T.log.length?`<div class="ghead">Siste endringer</div><div class="logl" style="margin-top:14px">${T.log.map(l=>`<div><b>${esc(l.byName)}</b> ${LOGV[l.action]||esc(l.action)} <b>${esc(l.targetName)}</b>${l.action!=='fjernet'?` (${l.perms.length} rettigheter)`:''}<span>${ftime(l.at)}</span></div>`).join('')}</div>`:''}`;
}
async function teamFind(){
  const q=($('#tmQ')||{}).value||'';const v=q.trim();
  if(/^\d{15,21}$/.test(v)){
    const known=V.team.team.find(m=>m.id===v);
    if(known){if(editableMember(known))openEdit(known);else toast('Den personen kan du ikke endre.');return}
    try{const r=await api('GET','/api/staff/players?q='+encodeURIComponent(v));const p=r.players[0];V.tEdit={id:v,name:p?p.name:'Discord-bruker',avatarUrl:p?p.avatarUrl:'',title:'',perms:[],isNew:true};V.tFound=null;render(true);const t=$('#tmTitle');if(t)t.focus()}catch(e){errToast(e)}
    return}
  try{V.tFound=(await api('GET','/api/staff/players?q='+encodeURIComponent(v))).players;render(true);const i=$('#tmQ');if(i){i.value=v;i.focus()}}catch(e){errToast(e)}
}
function openEdit(m){V.tEdit={id:m.id,name:m.name,avatarUrl:m.avatarUrl,title:m.title,perms:m.perms.slice(),isNew:false};V.tFound=null;render(true);const e=$('#tmEditor');if(e)e.scrollIntoView({block:'start',behavior:REDUCE?'auto':'smooth'})}
function readEdit(){const E=V.tEdit;if(!E)return;const t=$('#tmTitle');if(t)E.title=t.value;E.perms=[...document.querySelectorAll('[data-perm]')].filter(c=>c.checked).map(c=>c.dataset.perm)}

/* =========================================================
   ACTIONS
   ========================================================= */
function go(h){V.errors={};if(location.hash==='#'+h)render();else location.hash=h}
async function newApp(k){
  if(!ST.user){go('panel');return}
  try{
    const d=await api('POST','/api/apps',{form:k});
    if(k==='whitelist'&&d.app.status==='utkast'&&!d.app.answers.karakter){const p=idPending();if(p){d.app.answers.karakter=p;api('PUT','/api/apps/'+d.app.id,{answers:d.app.answers}).catch(()=>{})}}
    replaceApp(d.app);V.cur=d.app.id;V.errors={};go('soknad');
  }catch(e){errToast(e)}
}
function formAnswers(){
  const f=$('#appForm'),a=findApp(V.cur);if(!f||!a)return null;
  const out={};FORMS[a.form].q.forEach(q=>{const el=f.elements[q.id];if(el)out[q.id]=el.value});return out;
}
let saveT,saveChain=Promise.resolve();
function saveDraft(){
  const a=findApp(V.cur),ans=formAnswers();if(!a||!ans||a.status!=='utkast')return saveChain;
  a.answers=ans;const id=a.id;
  saveChain=saveChain.then(()=>api('PUT','/api/apps/'+id,{answers:ans})).then(()=>{const s=$('#saved');if(s)s.textContent='Lagret '+fclock(Date.now())}).catch(e=>{errToast(e)});
  return saveChain;
}
async function copyText(t,btn){
  try{await navigator.clipboard.writeText(t);toast('Kopiert: '+t)}
  catch(e){const r=document.createRange();r.selectNodeContents(btn);const s=getSelection();s.removeAllRanges();s.addRange(r);toast('Trykk Ctrl+C for å kopiere')}
}

document.addEventListener('click',async e=>{
  const el=e.target.closest('button,a,tr');if(!el)return;
  const d=el.dataset;
  if(d.copy){copyText(d.copy,el);return}
  if(d.clip!==undefined){setClip(+d.clip);return}
  if(d.car!==undefined){setCar(+d.car);return}
  if(d.jump){e.preventDefault();document.getElementById(d.jump).scrollIntoView({behavior:REDUCE?'auto':'smooth'});return}
  if(d.new){e.preventDefault();newApp(d.new);return}
  if(d.open){V.cur=Number(d.open);go('soknad');return}
  if(d.go){go(d.go);return}
  if(d.tab){V.tab=d.tab;render(true);return}
  if(d.stab){V.staffTab=d.stab;V.staff=null;render(true);return}
  if(d.tf){V[tcfg(d.staffl==='1').f]=d.tf;render(true);return}
  if(d.az){e.preventDefault();const el2=document.getElementById('az-'+(el.closest('#tkS')?'s':'m')+'-'+d.az);if(el2)el2.scrollIntoView({block:'start',behavior:REDUCE?'auto':'smooth'});return}
  if('newt' in d){V.newT=true;render(true);const s=$('#tSub');if(s)s.focus();return}
  if(d.ticket||d.sticket){V.ticket=Number(d.ticket||d.sticket);V.ticketFrom=d.sticket?'staff':'tickets';V.ticketData=null;go('ticket');return}
  if(d.pick){const p=(V.tFound||[]).find(x=>x.id===d.pick);if(p){V.tEdit={id:p.id,name:p.name,avatarUrl:p.avatarUrl,title:'',perms:[],isNew:true};V.tFound=null;render(true);const t=$('#tmTitle');if(t)t.focus()}return}
  if(d.tedit){const m=V.team.team.find(x=>x.id===d.tedit);if(m)openEdit(m);return}
  if(d.preset!==undefined){readEdit();const p=PRESETS[+d.preset];V.tEdit.perms=p.perms.filter(grantable);if(!V.tEdit.title.trim())V.tEdit.title=p.name;render(true);return}
  if(d.decide){
    const ta=$('#r_'+d.id);el.disabled=true;
    try{const r=await api('POST',`/api/staff/apps/${d.id}/decide`,{status:d.decide,reply:ta?ta.value:''});toast((d.decide==='godkjent'?'Søknaden er godkjent.':'Søknaden er avslått.')+(r.roleNote?' '+r.roleNote:''));V.staff=null;render(true)}
    catch(x){el.disabled=false;errToast(x)}
    return}
  switch(el.id){
    case 'menuBtn':{const o=$('#links').classList.toggle('open');el.setAttribute('aria-expanded',o);break}
    case 'cinePlay':{const c=G.cine;if(!c)break;c.playing=!c.playing;el.classList.toggle('paused',!c.playing);el.setAttribute('aria-label',c.playing?'Pause':'Spill av');const v=$('#cineVideo');if(c.vidOn){if(c.playing)v.play().catch(()=>{});else v.pause()}break}
    case 'logoutBtn':{e.preventDefault();try{await api('POST','/auth/logout')}catch(x){}ST.user=null;ST.apps=[];ST.tickets=[];V.staff=null;toast('Du er logget ut');location.hash='hjem';break}
    case 'staffReload':V.staff=null;render(true);break;
    case 'teamReload':V.team=null;render(true);break;
    case 'tmFind':teamFind();break;
    case 'tmCancel':V.tEdit=null;render(true);break;
    case 'tmSave':{
      readEdit();const E=V.tEdit;el.disabled=true;
      try{await api('PUT','/api/staff/team/'+E.id,{title:E.title,perms:E.perms});toast(E.isNew?E.name+' er lagt til som staff':'Rettighetene er lagret');V.tEdit=null;V.team=null;render(true)}
      catch(x){el.disabled=false;errToast(x)}
      break}
    case 'tmRemove':{
      const E=V.tEdit;
      if(el.dataset.sure!=='1'){el.dataset.sure='1';el.textContent='Trykk igjen for å fjerne '+E.name;setTimeout(()=>{if(el.isConnected){el.dataset.sure='';el.textContent='Fjern fra staff'}},4000);break}
      el.disabled=true;
      try{await api('DELETE','/api/staff/team/'+E.id);toast(E.name+' er fjernet fra staff');V.tEdit=null;V.team=null;render(true)}
      catch(x){el.disabled=false;errToast(x)}
      break}
    case 'botRegister':{el.disabled=true;try{await api('POST','/api/staff/discord/register',{});toast('/ticket og /ticket-panel er klare i Discord')}catch(x){errToast(x)}el.disabled=false;break}
    case 'delApp':{const id=V.cur;el.disabled=true;try{await api('DELETE','/api/apps/'+id);ST.apps=ST.apps.filter(a=>a.id!==id);toast('Utkastet er slettet');go('soknader')}catch(x){el.disabled=false;errToast(x)}break}
    case 'submitApp':{
      clearTimeout(saveT);const a=findApp(V.cur),answers=formAnswers();if(!a||!answers)break;a.answers=answers;
      V.errors=validate(a.form,answers);
      if(Object.keys(V.errors).length){saveDraft();render(true);const f=document.querySelector('.err');if(f)f.scrollIntoView({block:'center'});toast('Noen felt mangler');break}
      el.disabled=true;
      try{await saveChain;const r=await api('POST',`/api/apps/${a.id}/submit`,{answers});replaceApp(r.app);toast('Søknaden er sendt');render()}
      catch(x){el.disabled=false;if(x.errors){V.errors=x.errors;render(true)}errToast(x)}
      break}
    case 'tCancel':V.newT=false;render(true);break;
    case 'tSend':{
      const s=$('#tSub').value.trim(),b=$('#tBody').value.trim(),err=$('#tErr');
      if(!s||!b){err.textContent='Fyll ut emne og beskrivelse.';err.hidden=false;break}
      el.disabled=true;
      try{const r=await api('POST','/api/tickets',{category:$('#tCat').value,subject:s,body:b});ST.tickets.unshift(r.ticket);V.newT=false;toast('Ticket #'+tno(r.ticket.id)+' er opprettet');render(true)}
      catch(x){el.disabled=false;errToast(x)}
      break}
    case 'tReplyBtn':{
      const v=$('#tReply').value.trim();if(!v)break;el.disabled=true;
      try{await api('POST',`/api/tickets/${V.ticket}/messages`,{body:v});V.ticketData=null;await loadTicket();if(V.ticketFrom==='tickets')loadTickets().catch(()=>{});else V.staff=null}
      catch(x){el.disabled=false;errToast(x)}
      break}
    case 'tClose':case 'tReopen':{
      const status=el.id==='tClose'?'lukket':'apen';
      try{await api('PATCH','/api/tickets/'+V.ticket,{status});toast(status==='lukket'?'Ticketen er lukket':'Ticketen er åpnet igjen');V.ticketData=null;await loadTicket();if(V.ticketFrom==='tickets')loadTickets().then(()=>refresh()).catch(()=>{});else V.staff=null}
      catch(x){errToast(x)}
      break}
  }
});
app.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='tmQ'){e.preventDefault();teamFind()}});
function redrawTickets(staff){const box=$(staff?'#tkS':'#tkM');if(!box)return;const list=staff?(V.staff&&V.staff.tickets)||[]:ST.tickets;box.innerHTML=ticketListHtml(list,staff)}
app.addEventListener('input',e=>{const id=e.target.id;if(id==='tQs'||id==='tQm'){const st=id==='tQs';V[tcfg(st).q]=e.target.value;redrawTickets(st)}});
app.addEventListener('change',e=>{
  if(e.target.dataset&&e.target.dataset.perm){readEdit();return}
  const id=e.target.id;if(id==='tSs'||id==='tSm'){const st=id==='tSs';V[tcfg(st).s]=e.target.value;redrawTickets(st)}
});
app.addEventListener('input',e=>{
  if(e.target.id==='tmTitle'&&V.tEdit){V.tEdit.title=e.target.value;return}
  if(!e.target.closest('#appForm'))return;
  const a=findApp(V.cur);if(!a)return;
  const c=document.querySelector(`[data-cnt="${e.target.name}"]`);
  if(c){const q=FORMS[a.form].q.find(q=>q.id===e.target.name);c.textContent=e.target.value.length+' / '+q.min+' tegn'}
  clearTimeout(saveT);saveT=setTimeout(saveDraft,900);
});
addEventListener('hashchange',()=>{V.newT=false;render()});

/* oppdater i bakgrunnen, så svar fra staff dukker opp uten å laste siden på nytt */
async function poll(){
  if(!ST.user||document.hidden||typing())return;
  try{
    const m=await api('GET','/api/me');ST.user=m.user;if(!ST.user){refresh();return}
    await Promise.all([loadApps(),loadTickets()]);
    if(route==='ticket'&&V.ticket){V.ticketData=await api('GET','/api/tickets/'+V.ticket)}
    if(route==='staff'){V.staff=null}
    refresh();
  }catch(e){}
}

/* bakgrunnsvideo: YouTube (beste kvalitet) eller lokal fil i public/video/hero.mp4 */
let heroYt=null,heroOn=true;
function heroPlay(on){
  heroOn=on;
  if(heroYt){try{heroYt.contentWindow.postMessage(JSON.stringify({event:'command',func:on?'playVideo':'pauseVideo',args:''}),'*')}catch(e){}return}
  const hv=$('#heroVid');if(!hv||!hv.src)return;if(on&&!REDUCE)hv.play().catch(()=>{});else hv.pause();
}
function sizeHeroYt(){
  if(!heroYt)return;const h=$('#hero'),W=h.clientWidth,H=h.clientHeight;
  let w=W,ht=W*9/16;if(ht<H){ht=H;w=H*16/9}
  heroYt.style.width=Math.ceil(w*1.12)+'px';heroYt.style.height=Math.ceil(ht*1.12)+'px';
}
function setupHeroVideo(){
  const id=CFG.heroYoutube,hv=$('#heroVid'),cr=$('#heroCredit');
  if(CFG.heroCredit){cr.textContent=CFG.heroCredit;cr.hidden=false}
  if(id&&/^[\w-]{6,20}$/.test(id)&&!REDUCE){
    const wrap=document.createElement('div');wrap.className='heroyt';
    const q=new URLSearchParams({autoplay:1,mute:1,loop:1,playlist:id,controls:0,disablekb:1,modestbranding:1,playsinline:1,rel:0,iv_load_policy:3,enablejsapi:1,origin:location.origin});
    wrap.innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${id}?${q}" title="Bakgrunnsvideo" allow="autoplay; encrypted-media" tabindex="-1" aria-hidden="true"></iframe>`;
    $('#hero').insertBefore(wrap,$('#hero').firstChild);
    heroYt=wrap.firstChild;sizeHeroYt();addEventListener('resize',sizeHeroYt);
    heroYt.addEventListener('load',()=>heroPlay(heroOn));
    return;
  }
  if(hv&&hv.dataset.src){hv.src=hv.dataset.src;if(!REDUCE)hv.play().catch(()=>{})}
}

/* ekte bilder: legg filene i public/img/, ellers brukes 3D-bildene */
function tryRealImages(){
  document.querySelectorAll('img[data-real]').forEach(img=>{const t=new Image();t.onload=()=>{img.dataset.realOk='1';img.src=img.dataset.real};t.src=img.dataset.real});
  const h=new Image();h.onload=()=>{const hero=$('#hero');hero.style.backgroundImage='url(img/hero.jpg)';hero.classList.add('photo')};h.src='img/hero.jpg';
}


/* =========================================================
   LAG KARAKTEREN DIN – Novex innbyggerkort
   ========================================================= */
const ID={flipped:false,photo:'',theme:'red'};
const ID_THEMES={
  red:{a:'#e0141f',b:'#7d0910',ink:'#ffffff',sub:'rgba(255,255,255,.72)',line:'rgba(255,255,255,.14)',chip:'#d9b35b'},
  black:{a:'#26201f',b:'#0b0909',ink:'#ffffff',sub:'rgba(255,255,255,.62)',line:'rgba(224,20,31,.35)',chip:'#cfa64e'},
  white:{a:'#ffffff',b:'#ddd5d5',ink:'#160f10',sub:'rgba(22,15,16,.6)',line:'rgba(224,20,31,.22)',chip:'#c99d45'}
};
const ID_JOBS=['Sivil','Politi','Ambulanse','Mekaniker','Bilselger','Taxisjåfør','Advokat','Bedriftseier','Arbeidsledig'];
const xesc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function idHash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function idData(){
  const v=id=>($('#'+id)?$('#'+id).value:'').trim();
  const first=v('idFirst')||'Fornavn',last=v('idLast')||'Etternavn',birth=v('idBirth');
  const classes=[...document.querySelectorAll('#idForm input[name="idClass"]:checked')].map(i=>i.value);
  const h=idHash(first.toLowerCase()+'|'+last.toLowerCase()+'|'+birth);
  const num='NX-'+String(h%10000).padStart(4,'0')+'-'+String(Math.floor(h/10000)%10000).padStart(4,'0');
  let age=null,bstr='--.--.----';
  if(birth){const b=new Date(birth+'T12:00:00');if(!isNaN(b)){const n=new Date();age=n.getFullYear()-b.getFullYear()-((n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))?1:0);bstr=String(b.getDate()).padStart(2,'0')+'.'+String(b.getMonth()+1).padStart(2,'0')+'.'+b.getFullYear()}}
  const now=new Date(),fmt=d=>String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+d.getFullYear();
  const exp=new Date(now);exp.setFullYear(now.getFullYear()+10);
  const sexEl=$('#idSex');
  return {first,last,birth,bstr,age,sex:sexEl?sexEl.options[sexEl.selectedIndex].text:'',job:v('idJob')||'Sivil',classes,num,h,issued:fmt(now),expires:fmt(exp)};
}
function idGuilloche(t,w,h){
  let p='';for(let k=0;k<9;k++){let d='';for(let x=0;x<=w;x+=12){const y=h*.5+Math.sin(x/60+k*.7)*(40+k*9)+Math.cos(x/23+k)*8;d+=(x?'L':'M')+x+' '+y.toFixed(1)}p+=`<path d="${d}" fill="none" stroke="${t.line}" stroke-width="1.2"/>`}return p;
}
function idBarcode(h,x,y,w,ht,col){
  let out='',cx=x,s=h;while(cx<x+w){s=Math.imul(s^(s>>>15),2246822519)>>>0;const bw=1+(s%4),gap=1+((s>>>3)%3);if(cx+bw>x+w)break;out+=`<rect x="${cx}" y="${y}" width="${bw}" height="${ht}" fill="${col}"/>`;cx+=bw+gap}return out;
}
function idSilhouette(t){
  const c=t===ID_THEMES.white?'#c9c0c0':'rgba(255,255,255,.22)';
  return `<rect x="40" y="150" width="210" height="270" rx="10" fill="${t===ID_THEMES.white?'#ece6e6':'rgba(0,0,0,.22)'}"/><circle cx="145" cy="250" r="52" fill="${c}"/><path d="M60 420c8-70 45-104 85-104s77 34 85 104z" fill="${c}"/>`;
}
function idFrontSVG(d){
  const t=ID_THEMES[ID.theme],W=856,H=540;
  const field=(n,label,val,x,y,size=26)=>`<text x="${x}" y="${y}" font-family="Archivo,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="1.5" fill="${t.sub}">${n} ${label}</text><text x="${x}" y="${y+size+6}" font-family="'JetBrains Mono',Menlo,monospace" font-size="${size}" font-weight="500" fill="${t.ink}">${xesc(val)}</text>`;
  const photo=ID.photo?`<clipPath id="idClip"><rect x="40" y="150" width="210" height="270" rx="10"/></clipPath><image href="${ID.photo}" x="40" y="150" width="210" height="270" preserveAspectRatio="xMidYMid slice" clip-path="url(#idClip)"/><rect x="40" y="150" width="210" height="270" rx="10" fill="none" stroke="${t.line}" stroke-width="2"/>`:idSilhouette(t);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><linearGradient id="idBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.a}"/><stop offset="1" stop-color="${t.b}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" rx="34" fill="url(#idBg)"/>
  <g opacity=".9">${idGuilloche(t,W,H)}</g>
  <text x="${W-36}" y="${H-40}" text-anchor="end" font-family="'Big Shoulders Display',Impact,sans-serif" font-size="210" font-weight="900" fill="${t.line}">NX</text>
  <rect x="40" y="38" width="62" height="62" rx="6" fill="${ID.theme==='red'?'#ffffff':'#e0141f'}"/><path d="M55.5 89V49h8.2l20 24.5V49h8.2v40h-8.2l-20-24.5V89z" transform="translate(-3.5 0)" fill="${ID.theme==='red'?'#e0141f':'#ffffff'}"/>
  <text x="118" y="72" font-family="'Big Shoulders Display',Impact,sans-serif" font-size="40" font-weight="900" letter-spacing="2" fill="${t.ink}">NOVEX</text>
  <text x="120" y="96" font-family="Archivo,Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="4" fill="${t.sub}">INNBYGGERKORT</text>
  <rect x="${W-140}" y="40" width="96" height="72" rx="12" fill="${t.chip}"/><path d="M${W-140} 76h96M${W-92} 40v72M${W-124} 58h32M${W-124} 94h32M${W-60} 58h0" stroke="rgba(0,0,0,.28)" stroke-width="2" fill="none"/>
  ${photo}
  ${field('1','ETTERNAVN',d.last.toUpperCase(),290,170,30)}
  ${field('2','FORNAVN',d.first.toUpperCase(),290,236,30)}
  ${field('3','FØDT',d.bstr,290,302)}${field('4','KJØNN',d.sex,560,302)}
  ${field('5','YRKE',d.job,290,362)}${field('6','KLASSER',d.classes.join(' ')||'–',560,362)}
  ${field('7','UTSTEDT',d.issued,290,422,20)}${field('8','GYLDIG TIL',d.expires,470,422,20)}
  <text x="40" y="478" font-family="'JetBrains Mono',Menlo,monospace" font-size="20" fill="${t.ink}" letter-spacing="2">${d.num}</text>
  <text x="290" y="492" font-family="'Brush Script MT','Segoe Script',cursive" font-size="34" fill="${t.ink}" opacity=".85">${xesc(d.first+' '+d.last)}</text>
  <g>${idBarcode(d.h,640,456,176,40,t.ink)}</g>
</svg>`;
}
function idBackSVG(d){
  const t=ID_THEMES[ID.theme],W=856,H=540,con=(typeof CFG!=='undefined'&&CFG.connect)?CFG.connect:'play.novexrp.no';
  const rows=[['A','Motorsykkel'],['B','Personbil'],['C','Lastebil'],['D','Buss']];
  let qr='';let s=d.h;for(let y=0;y<11;y++)for(let x=0;x<11;x++){s=Math.imul(s^(s>>>13),1597334677)>>>0;const fix=(x<3&&y<3)||(x>7&&y<3)||(x<3&&y>7);if(fix||s%2)qr+=`<rect x="${640+x*14}" y="${300+y*14}" width="13" height="13" fill="${t.ink}" opacity="${fix?1:.85}"/>`}
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><linearGradient id="idBg2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.a}"/><stop offset="1" stop-color="${t.b}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" rx="34" fill="url(#idBg2)"/>
  <g opacity=".6">${idGuilloche(t,W,H)}</g>
  <rect x="0" y="54" width="${W}" height="78" fill="#0b0909"/>
  <text x="40" y="186" font-family="Archivo,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="2" fill="${t.sub}">FØRERKORTKLASSER</text>
  ${rows.map((r,i)=>{const on=d.classes.includes(r[0]),y=206+i*52;return `<rect x="40" y="${y}" width="540" height="44" rx="8" fill="${on?'rgba(0,0,0,.22)':'rgba(0,0,0,.08)'}"/><text x="60" y="${y+30}" font-family="'Big Shoulders Display',Impact,sans-serif" font-size="28" font-weight="900" fill="${t.ink}">${r[0]}</text><text x="110" y="${y+29}" font-family="Archivo,Arial,sans-serif" font-size="19" fill="${t.ink}">${r[1]}</text><text x="560" y="${y+29}" text-anchor="end" font-family="'JetBrains Mono',Menlo,monospace" font-size="17" fill="${on?t.ink:t.sub}">${on?d.issued:'–'}</text>`}).join('')}
  ${qr}
  <text x="40" y="452" font-family="Archivo,Arial,sans-serif" font-size="17" fill="${t.sub}">Gjelder kun i rollespill på Novex Rollespill. Ikke gyldig som legitimasjon.</text>
  <text x="40" y="486" font-family="'JetBrains Mono',Menlo,monospace" font-size="17" fill="${t.ink}">connect ${xesc(con)}</text>
  <text x="${W-40}" y="486" text-anchor="end" font-family="'JetBrains Mono',Menlo,monospace" font-size="17" fill="${t.ink}">${d.num}</text>
</svg>`;
}
function idRender(){
  if(!$('#idCard'))return;
  const d=idData();
  $('#idFront').innerHTML=idFrontSVG(d);$('#idBack').innerHTML=idBackSVG(d);
  const err=$('#idErr'),bad=d.age!==null&&d.age<18;
  err.hidden=!bad;if(bad)err.textContent='Karakterer på Novex må være 18 år eller eldre.';
  $('#idUse').disabled=bad;
}
function idSummary(){
  const d=idData();
  return `Navn: ${d.first} ${d.last}\nFødselsdato: ${d.bstr}${d.age!==null?` (${d.age} år)`:''}\nKjønn: ${d.sex}\nYrke: ${d.job}\nFørerkort: ${d.classes.join(', ')||'Ingen'}\n\nBakgrunn: `;
}
async function idDownload(btn){
  const d=idData(),svg=idFrontSVG(d);
  btn.disabled=true;
  try{
    const img=new Image();const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});
    const c=document.createElement('canvas');c.width=1712;c.height=1080;c.getContext('2d').drawImage(img,0,0,1712,1080);URL.revokeObjectURL(url);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    const name=`novex-${(d.first+'-'+d.last).toLowerCase().replace(/[^a-z0-9æøå-]+/g,'')}.png`;
    const dl=window.claude&&window.claude.use?await window.claude.use('downloads'):null;
    if(dl){await dl.save({filename:name,data:blob});}
    else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
  }catch(e){if(!e||e.code!=='declined')toast('Kunne ikke lage bildet. Prøv igjen.')}
  btn.disabled=false;
}
function idInit(){
  if(!$('#idForm'))return;
  $('#idJob').innerHTML=ID_JOBS.map(j=>`<option>${j}</option>`).join('');
  $('#idForm').addEventListener('input',idRender);$('#idForm').addEventListener('change',idRender);
  $('#idForm').addEventListener('submit',e=>e.preventDefault());
  document.querySelectorAll('#idForm input[name="idTheme"]').forEach(r=>r.addEventListener('change',()=>{ID.theme=r.value;idRender()}));
  $('#idPhoto').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;if(!/^image\//.test(f.type)){toast('Velg en bildefil.');return}
    const fr=new FileReader();fr.onload=()=>{const im=new Image();im.onload=()=>{const c=document.createElement('canvas'),s=Math.min(1,600/Math.max(im.width,im.height));c.width=im.width*s;c.height=im.height*s;c.getContext('2d').drawImage(im,0,0,c.width,c.height);ID.photo=c.toDataURL('image/jpeg',.88);$('#idPhotoName').textContent=f.name;idRender()};im.src=fr.result};fr.readAsDataURL(f)});
  const card=$('#idCard'),stage=$('#idStage');
  const flip=()=>{ID.flipped=!ID.flipped;card.classList.toggle('flipped',ID.flipped)};
  card.addEventListener('click',flip);card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flip()}});
  if(!REDUCE&&matchMedia('(hover:hover)').matches){
    stage.addEventListener('pointermove',e=>{const b=stage.getBoundingClientRect(),x=(e.clientX-b.left)/b.width-.5,y=(e.clientY-b.top)/b.height-.5;card.style.setProperty('--rx',(-y*16)+'deg');card.style.setProperty('--ry',(x*22)+'deg');card.style.setProperty('--mx',((x+.5)*100)+'%');card.style.setProperty('--my',((y+.5)*100)+'%')});
    stage.addEventListener('pointerleave',()=>{card.style.setProperty('--rx','0deg');card.style.setProperty('--ry','0deg')});
  }
  $('#idSave').addEventListener('click',e=>idDownload(e.currentTarget));
  $('#idUse').addEventListener('click',()=>{const txt=idSummary();try{sessionStorage.setItem('novex-char',txt)}catch(e){}idUseInWhitelist(txt)});
  idRender();
}
function idPending(){try{const v=sessionStorage.getItem('novex-char');if(v)sessionStorage.removeItem('novex-char');return v}catch(e){return null}}

function idUseInWhitelist(txt){
  if(!ST.user){toast('Logg inn med Discord først. Karakteren fylles inn i søknaden etterpå.');go('panel');return}
  newApp('whitelist');
}

/* =========================================================
   BOOT
   ========================================================= */
$('#bizHome').innerHTML=BIZ.slice(0,4).map(bizCard).join('');
renderClips();bindCineVideo();idInit();
/* videoene spilles bare når de vises, så de ikke bruker maskinkraft ellers */
(function(){
  const cv=$('#cineVideo');
  if(REDUCE)return;
  const io=new IntersectionObserver(es=>es.forEach(e=>{
    const on=e.isIntersecting&&!$('#home').hidden;
    if(e.target.id==='hero')heroPlay(on);
    if(e.target.id==='screen'&&cv&&G.cine&&G.cine.vidOn){if(on&&G.cine.playing)cv.play().catch(()=>{});else cv.pause()}
  }),{threshold:.05});
  io.observe($('#hero'));io.observe($('#screen'));
})();
if(REDUCE)$('#cinePlay').classList.add('paused');
bindTilt(document);
tryRealImages();
try{initGL()}catch(e){console.error(e);G.ok=false}
setClip(0);
render();
loadMe();
loadStatus();
setInterval(loadStatus,60000);
setInterval(poll,30000);
