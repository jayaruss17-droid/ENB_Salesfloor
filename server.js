/**
 * Salesfloor — WebRTC Signaling Server
 * Supports: multiple rooms, room directory, create/switch rooms, permanent BDR floor
 */

const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const PERMANENT_ROOM_ID   = 'bdr-floor';
const PERMANENT_ROOM_NAME = 'BDR Floor';
const MAX_ROOM_SIZE = 20;

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── Room state ────────────────────────────────────────────────────────────────
const rooms = new Map();

// Permanent BDR floor always exists
rooms.set(PERMANENT_ROOM_ID, {
  name: PERMANENT_ROOM_NAME,
  peers: new Map(),
  permanent: true,
});

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function getRoomDirectory() {
  const dir = [];
  rooms.forEach((room, id) => {
    dir.push({ id, name: room.name, count: room.peers.size, permanent: !!room.permanent });
  });
  dir.sort((a, b) => (b.permanent ? 1 : 0) - (a.permanent ? 1 : 0));
  return dir;
}

function broadcastDirectory() {
  const dir = getRoomDirectory();
  const data = JSON.stringify({ type: 'room-directory', rooms: dir });
  rooms.forEach((room) => {
    room.peers.forEach((peer) => {
      if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(data);
    });
  });
}

function getRoomSnapshot(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const list = [];
  room.peers.forEach((peer, id) => {
    list.push({ id, name: peer.name, role: peer.role, status: peer.status, muted: peer.muted, camOff: peer.camOff });
  });
  return list;
}

function broadcast(roomId, message, excludeId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(message);
  room.peers.forEach((peer, id) => {
    if (id !== excludeId && peer.ws.readyState === WebSocket.OPEN) peer.ws.send(data);
  });
}

function sendTo(roomId, targetId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  const target = room.peers.get(targetId);
  if (target && target.ws.readyState === WebSocket.OPEN) target.ws.send(JSON.stringify(message));
}

function leaveRoom(socketId, roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const peer = room.peers.get(socketId);
  room.peers.delete(socketId);
  if (room.peers.size === 0 && !room.permanent) rooms.delete(roomId);
  broadcast(roomId, { type: 'peer-left', id: socketId, name: peer?.name });
  broadcastDirectory();
  return peer;
}

// ── WebSocket signaling ───────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
  const socketId = generateId();
  let myRoomId = null;
  let myName   = 'Unknown';
  let myRole   = 'BDR';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── JOIN / SWITCH ROOM ─────────────────────────────────────────────────
      case 'join': {
        const roomId = msg.room || PERMANENT_ROOM_ID;

        // Leave previous room if switching
        if (myRoomId && myRoomId !== roomId) {
          leaveRoom(socketId, myRoomId);
        }

        myRoomId = roomId;
        if (msg.name) myName = msg.name;
        if (msg.role) myRole = msg.role;

        if (!rooms.has(roomId)) {
          rooms.set(roomId, { name: msg.roomName || roomId, peers: new Map(), permanent: false });
        }
        const room = rooms.get(roomId);

        if (room.peers.size >= MAX_ROOM_SIZE) {
          ws.send(JSON.stringify({ type: 'error', message: `Room is full (max ${MAX_ROOM_SIZE})` }));
          return;
        }

        room.peers.set(socketId, { ws, name: myName, role: myRole, status: 'available', muted: false, camOff: false });

        ws.send(JSON.stringify({
          type: 'joined',
          id: socketId,
          roomId,
          roomName: room.name,
          peers: getRoomSnapshot(roomId).filter(p => p.id !== socketId),
          rooms: getRoomDirectory(),
        }));

        broadcast(roomId, {
          type: 'peer-joined',
          id: socketId, name: myName, role: myRole,
          status: 'available', muted: false, camOff: false,
        }, socketId);

        broadcastDirectory();
        console.log(`[+] ${myName} joined "${room.name}" (${room.peers.size} in room)`);
        break;
      }

      // ── CREATE ROOM ────────────────────────────────────────────────────────
      case 'create-room': {
        const newId   = 'room-' + generateId();
        const newName = String(msg.name || 'New Room').slice(0, 40);
        rooms.set(newId, { name: newName, peers: new Map(), permanent: false });
        broadcastDirectory();
        ws.send(JSON.stringify({ type: 'room-created', roomId: newId, roomName: newName }));
        console.log(`[room] Created "${newName}" (${newId})`);
        break;
      }

      // ── WEBRTC SIGNALING ───────────────────────────────────────────────────
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        sendTo(myRoomId, msg.target, { type: msg.type, from: socketId, payload: msg.payload });
        break;
      }

      // ── STATUS UPDATE ──────────────────────────────────────────────────────
      case 'status-update': {
        const room = rooms.get(myRoomId);
        if (!room) break;
        const peer = room.peers.get(socketId);
        if (!peer) break;
        if (msg.status !== undefined) peer.status = msg.status;
        if (msg.muted  !== undefined) peer.muted  = msg.muted;
        if (msg.camOff !== undefined) peer.camOff = msg.camOff;
        broadcast(myRoomId, {
          type: 'peer-status', id: socketId,
          status: peer.status, muted: peer.muted, camOff: peer.camOff,
        }, socketId);
        break;
      }

      // ── CHAT ───────────────────────────────────────────────────────────────
      case 'chat': {
        const room = rooms.get(myRoomId);
        if (!room) break;
        const peer = room.peers.get(socketId);
        broadcast(myRoomId, {
          type: 'chat', from: socketId,
          name: peer?.name || myName,
          text: String(msg.text).slice(0, 500),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
        break;
      }
    }
  });

  ws.on('close', () => { if (myRoomId) leaveRoom(socketId, myRoomId); });
  ws.on('error', (e) => console.error(`[ws error] ${socketId}:`, e.message));
});

httpServer.listen(PORT, () => {
  console.log(`\n✅ Salesfloor server running at http://localhost:${PORT}\n`);
});
