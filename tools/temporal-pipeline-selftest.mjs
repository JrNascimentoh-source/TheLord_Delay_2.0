import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";

const host = "127.0.0.1";
const port = Number(
  process.env.TEMPORAL_SELFTEST_PORT || 8877
);

const relay = new URL(
  `ws://${host}:${port}/stream`
);

const configuredDelayMs = Math.max(
  100,
  Number(process.env.TEMPORAL_DELAY_MS || 1000)
);

const REALTIME_MAX_MS = 500;
const DELAY_TOLERANCE_MS = 150;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function openClient(url) {
  const ws = new WebSocket(url);
  await once(ws, "open");
  return ws;
}

async function waitForSubscription(ws, expectedScreenId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `timeout aguardando subscribed para ${expectedScreenId}`
        )
      );
    }, 2000);

    function onMessage(raw, isBinary) {
      if (isBinary) return;

      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (
        msg.type === "subscribed" &&
        msg.screenId === expectedScreenId
      ) {
        cleanup();
        resolve(msg);
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      ws.off("message", onMessage);
    }

    ws.on("message", onMessage);
  });
}

async function main() {
  const child = spawn(
    process.execPath,
    ["tools/temporal-relay.mjs"],
    {
      env: {
        ...process.env,
        HOST: host,
        PORT: String(port)
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", chunk => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  try {
    await wait(250);

    if (child.exitCode !== null) {
      throw new Error(
        `relay encerrou antes do teste: ${stderr || stdout}`
      );
    }

    const producer = await openClient(relay);
    const realtimeScreen = await openClient(relay);
    const delayedScreen = await openClient(relay);

    const realtimeReceived = [];
    const delayedReceived = [];

    realtimeScreen.on("message", (raw, isBinary) => {
      if (isBinary) {
        realtimeReceived.push({
          data: Buffer.from(raw),
          receivedAt: Date.now()
        });
      }
    });

    delayedScreen.on("message", (raw, isBinary) => {
      if (isBinary) {
        delayedReceived.push({
          data: Buffer.from(raw),
          receivedAt: Date.now()
        });
      }
    });

    producer.send(
      JSON.stringify({
        type: "subscribe",
        channel: "temporal-selftest",
        screenId: "producer",
        delayMs: 0
      })
    );

    realtimeScreen.send(
      JSON.stringify({
        type: "subscribe",
        channel: "temporal-selftest",
        screenId: "screen-realtime",
        delayMs: 0
      })
    );

    delayedScreen.send(
      JSON.stringify({
        type: "subscribe",
        channel: "temporal-selftest",
        screenId: "screen-delayed",
        delayMs: configuredDelayMs
      })
    );

    const realtimeSubscription =
      await waitForSubscription(
        realtimeScreen,
        "screen-realtime"
      );

    const delayedSubscription =
      await waitForSubscription(
        delayedScreen,
        "screen-delayed"
      );

    if (
      realtimeSubscription.delayMs !== 0
    ) {
      throw new Error(
        `tela realtime recebeu delay inesperado: ${realtimeSubscription.delayMs}`
      );
    }

    if (
      delayedSubscription.delayMs !== configuredDelayMs
    ) {
      throw new Error(
        `tela delayed recebeu ${delayedSubscription.delayMs} ms; esperado ${configuredDelayMs} ms`
      );
    }

    await wait(100);

    const frames = [
      Buffer.from(
        JSON.stringify({
          source: "selftest",
          sequence: 1,
          value: 1.1
        }),
        "utf8"
      ),

      Buffer.from(
        JSON.stringify({
          source: "selftest",
          sequence: 2,
          value: 2.2
        }),
        "utf8"
      ),

      Buffer.from(
        JSON.stringify({
          source: "selftest",
          sequence: 3,
          value: 3.3
        }),
        "utf8"
      )
    ];

    const sent = [];

    for (let i = 0; i < frames.length; i++) {
      const sentAt = Date.now();

      sent.push({
        frame: frames[i],
        sentAt
      });

      producer.send(frames[i], {
        binary: true
      });

      if (i < frames.length - 1) {
        await wait(100);
      }
    }

    const deadline =
      Date.now() +
      configuredDelayMs +
      3000;

    while (
      (
        realtimeReceived.length < frames.length ||
        delayedReceived.length < frames.length
      ) &&
      Date.now() < deadline
    ) {
      await wait(25);
    }

    if (
      realtimeReceived.length !== frames.length
    ) {
      throw new Error(
        `tela realtime recebeu ${realtimeReceived.length}/${frames.length} frames`
      );
    }

    if (
      delayedReceived.length !== frames.length
    ) {
      throw new Error(
        `tela delayed recebeu ${delayedReceived.length}/${frames.length} frames`
      );
    }

    for (let i = 0; i < frames.length; i++) {
      if (
        !realtimeReceived[i].data.equals(frames[i])
      ) {
        throw new Error(
          `frame ${i + 1} foi alterado na tela realtime`
        );
      }

      if (
        !delayedReceived[i].data.equals(frames[i])
      ) {
        throw new Error(
          `frame ${i + 1} foi alterado na tela delayed`
        );
      }
    }

    for (let i = 0; i < frames.length; i++) {
      const realtimeElapsed =
        realtimeReceived[i].receivedAt -
        sent[i].sentAt;

      const delayedElapsed =
        delayedReceived[i].receivedAt -
        sent[i].sentAt;

      if (
        realtimeElapsed > REALTIME_MAX_MS
      ) {
        throw new Error(
          `frame ${i + 1} não chegou em tempo real: ${realtimeElapsed} ms`
        );
      }

      const minDelayed =
        configuredDelayMs -
        DELAY_TOLERANCE_MS;

      if (
        delayedElapsed < minDelayed
      ) {
        throw new Error(
          `frame ${i + 1} chegou cedo demais na tela delayed: ${delayedElapsed} ms; esperado >= ${minDelayed} ms`
        );
      }
    }

    console.log("");
    console.log(
      "TEMPORAL PIPELINE SELFTEST OK"
    );

    console.log(
      `Frames preservados: ${frames.length}`
    );

    console.log(
      `Tela realtime: delay=0 ms`
    );

    console.log(
      `Tela delayed: delay=${configuredDelayMs} ms`
    );

    console.log("");

    for (let i = 0; i < frames.length; i++) {
      const realtimeElapsed =
        realtimeReceived[i].receivedAt -
        sent[i].sentAt;

      const delayedElapsed =
        delayedReceived[i].receivedAt -
        sent[i].sentAt;

      console.log(
        `Frame ${i + 1}: realtime=${realtimeElapsed} ms | delayed=${delayedElapsed} ms`
      );
    }

    console.log("");
    console.log(
      "OK: a tela realtime recebeu imediatamente e a segunda tela recebeu o mesmo fluxo com atraso."
    );

    producer.close();
    realtimeScreen.close();
    delayedScreen.close();
  } finally {
    child.kill("SIGTERM");
    await wait(100);
  }
}

main().catch(error => {
  console.error(
    "TEMPORAL PIPELINE SELFTEST FAILED:",
    error.message
  );

  process.exitCode = 1;
});
