import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = Number(process.env.TEMPORAL_DELAY_SELFTEST_PORT || 8878);
const DELAY_MS = Number(process.env.TEMPORAL_DELAY_SELFTEST_DELAY_MS || 1500);
const relay = spawn(process.execPath, ["tools/temporal-relay.mjs"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});

let relayReady = false;
const relayOutput = [];
relay.stdout.on("data", chunk => {
  const text = chunk.toString();
  relayOutput.push(text);
  if (text.includes("temporal relay listening")) relayReady = true;
});
relay.stderr.on("data", chunk => relayOutput.push(chunk.toString()));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForRelay() {
  const deadline = Date.now() + 5000;
  while (!relayReady && Date.now() < deadline) await sleep(25);
  if (!relayReady) throw new Error("Relay did not start:\n" + relayOutput.join(""));
}

function createSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/stream`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

const queue = [];
let sequence = 0;
let timer = null;

function schedule() {
  if (timer || !queue.length) return;
  const wait = Math.max(0, queue[0].dueAt - Date.now());
  timer = setTimeout(() => {
    timer = null;
    const item = queue.shift();
    item.resolve({ deliveredAt: Date.now(), payload: item.payload });
    schedule();
  }, wait);
}

function enqueue(payload, receivedAt, resolve) {
  queue.push({
    payload,
    receivedAt,
    dueAt: receivedAt + DELAY_MS,
    resolve,
    sequence: sequence++
  });
  queue.sort((a, b) => a.dueAt - b.dueAt || a.receivedAt - b.receivedAt || a.sequence - b.sequence);
  schedule();
}

async function main() {
  await waitForRelay();

  const producer = await createSocket();
  const consumer = await createSocket();
  const channel = "e2e-selftest";

  const delivered = [];
  consumer.on("message", raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== "data") return;
    const payload = msg.payload;
    const receivedAt = Number(msg.receivedAt);
    enqueue(payload, receivedAt, result => delivered.push({ ...result, receivedAt }));
  });

  producer.send(JSON.stringify({ type: "subscribe", channel, screenId: "producer" }));
  consumer.send(JSON.stringify({ type: "subscribe", channel, screenId: "2" }));
  await sleep(100);

  const sentAt = Date.now();
  const promises = Array.from({ length: 3 }, (_, i) => new Promise(resolve => {
    const payload = { source: "local-e2e", sequence: i + 1, sentAt };
    producer.send(JSON.stringify({
      type: "data",
      channel,
      receivedAt: sentAt,
      payload
    }));
    const check = setInterval(() => {
      const item = delivered.find(x => x.payload?.sequence === i + 1);
      if (item) {
        clearInterval(check);
        resolve(item);
      }
    }, 10);
  }));

  const results = await Promise.all(promises);
  const tolerances = results.map(x => x.deliveredAt - x.receivedAt);
  const min = Math.min(...tolerances);
  const max = Math.max(...tolerances);
  const expectedOrder = [1, 2, 3];
  const actualOrder = results.sort((a, b) => a.payload.sequence - b.payload.sequence).map(x => x.payload.sequence);

  if (min < DELAY_MS - 150 || max > DELAY_MS + 500) {
    throw new Error(`Delay out of tolerance: expected ~${DELAY_MS}ms, observed ${min}-${max}ms`);
  }
  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error(`Order mismatch: ${JSON.stringify(actualOrder)}`);
  }

  producer.close();
  consumer.close();
  console.log(`E2E SELFTEST OK: 3 frames preservados, ordem preservada e atraso observado ${min}-${max} ms (alvo ${DELAY_MS} ms).`);
}

try {
  await main();
} finally {
  if (timer) clearTimeout(timer);
  relay.kill("SIGTERM");
  await sleep(50);
}
