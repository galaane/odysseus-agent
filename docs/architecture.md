# Odysseus Technical Architecture

## 1. System Overview & Core Philosophy

**Odysseus** is an autonomous browser agent built from scratch in TypeScript, utilizing Playwright Core and CloakBrowser as its persistent stealth Chromium runtime.

Unlike traditional disposable scrapers that launch and teardown browser contexts per operation, Odysseus treats a single persistent Chromium browser as the agent's long-lived workspace.

```text
                               ┌─────────────────────────────┐
                               │        User / Client        │
                               └──────────────┬──────────────┘
                                              │ HTTP / SSE
                                              ▼
                               ┌─────────────────────────────┐
                               │  Task API & Web Dashboard   │
                               │   (src/api/TaskServer.ts)   │
                               └──────────────┬──────────────┘
                                              │ Task Submission
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OdysseusAgent (Single Agent Runtime)                                                    │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Canonical AgentLoop                                                            │   │
│   │                                                                                │   │
│   │    Observe ───────────► Reason ───────────► Act ───────────► Evaluate ────┐     │   │
│   │       ▲                                                              │     │   │
│   │       └──────────────────────────────────────────────────────────────┘     │   │
│   └───────────────┬─────────────────┬───────────────────┬──────────────────────┘   │
│                   │                 │                   │                          │
│                   ▼                 ▼                   ▼                          │
│           ┌───────────────┐ ┌───────────────┐   ┌───────────────┐                  │
│           │ MemoryManager │ │  LLMProvider  │   │ ActionEngine  │                  │
│           │   (3-Tiers)   │ │  (OpenAI/Mock)│   │  (12 Actions) │                  │
│           └───────┬───────┘ └───────────────┘   └───────┬───────┘                  │
│                   │ SQLite                              │ Mutex                    │
│                   ▼                                     ▼                          │
│           ┌───────────────┐                     ┌───────────────┐                  │
│           │ SQLite Repo   │                     │ ActionMutex   │                  │
│           │ (data/agent)  │                     └───────┬───────┘                  │
│           └───────────────┘                             │ Serial Execution         │
│                                                         ▼                          │
│                                                 ┌───────────────┐                  │
│                                                 │ BrowserManager│                  │
│                                                 │ (CloakBrowser)│                  │
│                                                 └───────┬───────┘                  │
│                                                         │ Playwright Core          │
│                                                         ▼                          │
│                                                 ┌───────────────┐                  │
│                                                 │ Chromium Head │                  │
│                                                 │ (data/profile)│                  │
│                                                 └───────────────┘                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The 15 Architectural Invariants

Every line of code in Odysseus strictly complies with the 15 system invariants defined below:

1. **Single Agent:** Exactly 1 active agent runtime instance controlling execution flow. Concurrent tasks are rejected with HTTP 409 Conflict.
2. **Single Browser Session:** Exactly 1 active Chromium browser process managed via `BrowserManager`.
3. **Persistent Profile:** Browser profile is stored in `data/browser-profile/` and persists cookies, localStorage, and session state across restarts.
4. **Playwright Abstraction:** Browser automation uses official Playwright Core APIs for locators, frames, inputs, downloads, and events.
5. **CloakBrowser Runtime:** Chromium lifecycle and stealth patching are managed via `cloakbrowser.launchPersistentContext`.
6. **No Arbitrary JS Execution:** The LLM does not generate or execute arbitrary browser JavaScript (`page.evaluate(unvalidatedScript)`).
7. **Strictly Typed Actions:** All browser interactions use the 12 discriminated union action types validated via Zod schemas.
8. **Structured Observation:** Webpage observations are transformed into semantic snapshots with transient stable IDs (`e1`, `e2`) within a 2,000–4,000 token budget.
9. **Decoupled Memory & Browser State:** Browser cookies and DOM belong to Chromium; agent semantic memory (facts, goals, research findings) is persisted separately in SQLite (`data/agent.db`).
10. **Empirical Verification:** The agent verifies action outcomes via `Evaluator` (comparing page state deltas), never assuming an action succeeded merely because a click did not throw.
11. **Isolated Credentials:** Passwords and tokens never enter LLM memory, prompt histories, or log files. Credentials are directly injected into DOM elements via `CredentialInjector`.
12. **No Security Bypass:** Building CAPTCHA bypassers, MFA crackers, or anti-abuse exploit tools is strictly prohibited. If challenges occur, the agent halts with `VERIFICATION_REQUIRED`.
13. **Action Mutex:** All browser interactions execute serially using `ActionMutex` to prevent race conditions.
14. **Observable JSON Logs:** All actions, navigation events, and errors are emitted as structured NDJSON with automated secret redaction.
15. **Deterministic Testing:** 100% of integration and benchmark tests run against the local mock test site (`test-site/`), never third-party live websites.

---

## 3. Subsystem Breakdown

### 3.1 Browser Infrastructure (`src/browser/`)
- **`BrowserManager`:** Singleton managing the CloakBrowser Chromium process.
- **`ActionMutex`:** Concurrency lock ensuring single-threaded browser interactions.
- **`TabManager`:** Tracks open tabs, tab switching, and popups.
- **`PageManager`:** Handles active page lifecycle, dialogs, downloads, and navigation timeouts.
- **`BrowserWatchdog`:** Detects browser disconnections and crashes, executing Tier 5 process recovery.

### 3.2 Observation Subsystem (`src/observer/`)
- **`ElementRegistry`:** Assigns transient, deterministic IDs (`e1`, `e2`) to interactive elements.
- **`DOMObserver`:** Traverses DOM nodes to identify clickable, typable, and selectable elements.
- **`A11yObserver`:** Traverses the browser accessibility tree to capture semantic roles and names.
- **`ObservationCompressor`:** Prunes redundant branches, compresses whitespace, and bounds observation tokens to 2,000–4,000 tokens.

### 3.3 Reasoning & Agent Runtime (`src/agent/`)
- **`OdysseusAgent`:** Primary entry point enforcing the single-task execution policy.
- **`AgentLoop`:** Canonical execution loop coordinating prompt generation, LLM querying, action execution, empirical evaluation, and state checkpointing.
- **`AgentStateMachine`:** Enforces strictly valid state transitions: `idle` $\rightarrow$ `planning` $\rightarrow$ `acting` $\rightarrow$ `observing` $\rightarrow$ `evaluating` $\rightarrow$ `completed` / `failed` / `paused` / `stopped`.
- **`Evaluator`:** Evaluates state deltas between previous and current snapshots against expected outcomes.
- **`RecoveryManager`:** Implements the 6-tier recovery ladder for automatic fault recovery.

### 3.4 3-Tier Memory Subsystem (`src/memory/` & `src/persistence/`)
- **Tier 1 (Working Memory):** Ephemeral scratchpad for recent step facts, extracted text, and active task progress.
- **Tier 2 (Task Memory):** Visited URLs, completed milestones, attempted actions, and unresolved questions.
- **Tier 3 (Research Memory):** Cross-tab research findings, claims, and verified source citations.
- **Persistence:** Backed by SQLite (`data/agent.db`) via `TaskRepository`, `CheckpointRepository`, `ActionRepository`, and `ResearchRepository`. Supports step-level task resumption across process restarts.

### 3.5 Isolated Authentication Subsystem (`src/credentials/`)
- **`CredentialVault`:** In-memory store for account credentials with domain normalization and subdomain fallback. Masks secrets in `toJSON()` and `toString()`.
- **`CredentialInjector`:** Directly injects credentials into DOM input fields (`page.locator(...).fill(...)`), keeping plaintext secrets out of LLM prompts and log files.
- **Workflows (`LoginWorkflow`, `RegistrationWorkflow`):** Autonomous authentication flows that inspect for bot challenges and abort per Invariant 12.

### 3.6 Autonomous Research Engine (`src/research/`)
- **`SourceTracker`:** Tracks visited URLs, domains, and access timestamps with automatic deduplication.
- **`Finding` & `Evidence`:** Binds claims to citations, calculating domain corroboration confidence up to 0.99 for claims corroborated across $\ge 3$ distinct domains.
- **`DocumentParser`:** Native Node.js parser (`node:fs`, `node:zlib`) extracting structured text from JSON, CSV, HTML, TXT, and PDF files.
- **`ResearchEngine`:** Synthesizes structured research reports with summary markdown.

### 3.7 HTTP Task API & Web Dashboard (`src/api/`)
- **`TaskServer`:** Native `node:http` server exposing `POST /tasks`, `GET /tasks/:id`, `POST /tasks/:id/cancel`, `GET /events` (SSE), `GET /api/status`, and `GET /api/screenshot`.
- **Dashboard (`src/api/public/`):** Glassmorphic dark-mode web console for real-time monitoring and mission control.
