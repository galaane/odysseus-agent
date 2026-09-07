# 💻 Odysseus CLI & Operations Handbook

The **Odysseus** browser agent includes an integrated suite of command-line tools for executing tasks, managing state watchers, inspecting persistent browser health, analyzing site topology, and running benchmark gauntlets.

---

## 1. CLI Commands Summary

| Command | Script Target | Description |
| :--- | :--- | :--- |
| `npm run start-dashboard` | [`scripts/start-dashboard.ts`](file:///d:/AWS/odysseus-agent/scripts/start-dashboard.ts) | Launches the interactive Mission Control Web Dashboard on port 3000. |
| `npm run benchmark:level5` | [`scripts/benchmark-level5.ts`](file:///d:/AWS/odysseus-agent/scripts/benchmark-level5.ts) | Executes the 8-gate Level 5 end-to-end system benchmark suite with live ANSI reporter. |
| `npm run watcher` | [`scripts/manage-watcher.ts`](file:///d:/AWS/odysseus-agent/scripts/manage-watcher.ts) | Inspects, registers, pauses, resumes, and deletes background State Watchers. |
| `npm run profile:health` | [`scripts/profile-health.ts`](file:///d:/AWS/odysseus-agent/scripts/profile-health.ts) | Audits Chromium profile footprint and safely cleans ephemeral caches. |
| `npm run topology` | [`scripts/view-topology.ts`](file:///d:/AWS/odysseus-agent/scripts/view-topology.ts) | Displays discovered site topology route nodes and transitions in formatted tables. |
| `npm run run-task` | [`scripts/run-task.ts`](file:///d:/AWS/odysseus-agent/scripts/run-task.ts) | Executes a one-shot autonomous task directly from terminal arguments. |
| `npm run start-browser` | [`scripts/start-browser.ts`](file:///d:/AWS/odysseus-agent/scripts/start-browser.ts) | Launches persistent stealth Chromium browser for visual inspection. |
| `npm run get-otp` | [`scripts/get-otp.ts`](file:///d:/AWS/odysseus-agent/scripts/get-otp.ts) | Generates a 6-digit TOTP security token using the configured secret key. |

---

## 2. Command Details & Usage Examples

### 2.1 Mission Control Dashboard
Starts the unified HTTP server and static web dashboard.
```bash
npm run start-dashboard
```
- Open your browser at `http://localhost:3000`.
- Offers 5 interactive tabs: **Mission Control**, **Site Topology & KG**, **Workflow Macros**, **State Watchers**, and **Stealth & Health**.

---

### 2.2 Level 5 Benchmark Gauntlet
Executes the comprehensive 8-gate Level 5 gauntlet against the internal mock test site.
```bash
npm run benchmark:level5
```
- Validates: Site Topology (B01), Knowledge Graph (B02), Workflow Macros (B03), Behavioral Entropy (B04), Chaos Self-Healing (B05), Meta-Optimization (B06), State Watchers (B07), and Efficiency Analytics (B08).
- Automatically writes benchmark report to `benchmarks/level5-benchmark-report.md`.

---

### 2.3 State Watcher Management
Manages long-horizon asynchronous watcher daemons stored in SQLite.

#### List all registered watchers:
```bash
npm run watcher list
```

#### Register a new watcher daemon:
```bash
npm run watcher add -- --name "Price Monitor" --url "http://127.0.0.1:8080/products/1" --type "text_contains" --target "#stock-badge" --val "In Stock" --interval 15000 --jitter
```
**Supported Options:**
- `--name <string>`: Watcher job name.
- `--url <url>`: Target webpage URL.
- `--type <condition>`: Condition type (`text_contains`, `element_present`, `element_missing`, `price_below`, `price_above`, `regex_match`).
- `--target <selector>`: Target CSS selector or text identifier.
- `--val <value>`: Expected threshold or string pattern.
- `--trigger <type>`: Action trigger (`notify_hitl`, `execute_macro`, `execute_task`). Default: `notify_hitl`.
- `--interval <ms>`: Polling frequency in milliseconds. Default: `10000`.
- `--jitter`: Enable adaptive temporal variance ($\pm 20\%$) to evade bot profiling.

#### Pause an active watcher:
```bash
npm run watcher pause <watcher_id>
```

#### Resume a paused watcher:
```bash
npm run watcher resume <watcher_id>
```

#### Delete a watcher:
```bash
npm run watcher delete <watcher_id>
```

---

### 2.4 Browser Profile Health & Cache Maintenance
Audits the storage footprint of the long-lived Chromium profile in `data/browser-profile/`.

#### Inspect profile footprint:
```bash
npm run profile:health
```

#### Dry-run cache cleanup (inspect without deleting):
```bash
npm run profile:health -- --clean --dry-run
```

#### Execute safe ephemeral cache cleanup:
```bash
npm run profile:health -- --clean
```
> **Protected State:** Cookies, LocalStorage, and IndexedDB files are strictly preserved so login sessions and credentials remain active.

---

### 2.5 Site Topology & Route Graph Inspector
Visualizes route nodes and navigation transitions discovered by curiosity-driven exploration.

#### View all mapped domains:
```bash
npm run topology
```

#### Filter topology by specific domain:
```bash
npm run topology -- --domain store.local
```

---

### 2.6 Standalone Task Execution
Executes an autonomous task directly in the terminal without opening the web dashboard.
```bash
npm run run-task -- --goal "Find the contact email on http://127.0.0.1:8080/about" --max-steps 15
```

---

## 3. Developer & Verification Commands

```bash
# Typecheck entire codebase (strict zero-any policy)
npm run typecheck

# Execute complete test suite (66 test files, 493 tests)
npm test

# Run tests in watch mode during active development
npm run test:watch

# Compile TypeScript to JavaScript in dist/
npm run build
```
