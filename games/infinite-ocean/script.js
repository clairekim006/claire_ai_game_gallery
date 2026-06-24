const canvas = document.getElementById("ocean");
const ctx = canvas.getContext("2d");
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;

const state = {
  started: false, x: 0, y: 0, angle: -Math.PI / 2, speed: 0, distance: 0,
  hull: 100, supplies: 100, day: 1, sound: true, discoveries: [], elapsed: 0,
  throttle: 0, maxSpeed: 105, fireCooldown: 0, won: false, lost: false
};
const keys = {};
const world = new Map();
const projectiles = [];
const treasure = { x: 4000, y: -3000, found: false };
const ports = [
  { x: 680, y: -520, name: "Gullhaven", visited: false },
  { x: 1560, y: -1040, name: "Lantern Anchorage", visited: false },
  { x: 2540, y: -1960, name: "Port Meridian", visited: false },
  { x: 3380, y: -2500, name: "Crown's Rest", visited: false }
];
const monsters = [
  { x: 1120, y: -810, homeX: 1120, homeY: -810, health: 3, active: false, defeated: false, phase: .3 },
  { x: 2160, y: -1540, homeX: 2160, homeY: -1540, health: 4, active: false, defeated: false, phase: 1.8 },
  { x: 3140, y: -2250, homeX: 3140, homeY: -2250, health: 5, active: false, defeated: false, phase: 3.2 }
];
let width = 0, height = 0, dpr = 1, lastTime = 0, audioContext;

const discoveryTypes = [
  { type: "island", symbol: "♠", color: "#68a47a", names: ["Whispering Cay", "The Fern Isles", "Solitude Key", "Morrow Atoll"], descriptions: ["Palm canopies hide freshwater springs.", "Green cliffs emerge through the silver mist.", "Warm sand holds footprints that are not yours."] },
  { type: "wreck", symbol: "⌁", color: "#c79567", names: ["The Hollow Queen", "Saint Orra's Wake", "The Wayward Bell", "The Last Lantern"], descriptions: ["A lost vessel creaks beneath circling gulls.", "Its logbook ends in the middle of a sentence.", "A barnacled hull offers salvage and old secrets."] },
  { type: "monster", symbol: "≋", color: "#b77775", names: ["The Pale Leviathan", "Maw of the Deep", "The Glass Serpent", "Old Undertow"], descriptions: ["Something vast turns beneath the keel.", "A shadow longer than any ship breaks the surface.", "Ancient eyes open in the dark water."] },
  { type: "city", symbol: "◫", color: "#d0ba77", names: ["Pelagos", "The Brass Anchorage", "Driftspire", "Nacre-on-the-Waves"], descriptions: ["A city of sails drifts beyond the horizon.", "Markets and lanterns float where no map promised land.", "A thousand tethered vessels form streets upon the sea."] }
];
const regionNames = ["The Stillwater Expanse", "The Sapphire Reach", "The Moonwake Sea", "The Far Meridian", "The Shivering Blue", "The Unwritten Gulf", "The Lantern Waters"];

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function getCell(cx, cy) {
  const key = `${cx},${cy}`;
  if (world.has(key)) return world.get(key);
  const roll = hash(cx, cy);
  let feature = null;
  if (!(cx === 0 && cy === 0) && roll > .72) {
    const typeIndex = Math.min(3, Math.floor(hash(cx + 91, cy - 43) * 4));
    const info = discoveryTypes[typeIndex];
    const nameIndex = Math.floor(hash(cx - 17, cy + 64) * info.names.length);
    const descIndex = Math.floor(hash(cx + 7, cy + 12) * info.descriptions.length);
    feature = {
      id: key, type: info.type, symbol: info.symbol, color: info.color,
      name: info.names[nameIndex], description: info.descriptions[descIndex],
      x: cx * 430 + (hash(cx + 2, cy) - .5) * 170,
      y: cy * 430 + (hash(cx, cy + 2) - .5) * 170,
      discovered: false, phase: hash(cx + 10, cy + 10) * TAU
    };
  }
  const cell = { feature, waveSeed: hash(cx + 30, cy - 20) };
  world.set(key, cell);
  return cell;
}

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2); width = innerWidth; height = innerHeight;
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldToScreen(x, y) { return { x: width / 2 + x - state.x, y: height / 2 + y - state.y }; }

function drawOcean(time) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#164b59"); gradient.addColorStop(.55, "#0b3948"); gradient.addColorStop(1, "#072c3a");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  const spacing = 58;
  ctx.lineWidth = .7;
  for (let y = -spacing; y < height + spacing; y += spacing) {
    for (let x = -spacing; x < width + spacing; x += spacing) {
      const wx = x + ((-state.x * .16) % spacing);
      const wy = y + ((-state.y * .16) % spacing);
      const wave = Math.sin(time * .0007 + x * .018 + y * .011) * 5;
      ctx.strokeStyle = `rgba(171,220,215,${.045 + ((x + y) % 3) * .008})`;
      ctx.beginPath(); ctx.moveTo(wx - 18, wy + wave); ctx.quadraticCurveTo(wx, wy + wave - 5, wx + 18, wy + wave); ctx.stroke();
    }
  }
  const sun = ctx.createRadialGradient(width * .67, height * .22, 0, width * .67, height * .22, height * .7);
  sun.addColorStop(0, "rgba(211,231,203,.13)"); sun.addColorStop(1, "rgba(211,231,203,0)");
  ctx.fillStyle = sun; ctx.fillRect(0, 0, width, height);
}

function drawFeature(feature, time) {
  const p = worldToScreen(feature.x, feature.y);
  if (p.x < -150 || p.x > width + 150 || p.y < -150 || p.y > height + 150) return;
  const distance = Math.hypot(feature.x - state.x, feature.y - state.y);
  const visibility = Math.max(0, Math.min(1, (350 - distance) / 160));
  if (!visibility && !feature.discovered) return;
  ctx.save(); ctx.translate(p.x, p.y + Math.sin(time * .0014 + feature.phase) * 3); ctx.globalAlpha = feature.discovered ? 1 : visibility;
  if (feature.type === "island") drawIsland();
  if (feature.type === "wreck") drawWreck();
  if (feature.type === "monster") drawMonster(time, feature.phase);
  if (feature.type === "city") drawCity();
  if (distance < 250) {
    ctx.fillStyle = "rgba(232,244,238,.88)"; ctx.font = "500 9px Manrope"; ctx.textAlign = "center";
    ctx.fillText(feature.name, 0, 62);
    ctx.fillStyle = "rgba(165,193,185,.6)"; ctx.font = "7px 'DM Mono'";
    ctx.fillText(`${Math.round(distance / 10)} nm`, 0, 73);
  }
  ctx.restore();
}

function drawIsland() {
  ctx.fillStyle = "rgba(2,17,23,.28)"; ctx.beginPath(); ctx.ellipse(2, 18, 54, 15, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#c5ad72"; ctx.beginPath(); ctx.ellipse(0, 8, 46, 22, -.12, 0, TAU); ctx.fill();
  ctx.fillStyle = "#49795e"; ctx.beginPath(); ctx.ellipse(-3, 2, 35, 18, -.2, 0, TAU); ctx.fill();
  [[-18,-10],[-2,-13],[14,-5],[23,2]].forEach(([x,y], i) => { ctx.strokeStyle="#493f31";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y+14);ctx.lineTo(x+i%2*3,y);ctx.stroke();ctx.fillStyle="#60916b";ctx.beginPath();ctx.arc(x,y,9,0,TAU);ctx.fill(); });
}
function drawWreck() {
  ctx.save(); ctx.rotate(-.22); ctx.fillStyle="#5d4938"; ctx.beginPath(); ctx.moveTo(-36,-5);ctx.lineTo(31,-5);ctx.lineTo(19,14);ctx.lineTo(-26,14);ctx.closePath();ctx.fill();ctx.strokeStyle="#8f7654";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(3,-5);ctx.lineTo(3,-40);ctx.lineTo(27,-12);ctx.stroke();ctx.fillStyle="rgba(189,165,112,.6)";ctx.beginPath();ctx.moveTo(5,-38);ctx.lineTo(24,-14);ctx.lineTo(5,-12);ctx.closePath();ctx.fill();ctx.restore();
}
function drawMonster(time, phase) {
  const sway = Math.sin(time*.002+phase)*8; ctx.strokeStyle="#795f69";ctx.lineWidth=7;ctx.lineCap="round";
  for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(i*8,15);ctx.bezierCurveTo(i*13+sway,-5,i*15-sway,-28,i*11,-43);ctx.stroke();}
  ctx.fillStyle="#97747d";ctx.beginPath();ctx.ellipse(0,8,27,19,0,0,TAU);ctx.fill();ctx.fillStyle="#e5cd93";ctx.beginPath();ctx.arc(-8,3,2.5,0,TAU);ctx.arc(8,3,2.5,0,TAU);ctx.fill();
}
function drawPort(port, time) {
  const p=worldToScreen(port.x,port.y);if(p.x<-100||p.x>width+100||p.y<-100||p.y>height+100)return;
  ctx.save();ctx.translate(p.x,p.y+Math.sin(time*.0015)*2);ctx.fillStyle="rgba(6,23,28,.35)";ctx.beginPath();ctx.ellipse(0,15,48,11,0,0,TAU);ctx.fill();ctx.fillStyle="#75634d";ctx.fillRect(-38,2,76,14);ctx.fillStyle="#bda66f";ctx.fillRect(-23,-21,15,23);ctx.fillStyle="#d6c384";ctx.fillRect(4,-31,18,33);ctx.fillStyle="#8ec0a8";ctx.beginPath();ctx.moveTo(27,-34);ctx.lineTo(27,-8);ctx.lineTo(47,-20);ctx.closePath();ctx.fill();ctx.strokeStyle="#c7d8c8";ctx.beginPath();ctx.moveTo(27,-36);ctx.lineTo(27,3);ctx.stroke();ctx.textAlign="center";ctx.fillStyle="#b9d5c9";ctx.font="500 8px 'DM Mono'";ctx.fillText(`⚑ ${port.name}`,0,39);ctx.fillStyle="#7e9b91";ctx.font="6px 'DM Mono'";ctx.fillText("RESUPPLY HARBOR",0,49);ctx.restore();
}
function drawTreasure(time) {
  const p=worldToScreen(treasure.x,treasure.y);if(p.x<-120||p.x>width+120||p.y<-120||p.y>height+120)return;
  ctx.save();ctx.translate(p.x,p.y);const glow=ctx.createRadialGradient(0,0,4,0,0,75);glow.addColorStop(0,"rgba(238,205,117,.35)");glow.addColorStop(1,"rgba(238,205,117,0)");ctx.fillStyle=glow;ctx.fillRect(-80,-80,160,160);ctx.fillStyle="#c29a52";ctx.fillRect(-23,-10,46,30);ctx.strokeStyle="#f0d58f";ctx.lineWidth=3;ctx.strokeRect(-23,-10,46,30);ctx.beginPath();ctx.arc(0,-10,23,Math.PI,TAU);ctx.stroke();ctx.fillStyle="#f2dc9f";ctx.font="500 9px 'DM Mono'";ctx.textAlign="center";ctx.fillText("THE SUNKEN CROWN",0,48);ctx.restore();
}
function drawProjectile(ball) { const p=worldToScreen(ball.x,ball.y);ctx.save();ctx.shadowColor="#ffc88a";ctx.shadowBlur=10;ctx.fillStyle="#ffe0a3";ctx.beginPath();ctx.arc(p.x,p.y,3,0,TAU);ctx.fill();ctx.restore(); }
function drawCity() {
  ctx.fillStyle="rgba(3,18,23,.35)";ctx.beginPath();ctx.ellipse(0,20,60,13,0,0,TAU);ctx.fill();ctx.fillStyle="#826e58";ctx.fillRect(-46,7,92,16);
  [-34,-19,-3,14,29].forEach((x,i)=>{const h=22+(i%3)*10;ctx.fillStyle=i===2?"#ba9b68":"#8f846e";ctx.fillRect(x,-h+8,12,h);ctx.fillStyle="#e8c77f";ctx.fillRect(x+3,-h+13,2,3);ctx.fillRect(x+8,-h+5,2,3);});
  ctx.strokeStyle="#c5ae7a";ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,8,52,Math.PI,TAU);ctx.stroke();
}

function drawShip(time) {
  ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(state.angle + Math.PI / 2);
  if (state.speed > .05) { ctx.strokeStyle="rgba(204,235,227,.34)";ctx.lineWidth=1;[-1,1].forEach(s=>{ctx.beginPath();ctx.moveTo(s*8,17);ctx.quadraticCurveTo(s*18,35,s*25,54);ctx.stroke();}); }
  ctx.fillStyle="rgba(0,10,16,.25)";ctx.beginPath();ctx.ellipse(3,7,15,28,0,0,TAU);ctx.fill();
  ctx.fillStyle="#9b6f45";ctx.beginPath();ctx.moveTo(0,-27);ctx.lineTo(13,16);ctx.lineTo(0,26);ctx.lineTo(-13,16);ctx.closePath();ctx.fill();
  ctx.fillStyle="#492f25";ctx.fillRect(-2,-26,4,48);ctx.strokeStyle="#d6c7a4";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(0,-43);ctx.stroke();
  ctx.fillStyle="#e1d4af";ctx.beginPath();ctx.moveTo(2,-40);ctx.lineTo(24,-12);ctx.lineTo(2,-8);ctx.closePath();ctx.fill();
  ctx.fillStyle="#b76f55";ctx.beginPath();ctx.moveTo(-2,-35);ctx.lineTo(-17,-13);ctx.lineTo(-2,-9);ctx.closePath();ctx.fill();
  ctx.restore();
}

function update(dt) {
  if (!state.started || $("eventCard").classList.contains("show") || state.won || state.lost) return;
  const turning = (keys.ArrowLeft || keys.a ? -1 : 0) + (keys.ArrowRight || keys.d ? 1 : 0);
  const accelerating = keys.ArrowUp || keys.w;
  const braking = keys.ArrowDown || keys.s;
  if (accelerating) state.throttle = Math.min(1, state.throttle + dt * .18);
  else state.throttle = Math.max(0, state.throttle - dt * .035);
  if (braking) state.throttle = Math.max(0, state.throttle - dt * .55);
  const targetSpeed = state.throttle * state.maxSpeed;
  state.speed += (targetSpeed - state.speed) * Math.min(1, dt * (accelerating ? .75 : .38));
  if (braking) state.speed -= dt * 24;
  state.speed = Math.max(-12, Math.min(state.maxSpeed, state.speed));
  state.angle += turning * dt * (1.85 - Math.min(.7,Math.abs(state.speed)/160));
  const dx = Math.cos(state.angle) * state.speed * dt, dy = Math.sin(state.angle) * state.speed * dt;
  state.x += dx; state.y += dy; state.distance += Math.hypot(dx,dy) / 18; state.elapsed += dt;
  state.supplies = Math.max(0, state.supplies - Math.abs(state.speed) * dt * .0012);
  state.day = 1 + Math.floor(state.elapsed / 38);
  state.fireCooldown=Math.max(0,state.fireCooldown-dt);if(keys[" "])fireCannons();
  updateProjectiles(dt);updateMonsters(dt);inspectWorld();checkPortsAndGoal();updateUI();
}

function fireCannons() {
  if(state.fireCooldown>0||!state.started||state.lost||state.won)return;state.fireCooldown=.38;
  const muzzle=30;projectiles.push({x:state.x+Math.cos(state.angle)*muzzle,y:state.y+Math.sin(state.angle)*muzzle,vx:Math.cos(state.angle)*250,vy:Math.sin(state.angle)*250,life:1.5});playShot();
}
function updateProjectiles(dt) {
  for(let i=projectiles.length-1;i>=0;i--){const b=projectiles[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;for(const m of monsters){if(!m.defeated&&Math.hypot(b.x-m.x,b.y-m.y)<34){m.health--;b.life=0;playTone(180);if(m.health<=0){m.defeated=true;m.active=false;showToast("Sea creature defeated · passage clear");}}}if(b.life<=0)projectiles.splice(i,1);}
}
function updateMonsters(dt) {
  let danger=false;
  for(const m of monsters){if(m.defeated)continue;const dist=Math.hypot(state.x-m.x,state.y-m.y);if(dist<390)m.active=true;if(m.active){danger=true;const angle=Math.atan2(state.y-m.y,state.x-m.x);const chaseSpeed=state.maxSpeed*.58+(1-m.health/5)*10;m.x+=Math.cos(angle)*chaseSpeed*dt;m.y+=Math.sin(angle)*chaseSpeed*dt;if(dist<32){state.hull=Math.max(0,state.hull-24*dt);state.speed*=.98;}if(dist>800){m.active=false;m.x=m.homeX;m.y=m.homeY;}}}
  $("combatAlert").classList.toggle("show",danger);if(state.hull<=0&&!state.lost){state.lost=true;showEnd("SHIP LOST","The ocean claims another name. The Sunken Crown still waits.","TRY AGAIN");}
}
function checkPortsAndGoal() {
  for(const port of ports){if(Math.hypot(state.x-port.x,state.y-port.y)<68&&!port.visited){port.visited=true;state.supplies=100;state.hull=Math.min(100,state.hull+28);showToast(`${port.name} · supplies full, hull repaired`);playTone(560);}}
  if(!treasure.found&&Math.hypot(state.x-treasure.x,state.y-treasure.y)<64){treasure.found=true;state.won=true;showEnd("TREASURE FOUND","The Sunken Crown rises from the deep. Your impossible voyage is complete.","SAIL AGAIN");}
}
function showEnd(title,description,button){$("eventIcon").textContent=state.won?"♛":"×";$("eventTitle").textContent=title;$("eventDescription").textContent=description;$("eventClose").textContent=button;$("eventCard").classList.add("show");}
let toastTimer;function showToast(message){$("toast").textContent=message;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2600);}

function inspectWorld() {
  const cx = Math.round(state.x / 430), cy = Math.round(state.y / 430);
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    const feature = getCell(x,y).feature;
    if (feature && !feature.discovered && Math.hypot(feature.x-state.x, feature.y-state.y) < 72) discover(feature);
  }
}

function discover(feature) {
  feature.discovered = true; state.discoveries.unshift(feature); state.speed *= .3;
  if (feature.type === "island") state.supplies = Math.min(100, state.supplies + 22);
  if (feature.type === "wreck") state.supplies = Math.min(100, state.supplies + 12);
  if (feature.type === "monster") state.hull = Math.max(0, state.hull - 16);
  if (feature.type === "city") { state.supplies = 100; state.hull = Math.min(100, state.hull + 12); }
  $("eventIcon").textContent = feature.symbol; $("eventIcon").style.color = feature.color;
  $("eventTitle").textContent = feature.name; $("eventDescription").textContent = feature.description;
  $("eventCard").classList.add("show"); renderLog(); playTone(feature.type === "monster" ? 140 : 480);
}

function renderLog() {
  $("discoveryTotal").textContent = state.discoveries.length;
  $("discoveryList").innerHTML = state.discoveries.slice(0,8).map(f => `<article class="discovery-item"><span class="symbol" style="color:${f.color}">${f.symbol}</span><div><h3>${f.name}</h3><p>${f.type.toUpperCase()} · CHARTED DAY ${String(state.day).padStart(2,"0")}</p></div></article>`).join("");
}

function updateUI() {
  $("voyage").textContent = `DAY ${String(state.day).padStart(2,"0")}`;
  $("distanceValue").textContent = `${state.distance.toFixed(1)} nm`;
  $("hullValue").textContent = Math.round(state.hull); $("hullBar").style.width = `${state.hull}%`;
  $("supplyValue").textContent = Math.round(state.supplies); $("supplyBar").style.width = `${state.supplies}%`;
  $("speedValue").textContent=`${Math.max(0,Math.round(state.speed))} kts`;$("speedBar").style.width=`${Math.max(0,state.speed/state.maxSpeed*100)}%`;
  $("compassNeedle").style.transform = `rotate(${state.angle + Math.PI/2}rad)`;
  const lat = Math.abs(state.y / 60), lon = Math.abs(state.x / 60);
  $("coordinates").textContent = `${lat.toFixed(0).padStart(2,"0")}° ${String(Math.floor(lat*60)%60).padStart(2,"0")}′ ${state.y<0?"N":"S"} · ${lon.toFixed(0).padStart(2,"0")}° ${String(Math.floor(lon*60)%60).padStart(2,"0")}′ ${state.x>=0?"E":"W"}`;
  const rx = Math.floor(state.x/900), ry = Math.floor(state.y/900);
  $("regionName").textContent = regionNames[Math.floor(hash(rx,ry)*regionNames.length)];
  const treasureAngle=Math.atan2(treasure.y-state.y,treasure.x-state.x)-state.angle+Math.PI/2;
  $("treasureArrow").style.transform=`rotate(${treasureAngle}rad)`;$("treasureDistance").textContent=`${Math.ceil(Math.hypot(treasure.x-state.x,treasure.y-state.y)/10)} miles`;
  const nearest=ports.filter(p=>!p.visited).sort((a,b)=>Math.hypot(a.x-state.x,a.y-state.y)-Math.hypot(b.x-state.x,b.y-state.y))[0]||ports[ports.length-1];
  const portAngle=Math.atan2(nearest.y-state.y,nearest.x-state.x)-state.angle+Math.PI/2;$("portArrow").style.transform=`rotate(${portAngle}rad)`;$("portDistance").textContent=`${Math.ceil(Math.hypot(nearest.x-state.x,nearest.y-state.y)/10)} mi`;
}

function playTone(freq) {
  if (!state.sound) return; audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  const osc=audioContext.createOscillator(), gain=audioContext.createGain();osc.type="sine";osc.frequency.value=freq;gain.gain.setValueAtTime(.04,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.35);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.35);
}
function playShot(){if(!state.sound)return;audioContext||=new(window.AudioContext||window.webkitAudioContext)();const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type="sawtooth";osc.frequency.setValueAtTime(110,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(45,audioContext.currentTime+.12);gain.gain.setValueAtTime(.05,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.14);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.14);}

function frame(time) {
  const dt = Math.min(.035, (time-lastTime)/1000 || 0); lastTime=time; update(dt); drawOcean(time);
  const cx=Math.round(state.x/430), cy=Math.round(state.y/430);
  for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++){const f=getCell(x,y).feature;if(f)drawFeature(f,time);}
  ports.forEach(p=>drawPort(p,time));drawTreasure(time);monsters.forEach(m=>{if(!m.defeated){const p=worldToScreen(m.x,m.y);if(p.x>-100&&p.x<width+100&&p.y>-100&&p.y<height+100){ctx.save();ctx.translate(p.x,p.y);drawMonster(time,m.phase);ctx.fillStyle="rgba(80,18,22,.5)";ctx.fillRect(-25,38,50,3);ctx.fillStyle="#d07f72";ctx.fillRect(-25,38,50*Math.max(0,m.health/5),3);ctx.restore();}}});projectiles.forEach(drawProjectile);
  drawShip(time); requestAnimationFrame(frame);
}

addEventListener("resize", resize);
addEventListener("keydown", e => { if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault(); keys[e.key.length===1?e.key.toLowerCase():e.key]=true;if(e.key===" ")fireCannons(); });
addEventListener("keyup", e => keys[e.key.length===1?e.key.toLowerCase():e.key]=false);
document.querySelectorAll("[data-control]").forEach(button => {
  const map={left:"ArrowLeft",right:"ArrowRight",forward:"ArrowUp",fire:" "}, key=map[button.dataset.control];
  button.addEventListener("pointerdown",e=>{e.preventDefault();keys[key]=true;button.setPointerCapture(e.pointerId)});
  button.addEventListener("pointerup",()=>keys[key]=false); button.addEventListener("pointercancel",()=>keys[key]=false);
});
$("setSail").addEventListener("click",()=>{state.started=true;$("startScreen").classList.add("hidden");playTone(330);});
$("eventClose").addEventListener("click",()=>{if(state.won||state.lost)location.reload();else $("eventCard").classList.remove("show");});
$("soundButton").addEventListener("click",()=>{state.sound=!state.sound;$("soundButton").style.opacity=state.sound?1:.35;if(state.sound)playTone(440);});

resize(); updateUI(); requestAnimationFrame(frame);
