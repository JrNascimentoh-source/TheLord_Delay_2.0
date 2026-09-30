import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const DEFAULT_DELAY_MS = Math.max(
  0,
  Number(process.env.TEMPORAL_DEFAULT_DELAY_MS || 0)
);

const MAX_DELAY_MS = 60_000;

const wss = new WebSocketServer({
  host,
  port,
  path: "/stream"
});

const channels = new Map();

function send(socket, message) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function members(channel) {
  return channels.get(channel) || new Set();
}

function normalizeDelay(value) {
  const delay = Number(value);

  if (!Number.isFinite(delay)) {
    return DEFAULT_DELAY_MS;
  }

  return Math.min(
    MAX_DELAY_MS,
    Math.max(0, Math.floor(delay))
  );
}

function join(socket, channel) {
  if (!channels.has(channel)) {
    channels.set(channel, new Set());
  }

  channels.get(channel).add(socket);
  socket.channel = channel;
}

function leave(socket) {
  if (!socket.channel) return;

  const set = channels.get(socket.channel);

  if (set) {
    set.delete(socket);

    if (!set.size) {
      channels.delete(socket.channel);
    }
  }

  socket.channel = "";
}

function forwardBinary(sender, raw) {
  const channel = sender.channel;

  if (!channel) return;

  for (const peer of members(channel)) {
    if (peer === sender || peer.readyState !== 1) {
      continue;
    }

    const delayMs = normalizeDelay(peer.delayMs);

    if (delayMs === 0) {
      peer.send(raw, { binary: true });
      continue;
    }

    setTimeout(() => {
      if (peer.readyState === 1) {
        peer.send(raw, { binary: true });
      }
    }, delayMs);
  }
}

wss.on("connection", socket => {
  socket.channel = "";
  socket.screenId = "";
  socket.delayMs = DEFAULT_DELAY_MS;

  send(socket, {
    type: "ready",
    version: 2
  });

  socket.on("message", (raw, isBinary) => {
    if (isBinary) {
      forwardBinary(socket, raw);
      return;
    }

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(socket, {
        type: "error",
        code: "INVALID_JSON"
      });
      return;
    }

    if (!msg || typeof msg !== "object") {
      return;
    }

    if (msg.type === "subscribe") {
      leave(socket);

      const channel = String(msg.channel || "default");
      const screenId = String(msg.screenId || "");
      const delayMs = normalizeDelay(msg.delayMs);

      socket.screenId = screenId;
      socket.delayMs = delayMs;

      join(socket, channel);

      send(socket, {
        type: "subscribed",
        channel: socket.channel,
        screenId: socket.screenId,
        delayMs: socket.delayMs
      });

      return;
    }

    if (msg.type === "data") {
      const channel = String(
        msg.channel || socket.channel || "default"
      );

      const receivedAt =
        Number(msg.receivedAt) || Date.now();

      const packet = {
        type: "data",
        channel,
        receivedAt,
        payload: msg.payload
      };

      for (const peer of members(channel)) {
        send(peer, packet);
      }
    }
  });

  socket.on("close", () => leave(socket));
  socket.on("error", () => leave(socket));
});

console.log(
  `TheLord temporal relay listening on ws://${host}:${port}/stream`
);

console.log(
  `Default delay: ${DEFAULT_DELAY_MS} ms`
);

console.log(
  "Protocol: producer sends binary frames; consumers subscribe with {channel,screenId,delayMs}."
);
