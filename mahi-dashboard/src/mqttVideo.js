// Node.js port of the provided Python HEVC NAL reassembly script
// Usage: npm install mqtt uuid
// Then: node src/mqttVideo.js

const mqtt = require('mqtt');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// CONFIG
const BROKER = process.env.MQTT_BROKER || 'mqtt://192.168.0.113';
const PORT = process.env.MQTT_PORT ? parseInt(process.env.MQTT_PORT, 10) : 1883;
const OUTPUT_FILE = path.join(process.cwd(), `capture_${new Date().toISOString().replace(/[:.]/g,'-')}.mp4`);

// GLOBALS
const MY_UUID = uuidv4();
const CONTROL_TOPIC = `${MY_UUID}/video/status_external`;
let discoveredTopic = null;
let cameraName = null;
let streamStarted = false;
let running = true;

const NAL_QUEUE_MAX = 2000;
const nalQueue = []; // simple FIFO
const parameterSets = []; // keep unique VPS/SPS/PPS buffers
let totalWritten = 0;
let dropped = 0;

console.log('[OUTPUT]', OUTPUT_FILE);

// start ffmpeg
const ffmpeg = spawn('ffmpeg', [
  '-y',
  '-loglevel', 'warning',
  '-fflags', 'nobuffer',
  '-flags', 'low_delay',
  '-f', 'hevc',
  '-i', '-',
  '-an',
  '-c:v', 'copy',
  '-movflags', '+faststart+frag_keyframe+empty_moov',
  OUTPUT_FILE
], { stdio: ['pipe', 'inherit', 'inherit'] });

ffmpeg.stdin.on('error', (err) => {
  console.error('[ERROR] ffmpeg stdin error', err && err.message);
  running = false;
});

function enableStream(client) {
  if (!cameraName) return;
  const payload = { source: cameraName, periodicdr: true };
  client.publish(CONTROL_TOPIC, JSON.stringify(payload), { qos: 1 });
  console.log(`[ENABLE] Stream requested for ${cameraName}`);
}

// writer loop: periodically flush buffer to ffmpeg
let writeBuffer = [];
function flushWriter() {
  if (!running) return;
  if (writeBuffer.length === 0) return;
  try {
    const buf = Buffer.concat(writeBuffer);
    ffmpeg.stdin.write(buf);
    writeBuffer = [];
  } catch (e) {
    console.error('[ERROR] ffmpeg pipe closed', e && e.message);
    running = false;
  }
}

setInterval(() => {
  // move items from nalQueue to writeBuffer
  while (nalQueue.length > 0) {
    const nal = nalQueue.shift();
    if (nal === null) { running = false; break; }
    writeBuffer.push(Buffer.from([0,0,0,1]));
    writeBuffer.push(nal);
    totalWritten += 1;
  }
  flushWriter();
  if (totalWritten > 0 && totalWritten % 500 === 0) {
    console.log(`[STATS] Written=${totalWritten} Queue=${nalQueue.length} Dropped=${dropped}`);
  }
}, 50);

function sendNal(nal) {
  if (!running) return;
  if (nalQueue.length >= NAL_QUEUE_MAX) {
    dropped += 1;
    if (dropped % 50 === 1) console.warn(`[WARN] Dropped ${dropped} frames`);
    return;
  }
  nalQueue.push(Buffer.from(nal));
}

// MQTT setup
const client = mqtt.connect(BROKER, { port: PORT });

client.on('connect', () => {
  console.log('[MQTT] Connected');
  client.subscribe('#', (err) => { if (err) console.error('[MQTT] subscribe error', err); });
});

client.on('message', (topic, payload) => {
  try {
    // discovery
    if (!discoveredTopic) {
      if (topic.includes('/video/rtsp/') && topic.includes('/nal/')) {
        discoveredTopic = topic;
        console.log('[DISCOVER] Video topic:', discoveredTopic);
        const parts = topic.split('/');
        cameraName = parts[3] || 'camera';
        console.log('[DISCOVER] Camera:', cameraName);
        enableStream(client);
        const base = discoveredTopic.substring(0, discoveredTopic.lastIndexOf('/'));
        client.unsubscribe('#');
        client.subscribe(`${base}/+`, (err) => { if (!err) console.log(`[SUBSCRIBE] ${base}/+`); });
        return;
      }
    }

    if (!discoveredTopic) return;

    const base = discoveredTopic.substring(0, discoveredTopic.lastIndexOf('/'));
    if (!topic.startsWith(base + '/')) return;

    if (!Buffer.isBuffer(payload) || payload.length < 12) return;

    // strip trailing 8-byte timestamp
    const nal = payload.slice(0, payload.length - 8);
    if (nal.length < 2) return;

    const last = topic.split('/').pop();
    const nalType = parseInt(last, 10);
    if (isNaN(nalType)) return;

    // store VPS/SPS/PPS -> types 32,33,34
    if ([32,33,34].includes(nalType)) {
      const found = parameterSets.some(p => p.equals(nal));
      if (!found) parameterSets.push(Buffer.from(nal));
    }

    // wait for first IDR (type 20)
    if (!streamStarted) {
      if (nalType === 20) {
        console.log('[STREAM] First IDR frame');
        for (const p of parameterSets) sendNal(p);
        streamStarted = true;
      } else {
        return;
      }
    }

    sendNal(nal);
  } catch (e) {
    console.error('[ERROR] on message', e && e.message);
  }
});

// keepalive
const keepaliveTimer = setInterval(() => {
  try { enableStream(client); } catch (e) {}
}, 30_000);

// graceful shutdown
function shutdown() {
  if (!running) return;
  console.log('\n[SHUTDOWN] Finalizing MP4...');
  running = false;
  nalQueue.push(null);
  clearInterval(keepaliveTimer);
  try { flushWriter(); ffmpeg.stdin.end(); } catch (e) {}
  const timeout = setTimeout(() => {
    try { ffmpeg.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }, 15000);
  ffmpeg.on('close', (code) => {
    clearTimeout(timeout);
    console.log('[DONE] Saved:', OUTPUT_FILE);
    console.log(`[STATS] Written=${totalWritten} Dropped=${dropped}`);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start a small Socket.IO server to forward MQTT messages to the dashboard
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// serve captures directory if exists
try {
  const capturesDir = path.join(process.cwd());
  app.use('/captures', express.static(capturesDir));
} catch (e) {}

io.on('connection', (socket) => {
  console.log('[WS] client connected');
  socket.emit('meta', { discoveredTopic, cameraName, outputFile: path.basename(OUTPUT_FILE) });
});

// forward MQTT messages to websocket clients
client.on('message', (topic, payload) => {
  try {
    io.emit('mqtt', { topic, payload: payload.toString('base64') });
  } catch (e) {}
});

const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3000;
server.listen(WS_PORT, () => console.log(`[WS] Socket.IO listening on :${WS_PORT}`));

// export client+shutdown for tests
module.exports = { client, shutdown };
