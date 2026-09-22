## Zero-Collision Local IPC via Unix Domain Sockets

A demonstration of secure, zero-collision Inter-Process Communication (IPC) using **Unix Domain Sockets (UDS)** bound inside isolated, **private temporary directories**.

This pattern is ideal for desktop applications (Electron, Tauri), local CLI daemons, browser extension native hosts, and local micro-services where multiple client and backend components run concurrently on the same machine.

### Purpose & Advantages

When local processes communicate via standard TCP loopback (e.g., `http://127.0.0.1:8080`), they suffer from port availability conflicts and security risks. Using Unix domain sockets inside dynamically generated, restricted directories solves these issues:

| Concern | Traditional TCP (`127.0.0.1:8080`) | UDS in Private Temp Dir |
| :--- | :--- | :--- |
| **Port Conflicts** | Fails if port is already bound (`EADDRINUSE`) | **Zero collisions** via dynamic filesystem paths |
| **Multi-Instance** | Requires complex port-hunting logic | **Unlimited parallel instances** out of the box |
| **Security / Isolation** | Unprivileged local processes can connect | **OS Kernel-enforced** permissions (`0700`) |
| **Network Visibility** | Port scanners (`nmap`) or local web pages can probe | **Invisible** to the TCP/IP stack |
| **Performance** | TCP checksums, packet framing, loopback overhead | **Direct kernel memory stream buffers** (`SOCK_STREAM`) |

---

### Architecture & Workflow

```
                        ┌─────────────────────────────────────────┐
                        │              ORCHESTRATOR               │
                        │      Spawns 3 Concurrent Backends       │
                        └────┬─────────────────┬─────────────┬────┘
                             │                 │             │
             ┌───────────────┘                 │             └───────────────┐
             ▼                                 ▼                             ▼
┌─────────────────────────┐       ┌─────────────────────────┐   ┌─────────────────────────┐
│  BACKEND INSTANCE #1    │       │  BACKEND INSTANCE #2    │   │  BACKEND INSTANCE #3    │
│  Directory:             │       │  Directory:             │   │  Directory:             │
│  /tmp/app-inst-1-XXXXXX/│       │  /tmp/app-inst-2-XXXXXX/│   │  /tmp/app-inst-3-XXXXXX/│
│  Permissions: 0700      │       │  Permissions: 0700      │   │  Permissions: 0700      │
└────────────┬────────────┘       └────────────┬────────────┘   └────────────┬────────────┘
             │ (Env Var)                       │ (Env Var)                   │ (Env Var)
             ▼                                 ▼                             ▼
┌─────────────────────────┐       ┌─────────────────────────┐   ┌─────────────────────────┐
│    CLIENT INSTANCE #1   │       │    CLIENT INSTANCE #2   │   │    CLIENT INSTANCE #3   │
│  Dials Socket #1        │       │  Dials Socket #2        │   │  Dials Socket #3        │
└─────────────────────────┘       └─────────────────────────┘   └─────────────────────────┘
```

1. **Orchestration:** An orchestrator process spawns multiple backend server processes in parallel.
2. **Directory Isolation (`0700`):** Each backend process calls `fs.mkdtempSync()` to generate a unique directory with `rwx------` permissions. Standard OS path traversal rules prevent other unprivileged users or processes from accessing files inside.
3. **Dynamic Path Binding:** Each backend binds its server to its own `rpc.sock` file inside its dedicated temporary folder.
4. **Environment Handshake:** The backend spawns its designated client process, injecting its unique socket path into `process.env.APP_RPC_SOCKET`.
5. **Stream Framing:** Communication uses `\n` line-delimited JSON payloads over raw byte streams (`SOCK_STREAM`) to maintain clean message boundary separation.

---

### Prerequisites

* **Node.js**: v18.0.0 or higher
* **Bun**: v1.0 or higher
* **Operating System**: macOS, Linux, or WSL (Windows Subsystem for Linux)

---

### How to Run

Execute the script with Node.js:

```bash
node/bun main.mjs
```

#### Expected Output

```text
❯ bun main.mjs
==================================================================
 ORCHESTRATOR: Spawning 3 concurrent Backend instances...
==================================================================

[BACKEND #2 PID:92410] Listening on private socket: /var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-2-iHCtt5/rpc.sock
[BACKEND #1 PID:92409] Listening on private socket: /var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-1-XYutHf/rpc.sock
[BACKEND #3 PID:92411] Listening on private socket: /var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-3-Ze8Wzp/rpc.sock
[CLIENT  #2 PID:92419] Connected to socket: /var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-2-iHCtt5/rpc.sock
[CLIENT  #1 PID:92420] Connected to socket: /var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-1-XYutHf/rpc.sock
[CLIENT  #1 PID:92420] Received response: {
  id: "req-1",
  status: "OK",
  result: {
    message: "pong",
    instanceId: "1",
    boundSocket: "/var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-1-XYutHf/rpc.sock",
  },
}
[CLIENT  #2 PID:92419] Received response: {
  id: "req-1",
  status: "OK",
  result: {
    message: "pong",
    instanceId: "2",
    boundSocket: "/var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-2-iHCtt5/rpc.sock",
  },
}
[CLIENT  #2 PID:92419] Received response: {
  id: "req-2",
  status: "OK",
  result: {
    pid: 92410,
    platform: "darwin",
    instanceId: "2",
  },
}
[CLIENT  #1 PID:92420] Received response: {
  id: "req-2",
  status: "OK",
  result: {
    pid: 92409,
    platform: "darwin",
    instanceId: "1",
  },
}
[CLIENT  #3 PID:92418] Connected to socket: /var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-3-Ze8Wzp/rpc.sock
[CLIENT  #3 PID:92418] Received response: {
  id: "req-1",
  status: "OK",
  result: {
    message: "pong",
    instanceId: "3",
    boundSocket: "/var/folders/q6/xxg3x_952m5fj8_n9r2403qm0000gn/T/app-inst-3-Ze8Wzp/rpc.sock",
  },
}
[CLIENT  #3 PID:92418] Received response: {
  id: "req-2",
  status: "OK",
  result: {
    pid: 92411,
    platform: "darwin",
    instanceId: "3",
  },
}
[ORCHESTRATOR] Backend Instance #1 finished execution (exit code 0).
[ORCHESTRATOR] Backend Instance #2 finished execution (exit code 0).
[ORCHESTRATOR] Backend Instance #3 finished execution (exit code 0).

==================================================================
 SUCCESS: All 3 backends ran in parallel with ZERO collisions!
==================================================================
```
