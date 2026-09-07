# 🧠 Level 5: Fully Autonomous Self-Evolving Web Agent Architecture

> Comprehensive technical specification of the Level 5 autonomous capabilities in the **Odysseus** browser agent runtime.

---

## 1. Overview of Level 5 Autonomy

Level 5 autonomy elevates Odysseus from an agent that merely executes user instructions step-by-step into a **persistent, self-evolving web agent**. A Level 5 agent continuously learns from its operational environment:
- **Distills repetitive workflows** into deterministic subroutines (Workflow Macros) that run without consuming LLM tokens.
- **Transfers structural knowledge** across disparate domains using a semantic Knowledge Graph.
- **Explores unknown web architectures** autonomously to construct navigable topology graphs.
- **Hardens its resilience** against DOM churn through automated chaos testing and self-healing pipelines.
- **Self-tunes execution hyperparameters** (retries, token budgets, risk aversion) based on empirical historical performance.
- **Monitors web state changes over long horizons** via asynchronous watchers with adaptive anti-fingerprint jitter.
- **Camouflages browser interactions** through human-biomimetic behavioral entropy and safe profile maintenance.

All Level 5 subsystems strictly adhere to the [15 Non-Negotiable Architectural Invariants](architecture.md#1-the-15-non-negotiable-architectural-invariants), executing under serial `ActionMutex` protection and maintaining zero external framework dependencies.

---

## 2. Architectural Subsystems

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           Odysseus Level 5 Architecture                           │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────┐   │
│   │ 1. Workflow Macros     │  │ 2. Knowledge Graph     │  │ 3. Exploration   │   │
│   │  • Deterministic Loop  │  │  • Domain Archetypes   │  │  • Site Topology │   │
│   │  • 2-Tier Self-Healing │  │  • Semantic Transfer   │  │  • Route Nodes   │   │
│   │  • Parameterization    │  │  • Bayesian Weights    │  │  • Pathfinding   │   │
│   └───────────┬────────────┘  └───────────┬────────────┘  └────────┬─────────┘   │
│               │                           │                        │             │
│               ▼                           ▼                        ▼             │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │               AgentLoop Orchestrator & ActionMutex Bridge                │   │
│   └───────────────────────────────────┬──────────────────────────────────────┘   │
│                                       │                                          │
│               ┌───────────────────────┼───────────────────────┐                  │
│               ▼                       ▼                       ▼                  │
│   ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────┐   │
│   │ 4. Meta-Optimizer      │  │ 5. State Watchers      │  │ 6. Stealth &     │   │
│   │  • Domain Parameters   │  │  • DOM Polling Daemon  │  │    Camouflage    │   │
│   │  • Bayesian Tuning     │  │  • Adaptive Jitter     │  │  • Bézier Curves │   │
│   │  • Trajectory Memory   │  │  • Event Triggers      │  │  • Cache Purge   │   │
│   └────────────────────────┘  └────────────────────────┘  └──────────────────┘   │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Subsystem Specifications

### 3.1 Self-Synthesizing Workflow Macros & Self-Healing Pipelines (`src/macros/`)

- **Macro Synthesis ([`MacroSynthesizer.ts`](file:///d:/AWS/odysseus-agent/src/macros/MacroSynthesizer.ts)):**
  Analyzes successful execution trajectories recorded in SQLite. When a workflow exhibits repeatable structure (e.g. search, add-to-cart, or form submission), the synthesizer distills the step sequence into a parameterized `WorkflowMacro` stored in `workflow_macros`.
- **Parameter Extraction ([`IntentExtractor.ts`](file:///d:/AWS/odysseus-agent/src/macros/IntentExtractor.ts)):**
  Replaces hardcoded string inputs with semantic placeholders (`{{query}}`, `{{productId}}`, `{{email}}`) using regex and pattern matching.
- **Deterministic Execution ([`MacroExecutor.ts`](file:///d:/AWS/odysseus-agent/src/macros/MacroExecutor.ts)):**
  Executes macro steps sequentially under `ActionMutex` without dispatching LLM queries, achieving sub-second latency and 100% token savings.
- **Two-Tier Self-Healing Pipeline ([`SelfHealingPipeline.ts`](file:///d:/AWS/odysseus-agent/src/macros/SelfHealingPipeline.ts)):**
  If a website changes its DOM structure, the macro step does not crash:
  1. *Tier 1 (Heuristic Repair):* Evaluates fallback selectors (semantic roles, accessible names, text content, and parent proximity).
  2. *Tier 2 (Multimodal Vision Repair):* Takes a visual viewport screenshot and queries multimodal LLM vision to ground the updated element coordinates. The macro definition is updated in SQLite automatically upon successful recovery.

### 3.2 Cross-Domain Web Knowledge Graph & Semantic Transfer (`src/graph/`)

- **Domain Archetypes ([`KnowledgeGraph.ts`](file:///d:/AWS/odysseus-agent/src/graph/KnowledgeGraph.ts)):**
  Classifies target websites into canonical archetypes: `ecommerce`, `auth_portal`, `saas_app`, `content_blog`, `booking_travel`, and `documentation`.
- **Transferable Concepts:**
  Each archetype is associated with standardized concepts (e.g. `search_input`, `add_to_cart_button`, `checkout_link`, `password_field`).
- **Empirical Bayesian Reinforcement:**
  Edges connecting archetypes and concepts track empirical reliability weights ($w \in [0.05, 1.0]$) and sample counts. Successful interactions reinforce weights ($w \leftarrow \min(1.0, w + 0.1 \times (1 - w))$), while failures trigger asymptotic penalties ($w \leftarrow \max(0.05, w - 0.15 \times w)$).
- **Zero-Shot Prior Warmup:**
  When navigating to an unfamiliar domain classified into an existing archetype, the agent leverages pre-learned conceptual locators and strategies immediately, cutting initial reasoning turns.

### 3.3 Curiosity-Driven Autonomous Exploration & Site Topology (`src/exploration/`)

- **Site Topology Graph ([`TopologyRepository.ts`](file:///d:/AWS/odysseus-agent/src/persistence/TopologyRepository.ts)):**
  Maintains route nodes and directed transition edges in SQLite (`site_topology_nodes` and `site_topology_edges`).
- **Affordance Mapping:**
  Every route node records depth, URL pattern, archetype, and extracted interactive affordances (`action_button`, `search`, `form`, `pagination`).
- **Autonomous Exploration Loop ([`CuriosityExplorer.ts`](file:///d:/AWS/odysseus-agent/src/exploration/CuriosityExplorer.ts)):**
  When in exploration mode, the agent discovers unexplored links, updates depth limits, and maps transitions without requiring human prompts.
- **Shortest-Path Navigation:**
  Implements Breadth-First Search (BFS) pathfinding over recorded edges to navigate from any arbitrary route to a target page deterministically in the minimum number of transitions.

### 3.4 Adversarial Self-Play & Chaos Testing (`src/chaos/`)

- **Chaos Engine ([`ChaosEngine.ts`](file:///d:/AWS/odysseus-agent/src/chaos/ChaosEngine.ts)):**
  Injects controlled runtime faults against the local mock test site to stress-test agent recovery routines:
  - *DOM Element Mutation:* Alters element IDs, class names, and button text before click dispatch.
  - *Network Latency Injection:* Introduces simulated packet delays and artificial timeouts.
  - *Transient Obstruction:* Pops unexpected cookie banners, modal overlays, or backdrop blockers.
- **Verification Gauntlet:**
  Proves empirical recovery rates before shipping code updates, guaranteeing that transient anomalies are handled gracefully by the agent recovery ladder.

### 3.5 Empirical Prompt & Hyperparameter Meta-Optimization (`src/optimization/`)

- **Hierarchical Fallback ([`HyperparameterRepository.ts`](file:///d:/AWS/odysseus-agent/src/persistence/HyperparameterRepository.ts)):**
  Resolves execution parameters hierarchically:
  1. Exact Domain Match (e.g. `store.local`)
  2. Archetype Match (e.g. `ecommerce`)
  3. Global Repository Match
  4. Built-in System Default
- **Bayesian Auto-Tuning ([`MetaOptimizer.ts`](file:///d:/AWS/odysseus-agent/src/optimization/MetaOptimizer.ts)):**
  Analyzes completed task trajectories. On frequent timeout failures, the optimizer automatically reduces `riskAversionFactor` and boosts `tokenBudget`. On consistent high-efficiency successes, it tightens token allowances to minimize operational costs.

### 3.6 Long-Horizon Asynchronous State Watchers (`src/watcher/`)

- **Persistent Daemon ([`StateWatcherEngine.ts`](file:///d:/AWS/odysseus-agent/src/watcher/StateWatcherEngine.ts)):**
  Monitors periodic web state changes across long intervals without keeping active foreground tasks blocked.
- **Condition Evaluator ([`ConditionEvaluator.ts`](file:///d:/AWS/odysseus-agent/src/watcher/ConditionEvaluator.ts)):**
  Supports 6 strictly-typed DOM conditions:
  - `text_contains`: Text matches target pattern.
  - `element_present`: Element matching selector exists.
  - `element_missing`: Element disappeared from DOM.
  - `price_below`: Numerical currency extracted is $\le$ threshold.
  - `price_above`: Numerical currency extracted is $\ge$ threshold.
  - `regex_match`: Element content matches regular expression.
- **Adaptive Jitter:**
  Introduces pseudo-random temporal variance ($\pm 20\%$) across polling intervals to prevent detection by anti-scraping cadence analyzers.
- **Action Triggers:**
  Dispatches notifications to Human-In-The-Loop (`notify_hitl`), executes a pre-compiled macro (`execute_macro`), or resumes an autonomous agent task (`execute_task`).

### 3.7 Behavioral Entropy & Organic Profile Camouflage (`src/stealth/`)

- **Cubic Bézier Trajectories ([`MousePhysics.ts`](file:///d:/AWS/odysseus-agent/src/stealth/MousePhysics.ts)):**
  Synthesizes curved cursor trajectories using non-linear control points, natural overshoot compensation, and bell-shaped velocity profiles that model human hand movement.
- **Gaussian Keystroke Jitter ([`KeystrokeDynamics.ts`](file:///d:/AWS/odysseus-agent/src/stealth/KeystrokeDynamics.ts)):**
  Emits keystrokes with randomized delays drawn from normal distributions, incorporating occasional inter-word cognitive pauses (200–500ms).
- **Profile Health Monitor ([`ProfileHealthMonitor.ts`](file:///d:/AWS/odysseus-agent/src/stealth/ProfileHealthMonitor.ts)):**
  Audits disk footprint and orphaned dump files in `data/browser-profile/`.
- **Safe Ephemeral Sanitization:**
  Purges temporary shader caches, GPU caches, code caches, and crashpad dumps while strictly preserving `Cookies`, `Local Storage`, and `IndexedDB` to keep user authentication sessions active indefinitely.

---

## 4. Empirical Performance Benchmarks

As proven in the [Level 5 Benchmark Gauntlet Report](file:///d:/AWS/odysseus-agent/benchmarks/level5-benchmark-report.md), Level 5 autonomy achieves substantial efficiency gains over classical Level 1–4 agents:

| Metric | Level 1–4 Baseline | Level 5 Autonomous | Improvement |
| :--- | :--- | :--- | :--- |
| **Workflow Replay Latency** | ~12.4s (3-turn LLM reasoning) | **~0.43s** (Direct Macro execution) | **96.5% Faster** |
| **LLM Token Consumption** | ~4,850 tokens / task | **0 tokens** (Deterministic replay) | **100.0% Token Savings** |
| **DOM Churn Resilience** | 0% (Fatal Locator Exception) | **100%** (Self-Healing Repair) | **Zero-Crash Resilience** |
| **Input Camouflage** | Linear instant clicks (Detectable) | **Cubic Bézier + Gaussian Jitter** | **Human Biomimetic Grade** |
| **Background Monitoring** | Blocking synchronous polling | **Asynchronous Mutex Watchers** | **Non-blocking Event Daemon** |
| **Overall Resilience Index**| 45.0% | **100.0%** | **+55.0% Gain** |
