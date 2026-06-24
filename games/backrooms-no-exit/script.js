const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d", { alpha: false });
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const FOV = Math.PI / 2.85;
const MAX_DEPTH = 30;
const keys = {};
const player = { x: 2.5, y: 2.5, angle: .12, pitch: 0, moving: 0, bob: 0 };
let width = 0, height = 0, renderWidth = 0, renderHeight = 0, last = 0, started = false;
let audioContext, humGain, touchLookStart = null;

function hash(x, y, salt = 0) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 69069);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Six-unit rooms share deterministic doorways, so the maze has no finite edge
// and always remains connected to its neighboring rooms.
function isWall(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  const mx = ((tx % 6) + 6) % 6, my = ((ty % 6) + 6) % 6;
  const roomX = Math.floor(tx / 6), roomY = Math.floor(ty / 6);
  if (mx === 0) {
    const doorway = 1 + Math.floor(hash(roomX, roomY, 11) * 4);
    if (my !== doorway) return true;
  }
  if (my === 0) {
    const doorway = 1 + Math.floor(hash(roomX, roomY, 29) * 4);
    if (mx !== doorway) return true;
  }
  // Partial partitions make each room feel different without sealing it shut.
  if (mx === 3 && my > 1 && my < 5 && hash(roomX, roomY, 47) > .55) return true;
  if (my === 3 && mx > 1 && mx < 5 && hash(roomX, roomY, 71) > .58) return true;
  return false;
}

function resize() {
  width = innerWidth; height = innerHeight;
  const scale = width > 1000 ? .58 : .72;
  renderWidth = Math.max(360, Math.floor(width * scale));
  renderHeight = Math.max(240, Math.floor(height * scale));
  canvas.width = renderWidth; canvas.height = renderHeight;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  ctx.imageSmoothingEnabled = true;
}

function castRay(angle) {
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
  const deltaX = Math.abs(1 / (dirX || .00001)), deltaY = Math.abs(1 / (dirY || .00001));
  const stepX = dirX < 0 ? -1 : 1, stepY = dirY < 0 ? -1 : 1;
  let sideX = dirX < 0 ? (player.x - mapX) * deltaX : (mapX + 1 - player.x) * deltaX;
  let sideY = dirY < 0 ? (player.y - mapY) * deltaY : (mapY + 1 - player.y) * deltaY;
  let side = 0, distance = 0;
  while (distance < MAX_DEPTH) {
    if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
    else { sideY += deltaY; mapY += stepY; side = 1; }
    if (isWall(mapX, mapY)) break;
    distance = side === 0 ? sideX - deltaX : sideY - deltaY;
  }
  distance = side === 0 ? sideX - deltaX : sideY - deltaY;
  const hit = side === 0 ? player.y + distance * dirY : player.x + distance * dirX;
  return { distance: Math.min(distance, MAX_DEPTH), side, texture: hit - Math.floor(hit), mapX, mapY };
}

function render(time) {
  const horizon = Math.floor(renderHeight * (.5 + player.pitch * .35) + Math.sin(player.bob) * 2.2);
  ctx.fillStyle = "#8e8956"; ctx.fillRect(0, 0, renderWidth, Math.max(0, horizon));
  ctx.fillStyle = "#5c5432"; ctx.fillRect(0, horizon, renderWidth, renderHeight - horizon);
  drawSurfaces(horizon, time);
  for (let x = 0; x < renderWidth; x++) {
    const camera = x / renderWidth - .5;
    const angle = player.angle + camera * FOV;
    const ray = castRay(angle);
    const corrected = ray.distance * Math.cos(camera * FOV);
    const wallHeight = Math.min(renderHeight * 2.2, renderHeight / Math.max(.15, corrected));
    const top = Math.floor(horizon - wallHeight / 2), bottom = Math.ceil(horizon + wallHeight / 2);
    const light = Math.max(.2, 1 - corrected / 25) * (ray.side ? .82 : 1);
    const stripe = Math.sin(ray.texture * Math.PI * 18) * .5 + .5;
    const chevron = ((Math.floor(ray.texture * 10) + Math.floor((top + bottom) / 38)) % 2) * 7;
    const r = Math.floor((178 + stripe * 10 + chevron) * light);
    const g = Math.floor((169 + stripe * 9 + chevron) * light);
    const b = Math.floor((91 + stripe * 5) * light);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, top, 1, bottom - top);
    if ((Math.floor(ray.texture * 24) % 12) === 0) {
      ctx.fillStyle = `rgba(74,67,29,${.1 * light})`; ctx.fillRect(x, top, 1, bottom - top);
    }
    ctx.fillStyle = `rgba(41,36,13,${Math.min(.35, corrected / 85)})`; ctx.fillRect(x, top, 1, bottom - top);
  }
  const haze = ctx.createRadialGradient(renderWidth/2,horizon,0,renderWidth/2,horizon,renderWidth*.7);
  haze.addColorStop(0,"rgba(239,229,150,.04)");haze.addColorStop(1,"rgba(42,38,14,.18)");ctx.fillStyle=haze;ctx.fillRect(0,0,renderWidth,renderHeight);
}

function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }

function drawSurfaces(horizon, time) {
  const dirX = Math.cos(player.angle), dirY = Math.sin(player.angle);
  const planeScale = Math.tan(FOV / 2);
  const planeX = -dirY * planeScale, planeY = dirX * planeScale;
  const leftX = dirX - planeX, leftY = dirY - planeY;
  const rightX = dirX + planeX, rightY = dirY + planeY;
  const step = 2;

  // Floor and ceiling use the same projected world point for each distance row.
  // The wall height equation uses this same projection, so both surfaces meet it exactly.
  for (let offset = 1; offset < renderHeight; offset += step) {
    const floorY = horizon + offset;
    const ceilingY = horizon - offset;
    if (floorY >= renderHeight && ceilingY < 0) break;
    const distance = renderHeight / (2 * offset);
    const worldStepX = distance * (rightX - leftX) / renderWidth;
    const worldStepY = distance * (rightY - leftY) / renderWidth;
    let worldX = player.x + distance * leftX;
    let worldY = player.y + distance * leftY;
    const fade = Math.max(.28, 1 - distance / 34);

    for (let x = 0; x < renderWidth; x += step) {
      const tileX = Math.floor(worldX / 2), tileY = Math.floor(worldY / 2);
      const u = mod(worldX, 2), v = mod(worldY, 2);

      if (floorY < renderHeight) {
        const carpetNoise = hash(Math.floor(worldX * 4), Math.floor(worldY * 4), 101) * 9;
        const carpetSeam = u < .035 || v < .035;
        const base = carpetSeam ? 59 : 91 + carpetNoise;
        ctx.fillStyle = `rgb(${base * fade},${(base - 8) * fade},${(base - 39) * fade})`;
        ctx.fillRect(x, floorY, step, step);
      }

      if (ceilingY >= 0) {
        const gridSeam = u < .055 || v < .055;
        const hasLight = hash(tileX, tileY, 137) > .52;
        const inPanel = hasLight && u > .26 && u < 1.74 && v > .67 && v < 1.33;
        const flicker = hash(tileX, tileY, Math.floor(time / 140)) > .018;
        let r = gridSeam ? 78 : 154;
        let g = gridSeam ? 76 : 151;
        let b = gridSeam ? 49 : 91;
        if (inPanel) {
          if (flicker) { r = 248; g = 244; b = 187; }
          else { r = 76; g = 73; b = 43; }
        }
        const ceilingFade = Math.max(.42, fade);
        ctx.fillStyle = `rgb(${r * ceilingFade},${g * ceilingFade},${b * ceilingFade})`;
        ctx.fillRect(x, ceilingY, step, step);
      }
      worldX += worldStepX * step;
      worldY += worldStepY * step;
    }
  }
}

function canMove(x, y) {
  const radius = .2;
  return !isWall(x-radius,y-radius)&&!isWall(x+radius,y-radius)&&!isWall(x-radius,y+radius)&&!isWall(x+radius,y+radius);
}

function update(dt) {
  if (!started) return;
  let forward = (keys.ArrowUp || keys.w ? 1 : 0) - (keys.ArrowDown || keys.s ? 1 : 0);
  let strafe = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
  const length = Math.hypot(forward, strafe) || 1; forward /= length; strafe /= length;
  const speed = 2.25 * dt;
  const dx = (Math.cos(player.angle) * forward + Math.cos(player.angle + Math.PI/2) * strafe) * speed;
  const dy = (Math.sin(player.angle) * forward + Math.sin(player.angle + Math.PI/2) * strafe) * speed;
  if (canMove(player.x + dx, player.y)) player.x += dx;
  if (canMove(player.x, player.y + dy)) player.y += dy;
  player.moving += ((Math.abs(forward)+Math.abs(strafe)>0 ? 1 : 0) - player.moving) * Math.min(1,dt*8);
  if (player.moving > .1) player.bob += dt * 8.4;
  $("coordinates").textContent = `${player.x.toFixed(1)} · ${player.y.toFixed(1)}`;
  $("motionLabel").textContent = player.moving > .3 ? "WALKING" : "STANDING STILL";
  $("motionBar").style.width = `${player.moving * 100}%`;
}

function startHum() {
  if (audioContext) { audioContext.resume(); return; }
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator(); humGain = audioContext.createGain();
  const wobble = audioContext.createOscillator(), wobbleGain = audioContext.createGain();
  oscillator.type = "sawtooth"; oscillator.frequency.value = 60; humGain.gain.value = .018;
  wobble.frequency.value = .35; wobbleGain.gain.value = 2; wobble.connect(wobbleGain).connect(oscillator.frequency);
  oscillator.connect(humGain).connect(audioContext.destination); oscillator.start(); wobble.start();
}

function enter() {
  started = true; $("intro").classList.add("hidden"); startHum();
  if (matchMedia("(pointer: fine)").matches) canvas.requestPointerLock();
}

function frame(time) {
  const dt = Math.min(.04,(time-last)/1000||0);last=time;update(dt);render(time);requestAnimationFrame(frame);
}

addEventListener("resize",resize);
addEventListener("keydown",e=>{if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key))e.preventDefault();keys[e.key.length===1?e.key.toLowerCase():e.key]=true;});
addEventListener("keyup",e=>keys[e.key.length===1?e.key.toLowerCase():e.key]=false);
addEventListener("mousemove",e=>{if(document.pointerLockElement===canvas){player.angle=(player.angle+e.movementX*.0024+TAU)%TAU;player.pitch=Math.max(-.48,Math.min(.48,player.pitch-e.movementY*.0018));}});
document.addEventListener("pointerlockchange",()=>{$("pauseCard").classList.toggle("show",started&&document.pointerLockElement!==canvas);});
canvas.addEventListener("click",()=>{if(started&&document.pointerLockElement!==canvas)canvas.requestPointerLock();});
$("game").addEventListener("click",e=>{if(started&&e.target.closest(".pause-card"))canvas.requestPointerLock();});
$("enterButton").addEventListener("click",enter);
$("soundToggle").addEventListener("click",e=>{e.stopPropagation();startHum();const on=humGain.gain.value>0;humGain.gain.setTargetAtTime(on?0:.018,audioContext.currentTime,.05);$("soundToggle").textContent=`SOUND: ${on?"OFF":"ON"}`;});

document.querySelectorAll("[data-key]").forEach(button=>{const map={forward:"ArrowUp",back:"ArrowDown",left:"ArrowLeft",right:"ArrowRight"},key=map[button.dataset.key];button.addEventListener("pointerdown",e=>{e.preventDefault();keys[key]=true;button.setPointerCapture(e.pointerId)});button.addEventListener("pointerup",()=>keys[key]=false);button.addEventListener("pointercancel",()=>keys[key]=false);});
$("lookPad").addEventListener("pointerdown",e=>{touchLookStart={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId)});
$("lookPad").addEventListener("pointermove",e=>{if(!touchLookStart)return;player.angle=(player.angle+(e.clientX-touchLookStart.x)*.008+TAU)%TAU;player.pitch=Math.max(-.48,Math.min(.48,player.pitch-(e.clientY-touchLookStart.y)*.005));touchLookStart={x:e.clientX,y:e.clientY};});
$("lookPad").addEventListener("pointerup",()=>touchLookStart=null);

resize();requestAnimationFrame(frame);
