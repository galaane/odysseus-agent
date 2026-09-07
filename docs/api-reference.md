# 🌐 TaskServer HTTP REST & SSE API Reference

The **TaskServer** provides an HTTP API and real-time Server-Sent Events (SSE) stream for controlling the Odysseus agent, managing tasks, and interacting with Level 5 autonomous subsystems.

- **Default Port:** `3000` (Configurable via `PORT` environment variable or `--port`).
- **Base URL:** `http://localhost:3000`
- **Content-Type:** `application/json` (except SSE and binary screenshots)
- **CORS:** Enabled for all local origins (`*`).

---

## 1. Task Lifecycle & Mission Control Endpoints

### `POST /tasks` (or `/api/tasks`)
Submits a new autonomous browsing task to the agent runtime.

- **Pre-condition:** The agent runtime must be in an `idle` or completed state (enforces Invariant 1: exactly one active task at a time).
- **Request Body:**
  ```json
  {
    "goal": "Verify GitHub Enterprise pricing and feature matrices",
    "maxSteps": 30,
    "maxDurationMs": 300000
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "taskId": "task_1725701234_abc12",
    "status": "running"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing or invalid goal string.
  - `409 Conflict`: Another task is currently running.

---

### `GET /tasks` (or `/api/tasks`)
Lists all tasks recorded during the current server session.

- **Response (200 OK):**
  ```json
  {
    "tasks": [
      {
        "id": "task_1725701234_abc12",
        "goal": "Verify GitHub Enterprise pricing",
        "status": "completed",
        "stepCount": 6,
        "maxSteps": 30,
        "createdAt": "2026-09-07T05:00:00.000Z",
        "completedAt": "2026-09-07T05:01:23.000Z",
        "findings": [
          {
            "claim": "GitHub Enterprise Server license starts at $21/user/month",
            "confidence": 0.95,
            "sourceUrls": ["https://github.com/pricing"]
          }
        ]
      }
    ]
  }
  ```

---

### `GET /tasks/:id` (or `/api/tasks/:id`)
Retrieves the execution state, telemetry, and corroborated findings of a specific task.

- **Response (200 OK):**
  ```json
  {
    "id": "task_1725701234_abc12",
    "goal": "Verify GitHub Enterprise pricing",
    "status": "completed",
    "stepCount": 6,
    "maxSteps": 30,
    "findings": [...],
    "error": null
  }
  ```
- **Response (404 Not Found):** Task ID not found in session registry.

---

### `POST /tasks/:id/cancel` (or `/api/tasks/:id/cancel`)
Signals immediate graceful abort of an ongoing task.

- **Response (200 OK):**
  ```json
  {
    "success": true,
    "taskId": "task_1725701234_abc12",
    "message": "Cancellation signal sent"
  }
  ```

---

### `POST /tasks/:id/resolve-intervention` (or `/api/tasks/:id/resolve-intervention`)
Resolves a Human-In-The-Loop (HITL) barrier (e.g. CAPTCHA, MFA prompt, or physical verification) and signals the agent to resume execution.

- **Response (200 OK):**
  ```json
  {
    "success": true,
    "taskId": "task_1725701234_abc12",
    "message": "Human intervention confirmed; task resumed"
  }
  ```
- **Response (400 Bad Request):** If the agent is not currently in `waiting_human_intervention` state.

---

### `GET /tasks/:id/deliberation` (or `/api/tasks/:id/deliberation`)
Fetches the complete historical ledger of System 2 cognitive deliberations recorded for the task.

- **Response (200 OK):**
  ```json
  {
    "taskId": "task_1725701234_abc12",
    "deliberations": [
      {
        "step": 1,
        "deliberation": {
          "observation_analysis": "Found login form with username and password inputs",
          "encountered_obstacles": "None detected",
          "alternative_considered": "Direct navigation vs submit form",
          "risk_assessment": "Low risk, form elements are stable"
        },
        "reasoning": "Submitting credentials through isolated vault",
        "status": "continue"
      }
    ]
  }
  ```

---

## 2. System Status & Diagnostics

### `GET /api/status`
Returns real-time agent state, browser process health, and active tab URL.

- **Response (200 OK):**
  ```json
  {
    "agentState": "idle",
    "activeTaskId": null,
    "browserHealthy": true,
    "activeTab": {
      "id": "tab_001",
      "url": "http://127.0.0.1:8080/products"
    },
    "totalTasks": 4,
    "timestamp": "2026-09-07T05:30:00.000Z"
  }
  ```

---

### `GET /api/screenshot`
Captures an on-demand, full visual snapshot of the currently active Chromium tab.

- **Response (200 OK):** Binary image buffer (`Content-Type: image/png`).
- **Response (404 Not Found):** If no active browser page is open.

---

## 3. Real-Time Event Stream (SSE)

### `GET /events`
Opens a persistent Server-Sent Events connection. The server transmits domain events as they occur and sends a periodic keepalive heartbeat (`: ping\n\n`) every 15 seconds.

#### Supported SSE Domain Events:

| Event Type | Description | Key Payload Fields |
| :--- | :--- | :--- |
| `ready` | Emitted immediately upon connection. | `{ status: "online" }` |
| `task.created` | New task registered in session. | `{ taskId, goal }` |
| `task.checkpoint` | Completed step; progress updated. | `{ taskId, step, maxSteps }` |
| `task.completed` | Task finished successfully. | `{ taskId, findings, durationMs }` |
| `task.failed` | Task terminated with error. | `{ taskId, error }` |
| `task.cancelled` | Task manually aborted. | `{ taskId }` |
| `agent.state_changed` | State machine transition. | `{ from, to, state }` |
| `agent.deliberation` | System 2 cognitive decision. | `{ taskId, step, deliberation }` |
| `agent.intervention_required` | External barrier detected. | `{ taskId, reasoning }` |
| `agent.intervention_resolved` | User confirmed barrier cleared. | `{ taskId }` |
| `watcher.created` | State watcher registered. | `{ id, name, targetUrl }` |
| `watcher.updated` | State watcher paused or resumed. | `{ id, status }` |
| `watcher.deleted` | State watcher removed. | `{ id }` |
| `macro.replayed` | Workflow macro executed. | `{ macroId, result }` |
| `macro.deleted` | Workflow macro deleted. | `{ macroId }` |
| `stealth.cleaned` | Ephemeral cache purged safely. | `{ freedBytes, deletedFilesCount }` |

---

## 4. Level 5 Subsystem Endpoints

### 4.1 Site Topology & Knowledge Graph

#### `GET /api/topology`
Retrieves site topology route nodes and transitions.

- **Query Parameters:**
  - `domain` (optional): Filter to a specific domain (e.g. `?domain=store.local`).
- **Response (200 OK - All Domains):**
  ```json
  {
    "domains": ["store.local", "docs.local"],
    "nodes": [
      {
        "id": "node_1",
        "domain": "store.local",
        "path": "/products",
        "pattern": "/products",
        "archetype": "ecommerce",
        "affordances": [
          { "type": "action_button", "role": "button", "name": "Filter" }
        ],
        "depth": 1,
        "visitedAt": 1725701234000
      }
    ],
    "edges": [
      {
        "id": "edge_1",
        "domain": "store.local",
        "sourcePath": "/",
        "targetPath": "/products",
        "transitionType": "link_click",
        "weight": 0.95
      }
    ]
  }
  ```

---

#### `GET /api/knowledge-graph`
Retrieves semantic archetype concepts and transfer reliability weights.

- **Response (200 OK):**
  ```json
  {
    "nodeCount": 24,
    "nodes": [
      {
        "id": "concept_ecommerce_add_to_cart_button",
        "type": "concept",
        "name": "add_to_cart_button",
        "properties": {
          "archetype": "ecommerce",
          "typicalRoles": ["button"],
          "typicalNamePatterns": ["add to cart", "buy now"],
          "strategyHint": "Locate primary CTA button in product detail"
        }
      }
    ],
    "edges": [
      {
        "id": "edge_arch_ecommerce_add_to_cart",
        "sourceId": "arch_ecommerce",
        "targetId": "concept_ecommerce_add_to_cart_button",
        "relation": "uses_concept",
        "weight": 0.85
      }
    ]
  }
  ```

---

### 4.2 Workflow Macros

#### `GET /api/macros`
Lists all synthesized and verified workflow macros.

- **Response (200 OK):**
  ```json
  {
    "macros": [
      {
        "id": "macro_store_checkout",
        "domain": "store.local",
        "intentKey": "checkout",
        "parameterKeys": ["shippingAddress"],
        "steps": [
          { "stepNumber": 1, "actionTemplate": { "action": "navigate", "url": "..." } },
          { "stepNumber": 2, "actionTemplate": { "action": "click", "selector": "#pay-btn" } }
        ],
        "status": "verified",
        "successCount": 5,
        "failureCount": 0,
        "healingCount": 0
      }
    ]
  }
  ```

---

#### `POST /api/macros/:id/replay`
Executes a parameterized workflow macro deterministically under `ActionMutex`.

- **Request Body:**
  ```json
  {
    "parameters": {
      "shippingAddress": "123 Main St"
    }
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "macroId": "macro_store_checkout",
    "executedSteps": 2,
    "healedCount": 0,
    "durationMs": 42
  }
  ```

---

#### `DELETE /api/macros/:id`
Removes a workflow macro from the database.

- **Response (200 OK):**
  ```json
  {
    "success": true,
    "deletedMacroId": "macro_store_checkout"
  }
  ```

---

### 4.3 State Watchers

#### `GET /api/watchers`
Lists all active and paused background state watchers.

- **Response (200 OK):**
  ```json
  {
    "watchers": [
      {
        "id": "watcher_1725700000",
        "name": "Price Drop Sentinel",
        "targetUrl": "http://store.local/item/42",
        "conditionType": "price_below",
        "conditionTarget": ".price-badge",
        "conditionValue": "50.00",
        "triggerType": "notify_hitl",
        "intervalMs": 15000,
        "adaptiveJitter": true,
        "status": "active",
        "lastCheckedAt": 1725701234000
      }
    ]
  }
  ```

---

#### `POST /api/watchers`
Registers and starts a new background state watcher.

- **Request Body:**
  ```json
  {
    "name": "Discount Watcher",
    "targetUrl": "http://127.0.0.1:8080/deals",
    "conditionType": "text_contains",
    "conditionTarget": "#banner",
    "conditionValue": "SALE",
    "triggerType": "notify_hitl",
    "intervalMs": 10000,
    "adaptiveJitter": true
  }
  ```
- **Response (201 Created):** Returns the created `WatcherJob` object.

---

#### `POST /api/watchers/:id/pause` & `POST /api/watchers/:id/resume`
Toggles watcher daemon execution status.

- **Response (200 OK):**
  ```json
  {
    "success": true,
    "id": "watcher_1725700000",
    "status": "paused"
  }
  ```

---

#### `DELETE /api/watchers/:id`
Deletes the watcher job and cancels all pending interval timers.

- **Response (200 OK):**
  ```json
  {
    "success": true,
    "deletedWatcherId": "watcher_1725700000"
  }
  ```

---

### 4.4 Stealth & Profile Health

#### `GET /api/stealth/profile-health`
Audits persistent Chromium profile storage footprint.

- **Response (200 OK):**
  ```json
  {
    "profileDir": "data/browser-profile",
    "diskUsageBytes": 286331153,
    "cacheUsageBytes": 264024883,
    "orphanedFilesCount": 0,
    "status": "optimal",
    "timestamp": 1725701234000
  }
  ```

---

#### `POST /api/stealth/profile-clean`
Purges ephemeral Chromium caches while strictly preserving user cookies and authentication sessions.

- **Response (200 OK):**
  ```json
  {
    "freedBytes": 264024883,
    "deletedFilesCount": 142,
    "dryRun": false
  }
  ```

---

### 4.5 Hyperparameter Optimization

#### `GET /api/optimization/hyperparameters`
Returns tuned execution hyperparameters.

- **Query Parameters:**
  - `domain` (optional): Retrieve effective parameters for a specific domain.
  - `archetype` (optional): Retrieve effective parameters for a domain archetype.
- **Response (200 OK - Domain Match):**
  ```json
  {
    "effective": {
      "domainOrArchetype": "store.local",
      "riskAversionFactor": 0.52,
      "maxRetries": 3,
      "tokenBudget": 2850,
      "frustrationThreshold": 3,
      "sampleCount": 8,
      "successCount": 8
    }
  }
  ```
