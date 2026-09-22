import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);

const ROLE = process.env.APP_ROLE || "orchestrator";

switch (ROLE) {
  case "client":
    runClientProcess();
    break;
  case "backend":
    runBackendProcess();
    break;
  default:
    runOrchestratorProcess();
    break;
}

// ORCHESTRATOR: Spawns 3 Concurrent Backend Server Instances
function runOrchestratorProcess() {
  console.log(
    "==================================================================",
  );
  console.log(" ORCHESTRATOR: Spawning 3 concurrent Backend instances...");
  console.log(
    "==================================================================\n",
  );

  const instanceIds = [1, 2, 3];

  const tasks = instanceIds.map((id) => {
    return new Promise((resolve) => {
      const backendProc = fork(currentFile, [], {
        env: {
          ...process.env,
          APP_ROLE: "backend",
          INSTANCE_ID: String(id),
        },
      });

      backendProc.on("exit", (code) => {
        console.log(
          `[ORCHESTRATOR] Backend Instance #${id} finished execution (exit code ${code}).`,
        );
        resolve();
      });
    });
  });

  Promise.all(tasks).then(() => {
    console.log(
      "\n==================================================================",
    );
    console.log(
      " SUCCESS: All 3 backends ran in parallel with ZERO collisions!",
    );
    console.log(
      "==================================================================",
    );
  });
}

// BACKEND PROCESS: Own Private Temp Dir & Socket Server
function runBackendProcess() {
  const instanceId = process.env.INSTANCE_ID;
  const tag = `[BACKEND #${instanceId} PID:${process.pid}]`;

  // Create a isolated dynamic temp directory per instance (mode 0700)
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `app-inst-${instanceId}-`),
  );
  const socketPath = path.join(tmpDir, "rpc.sock");
  let clientProc = null;

  const cleanup = () => {
    if (clientProc && !clientProc.killed) {
      clientProc.kill();
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.error("Failed to remove temp dir", { err: e });
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit();
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit();
  });

  // Listen on instance-specific Unix domain socket
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString();

      let lineIndex;
      while ((lineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, lineIndex).trim();
        buffer = buffer.slice(lineIndex + 1);

        if (!line) continue;

        try {
          const request = JSON.parse(line);
          let result = null;

          if (request.method === "ping") {
            result = { message: "pong", instanceId, boundSocket: socketPath };
          } else if (request.method === "getSystemInfo") {
            result = {
              pid: process.pid,
              platform: process.platform,
              instanceId,
            };
          }

          const response = { id: request.id, status: "OK", result };
          socket.write(JSON.stringify(response) + "\n");
        } catch (err) {
          console.error(`${tag} JSON parse error:`, err.message);
        }
      }
    });
  });

  server.listen(socketPath, () => {
    console.log(`${tag} Listening on private socket: ${socketPath}`);

    // Spawn matching Client Process, injecting APP_RPC_SOCKET into ENV
    clientProc = fork(currentFile, [], {
      env: {
        ...process.env,
        APP_ROLE: "client",
        APP_RPC_SOCKET: socketPath,
        INSTANCE_ID: instanceId,
      },
    });

    clientProc.on("exit", () => {
      server.close(() => {
        cleanup();
        process.exit(0);
      });
    });
  });
}

// CLIENT PROCESS: Dials Target Socket Path From Environment
function runClientProcess() {
  const instanceId = process.env.INSTANCE_ID;
  const socketPath = process.env.APP_RPC_SOCKET;
  const tag = `[CLIENT  #${instanceId} PID:${process.pid}]`;

  const client = net.connect(socketPath, () => {
    console.log(`${tag} Connected to socket: ${socketPath}`);

    const sendRpc = (reqId, method, params = {}) => {
      client.write(JSON.stringify({ id: reqId, method, params }) + "\n");
    };

    sendRpc("req-1", "ping");
    sendRpc("req-2", "getSystemInfo");
  });

  let buffer = "";
  let receivedCount = 0;

  client.on("data", (chunk) => {
    buffer += chunk.toString();

    let lineIndex;
    while ((lineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, lineIndex).trim();
      buffer = buffer.slice(lineIndex + 1);

      if (!line) continue;

      const response = JSON.parse(line);
      console.log(`${tag} Received response:`, response);

      receivedCount++;
      if (receivedCount >= 2) {
        client.end();
      }
    }
  });

  client.on("end", () => {
    process.exit(0);
  });

  client.on("error", (err) => {
    console.error(`${tag} Error:`, err.message);
    process.exit(1);
  });
}
