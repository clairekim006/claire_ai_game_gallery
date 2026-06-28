const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 4191;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const rooms = new Map();

function roomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}

function playerId() {
  return crypto.randomBytes(4).toString("hex");
}

function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function publicRoom(room) {
  return {
    type: "state",
    code: room.code,
    phase: room.phase,
    ends: room.ends,
    map: room.map,
    players: [...room.players.values()].map(({ ws, ...player }) => player)
  };
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message = publicRoom(room)) {
  const dead = [];
  for (const [id, player] of room.players) {
    if (player.ws.readyState === player.ws.OPEN) {
      send(player.ws, message);
    } else {
      dead.push(id);
    }
  }
  for (const id of dead) room.players.delete(id);
}

function scheduleRoundTimers(room) {
  const token = crypto.randomBytes(8).toString("hex");
  room.timerToken = token;

  setTimeout(() => {
    if (room.timerToken !== token || room.phase !== "hide") return;
    for (const player of room.players.values()) {
      if (player.role === "seeker") player.x = 0, player.y = 0.05, player.z = 10;
    }
    room.phase = "hunt";
    room.ends = Date.now() / 1000 + 90;
    broadcast(room);

    setTimeout(() => {
      if (room.timerToken !== token || room.phase !== "hunt") return;
      room.phase = "results";
      room.ends = 0;
      broadcast(room);
    }, 90_000);
  }, 25_000);
}

function createRoom() {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = {
    code,
    phase: "lobby",
    ends: 0,
    map: "farm",
    players: new Map(),
    timerToken: null
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(room, ws, id, message) {
  const player = {
    id,
    name: String(message.name || "Player").slice(0, 14),
    x: -12 + room.players.size * 2,
    y: 0.45,
    z: -8,
    angle: 0,
    role: "hider",
    tagged: false,
    paint: [],
    ws
  };
  room.players.set(id, player);
  send(ws, { type: "welcome", id });
  broadcast(room);
}

function handleMessage(context, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    send(context.ws, { type: "error", message: "Invalid message" });
    return;
  }

  const kind = message.type;

  if (kind === "create" || kind === "join") {
    const code = String(message.code || "").toUpperCase();
    const room = kind === "create" ? createRoom() : rooms.get(code);
    if (!room) {
      send(context.ws, { type: "error", message: "Room not found" });
      return;
    }
    context.room = room;
    joinRoom(room, context.ws, context.id, message);
    return;
  }

  const room = context.room;
  if (!room || !room.players.has(context.id)) return;
  const player = room.players.get(context.id);

  if (kind === "move") {
    player.x = clamp(safeNumber(message.x, player.x), -19, 19);
    player.y = clamp(safeNumber(message.y, player.y), 0.05, 10.5);
    player.z = clamp(safeNumber(message.z, player.z), -13, 24);
    player.angle = safeNumber(message.angle, player.angle);
    broadcast(room);
    return;
  }

  if (kind === "paint" && room.phase === "hide" && player.role === "hider") {
    player.paint = [...player.paint, message.stroke].slice(-80);
    broadcast(room);
    return;
  }

  if (kind === "settings" && [...room.players.keys()][0] === context.id) {
    if (["farm", "school", "library", "museum"].includes(message.map)) {
      room.map = message.map;
    }
    broadcast(room);
    return;
  }

  if (kind === "start" && ["lobby", "results"].includes(room.phase) && room.players.size >= 2) {
    const ids = [...room.players.keys()];
    const seekerId = ids[Math.floor(Math.random() * ids.length)];
    room.phase = "hide";
    room.ends = Date.now() / 1000 + 25;
    let index = 0;
    for (const current of room.players.values()) {
      current.role = current.id === seekerId ? "seeker" : "hider";
      current.tagged = false;
      current.paint = [];
      current.x = current.id === seekerId ? 0 : 7 + index * 1.2;
      current.y = 0.05;
      current.z = current.id === seekerId ? 18 : -12;
      index += 1;
    }
    broadcast(room);
    scheduleRoundTimers(room);
    return;
  }

  if (kind === "shoot" && room.phase === "hunt" && player.role === "seeker") {
    let hit = null;
    const target = room.players.get(message.target);
    if (target && target.role === "hider" && !target.tagged) {
      target.tagged = true;
      hit = target.id;
    }
    broadcast(room, { type: "shot", by: context.id, hit });
    broadcast(room);
    const hidersRemain = [...room.players.values()].some(current => current.role === "hider" && !current.tagged);
    if (!hidersRemain) {
      room.phase = "results";
      room.ends = 0;
      broadcast(room);
    }
  }
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Color Caper WebSocket server is running.\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, request) => {
  const origin = request.headers.origin || "";
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
    ws.close(1008, "Origin not allowed");
    return;
  }

  const context = { id: playerId(), room: null, ws };

  ws.on("message", raw => handleMessage(context, raw.toString()));
  ws.on("close", () => {
    if (!context.room) return;
    context.room.players.delete(context.id);
    broadcast(context.room);
    if (context.room.players.size === 0) {
      rooms.delete(context.room.code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Color Caper WebSocket server listening on port ${PORT}`);
});
