/**
 * Salesfloor — WebRTC Signaling Server
 * Handles: peer discovery, offer/answer/ICE exchange, room state, chat
 * Run: node server.js
 */

const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// ── HTTP server (serves static files) ──────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── WebSocket signaling server ──────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

// Room state: { roomId -> Map<socketId, peerInfo> }
const rooms = new Map();

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function getRoomPeers(roomId) {
  return rooms.get(roomId) || new Map();
}

function broadcast(roomId, message, excludeId = null) {
  const peers = getRoomPeers(roomId);
  const data = JSON.stringify(message);
  peers.forEach((peer, id) => {
    if (id !== excludeId && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  });
}

function sendTo(roomId, targetId, message) {
  const peers = getRoomPeers(roomId);
  const target = peers.get(targetId);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify(message));
  }
}

function getRoomSnapshot(roomId) {
  const peers = getRoomPeers(roomId);
  const list = [];
  peers.forEach((peer, id) => {
    list.push({ id, name: peer.name, role: peer.role, status: peer.status, muted: peer.muted, camOff: peer.camOff });
  });
  return list;
}

wss.on('connection', (ws) => {
  const socketId = generateId();
  let myRoomId = null;

  console.log(`[+] connected: ${socketId}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── JOIN ROOM ──────────────────────────────────────────────────────────
      case 'join': {
        const roomId = msg.room || 'bdr-floor';
        myRoomId = roomId;

        if (!rooms.has(roomId)) rooms.set(roomId, new Map());
        const room = rooms.get(roomId);

        if (room.size >= 12) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 12)' }));
          return;
        }

        room.set(socketId, {
          ws,
          name: msg.name || 'Unknown',
          role: msg.role || 'BDR',
          status: 'available',
          muted: false,
          camOff: false,
        });

        // Send this peer their own ID + current room snapshot
        ws.send(JSON.stringify({
          type: 'joined',
          id: socketId,
          roomId,
          peers: getRoomSnapshot(roomId).filter(p => p.id !== socketId),
        }));

        // Notify others
        broadcast(roomId, {
          type: 'peer-joined',
          id: socketId,
          name: msg.name,
          role: msg.role,
          status: 'available',
          muted: false,
          camOff: false,
        }, socketId);

        console.log(`[room:${roomId}] ${msg.name} joined (${room.size} in room)`);
        break;
      }

      // ── WEBRTC SIGNALING ───────────────────────────────────────────────────
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        sendTo(myRoomId, msg.target, {
          type: msg.type,
          from: socketId,
          payload: msg.payload,
        });
        break;
      }

      // ── STATUS UPDATE ──────────────────────────────────────────────────────
      case 'status-update': {
        const room = rooms.get(myRoomId);
        if (!room) break;
        const peer = room.get(socketId);
        if (!peer) break;

        if (msg.status !== undefined) peer.status = msg.status;
        if (msg.muted !== undefined) peer.muted = msg.muted;
        if (msg.camOff !== undefined) peer.camOff = msg.camOff;

        broadcast(myRoomId, {
          type: 'peer-status',
          id: socketId,
          status: peer.status,
          muted: peer.muted,
          camOff: peer.camOff,
        }, socketId);
        break;
      }

      // ── CHAT ───────────────────────────────────────────────────────────────
      case 'chat': {
        const room = rooms.get(myRoomId);
        if (!room) break;
        const peer = room.get(socketId);
        broadcast(myRoomId, {
          type: 'chat',
          from: socketId,
          name: peer ? peer.name : 'Unknown',
          text: String(msg.text).slice(0, 500),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (myRoomId) {
      const room = rooms.get(myRoomId);
      if (room) {
        const peer = room.get(socketId);
        room.delete(socketId);
        if (room.size === 0) rooms.delete(myRoomId);

        broadcast(myRoomId, { type: 'peer-left', id: socketId, name: peer?.name });
        console.log(`[-] ${peer?.name || socketId} left room ${myRoomId} (${room.size} remaining)`);
      }
    }
  });

  ws.on('error', (e) => console.error(`[ws error] ${socketId}:`, e.message));
});

httpServer.listen(PORT, () => {
  console.log(`\n✅ Salesfloor server running at http://localhost:${PORT}\n`);
});
