
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      game: "NEON VECTOR",
      status: "online",
      multiplayer: true
    }));
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();
const queue = [];

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function roomState(room) {
  return {
    type: "room",
    code: room.code,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      ready: p.ready,
      x: p.x,
      y: p.y,
      z: p.z
    }))
  };
}

function broadcast(room, data) {
  for (const player of room.players.values()) {
    send(player.ws, data);
  }
}

function createRoom(privateRoom = true) {
  let code;

  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));

  const room = {
    code,
    privateRoom,
    players: new Map()
  };

  rooms.set(code, room);
  return room;
}

function addPlayer(room, ws) {
  if (room.players.size >= 4) {
    send(ws, { type: "error", message: "Squad is full" });
    return false;
  }

  const player = {
    id: crypto.randomUUID(),
    ws,
    ready: false,
    x: 0,
    y: 0,
    z: 0
  };

  room.players.set(player.id, player);
  ws.playerId = player.id;
  ws.roomCode = room.code;

  broadcast(room, roomState(room));
  return true;
}

function leaveRoom(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  room.players.delete(ws.playerId);

  if (room.players.size === 0) {
    rooms.delete(room.code);
  } else {
    broadcast(room, roomState(room));
  }

  ws.roomCode = null;
  ws.playerId = null;
}

wss.on("connection", ws => {
  send(ws, { type: "connected", message: "Welcome to NEON VECTOR" });

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "Invalid message" });
    }

    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "create") {
      leaveRoom(ws);
      const room = createRoom(true);
      addPlayer(room, ws);
      return send(ws, {
        type: "created",
        code: room.code
      });
    }

    if (msg.type === "join") {
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        return send(ws, { type: "error", message: "Room not found" });
      }

      leaveRoom(ws);

      if (addPlayer(room, ws)) {
        broadcast(room, roomState(room));
      }
      return;
    }

    if (msg.type === "quick") {
      leaveRoom(ws);

      let room = [...rooms.values()].find(r =>
        !r.privateRoom && r.players.size < 4
      );

      if (!room) room = createRoom(false);

      addPlayer(room, ws);
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) {
      return send(ws, { type: "error", message: "Join a squad first" });
    }

    const player = room.players.get(ws.playerId);
    if (!player) return;

    if (msg.type === "ready") {
      player.ready = Boolean(msg.ready);
      broadcast(room, roomState(room));
    }

    if (msg.type === "position") {
      for (const key of ["x", "y", "z"]) {
        if (typeof msg[key] === "number" && Number.isFinite(msg[key])) {
          player[key] = Math.max(-100000, Math.min(100000, msg[key]));
        }
      }

      broadcast(room, {
        type: "position",
        id: player.id,
        x: player.x,
        y: player.y,
        z: player.z
      });
    }
  });

  ws.on("close", () => leaveRoom(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NEON VECTOR server running on port ${PORT}`);
});
