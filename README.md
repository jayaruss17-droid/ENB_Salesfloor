# 🖥️ Salesfloor — Virtual BDR Floor

A self-hosted virtual salesfloor with real-time video, audio, team chat, and auto-mute when on a prospect call.

---

## What's included

| Feature | Details |
|---|---|
| 🎥 Live video | WebRTC peer-to-peer, direct browser-to-browser |
| 🎤 Mic + auto-mute | One click "Go on call" mutes you instantly |
| 💬 Team chat | Real-time via WebSocket |
| 🔴 Status badges | Available / On Call / Away per rep |
| 👥 Up to 12 users | Enforced in the server |

---

## Quick start (local, 5 minutes)

### Prerequisites
- [Node.js](https://nodejs.org) v16 or higher

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
# http://localhost:3000
```

Share `http://YOUR_LOCAL_IP:3000` with teammates on the same network (e.g. `http://192.168.1.42:3000`).

---

## Deploy to the internet (so your whole team can use it)

### Option A — Railway (easiest, free tier available)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway auto-detects Node.js and runs `npm start`
4. Your URL will be something like `https://salesfloor-production.up.railway.app`

> ⚠️ Railway requires HTTPS, which means WebRTC will work great (browsers require HTTPS for camera/mic access on non-localhost).

### Option B — Render (also free tier)

1. Push to GitHub
2. [render.com](https://render.com) → New Web Service → Connect repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Done — you get a `https://` URL

### Option C — VPS (DigitalOcean, Linode, etc.)

```bash
# On your server
git clone YOUR_REPO salesfloor
cd salesfloor
npm install

# Install PM2 to keep it running
npm install -g pm2
pm2 start server.js --name salesfloor
pm2 save

# Optionally set up nginx as a reverse proxy for port 80/443
```

---

## How it works

```
Browser A  <──WebSocket──>  Node.js Server  <──WebSocket──>  Browser B
                               (signaling)
Browser A  <════ WebRTC peer-to-peer video/audio ═════════>  Browser B
```

- The **Node.js server** only handles signaling (who's in the room, offer/answer/ICE exchange)
- After handshake, **video and audio stream directly** between browsers (peer-to-peer)
- The server never touches your video data — it's end-to-end between peers
- Uses **Google's public STUN servers** (free, no setup)

---

## Customisation

### Change the room name / team name
In `public/index.html`, find:
```js
const ROOM_ID = 'bdr-floor';
```
Change to whatever you like. Multiple rooms are supported simultaneously.

### Change the max users
In `server.js`, find:
```js
if (room.size >= 12) {
```
Change `12` to your preferred max.

### Add a TURN server (for stricter corporate networks)
Some firewalls block direct peer connections. If reps can't see each other's video, add a TURN server to `ICE_SERVERS` in `public/index.html`:
```js
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:YOUR_TURN_SERVER:3478',
    username: 'YOUR_USERNAME',
    credential: 'YOUR_PASSWORD',
  }
];
```
Free TURN: [Metered](https://www.metered.ca/tools/openrelay/) has a free tier.

---

## File structure

```
salesfloor/
├── server.js        ← Node.js WebSocket signaling server
├── package.json
├── README.md
└── public/
    └── index.html   ← Full frontend (single file)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Camera/mic blocked | Click the 🔒 icon in browser URL bar → Allow camera and microphone |
| Can't see other reps' video | Check you're on the same URL. If on VPN/strict firewall, add a TURN server |
| "Could not reach server" | Make sure `npm start` is running and you're on the right port |
| Works locally but not deployed | Ensure your host gives you an HTTPS URL (required for camera access) |
