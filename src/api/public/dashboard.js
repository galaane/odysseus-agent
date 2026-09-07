/**
 * Odysseus Dashboard Frontend Controller
 * Connects to Task API, Level 5 Autonomous Subsystems, and Server-Sent Events (SSE) stream.
 */

let activeTaskId = null;
let currentEventSource = null;
let activeTabName = 'mission-control';

const dom = {
  // Navigation & Tabs
  tabsNav: document.getElementById('dashboard-tabs'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Navbar & Header
  statusBadge: document.getElementById('agent-status-badge'),
  statusText: document.getElementById('agent-status-text'),
  activeTabUrl: document.getElementById('active-tab-url'),

  // Metrics Bar
  taskId: document.getElementById('metric-task-id'),
  stepCount: document.getElementById('metric-step-count'),
  progressFill: document.getElementById('progress-fill'),
  findingsCount: document.getElementById('metric-findings-count'),
  findingsBadge: document.getElementById('findings-badge'),
  sseStatus: document.getElementById('metric-sse-status'),

  // Mission Control
  taskForm: document.getElementById('task-form'),
  goalInput: document.getElementById('task-goal-input'),
  stepsInput: document.getElementById('task-steps-input'),
  timeoutInput: document.getElementById('task-timeout-input'),
  btnSubmit: document.getElementById('btn-submit-task'),
  btnCancel: document.getElementById('btn-cancel-task'),
  terminalOutput: document.getElementById('terminal-output'),
  terminalAutoScroll: document.getElementById('terminal-autoscroll'),
  btnClearTerminal: document.getElementById('btn-clear-terminal'),
  findingsFeed: document.getElementById('findings-feed'),
  findingsEmpty: document.getElementById('findings-empty'),
  screenshotImg: document.getElementById('screenshot-img'),
  viewportPlaceholder: document.getElementById('viewport-placeholder'),
  btnRefreshScreenshot: document.getElementById('btn-refresh-screenshot'),
  hitlBanner: document.getElementById('hitl-banner'),
  hitlReason: document.getElementById('hitl-reason'),
  btnResolveIntervention: document.getElementById('btn-resolve-intervention'),

  // System 2 Deliberation
  deliberationBadge: document.getElementById('deliberation-step-badge'),
  deliberationEmpty: document.getElementById('deliberation-empty'),
  deliberationContent: document.getElementById('deliberation-content'),
  delibObs: document.getElementById('delib-obs'),
  delibObstacle: document.getElementById('delib-obstacle'),
  delibAlt: document.getElementById('delib-alt'),
  delibRisk: document.getElementById('delib-risk'),

  // Tab: Site Topology & KG
  topologyDomainSelect: document.getElementById('topology-domain-select'),
  btnRefreshTopology: document.getElementById('btn-refresh-topology'),
  topologyNodesList: document.getElementById('topology-nodes-list'),
  topologyEdgesList: document.getElementById('topology-edges-list'),
  topologyNodeCount: document.getElementById('topology-node-count'),
  topologyEdgeCount: document.getElementById('topology-edge-count'),
  kgConceptsList: document.getElementById('kg-concepts-list'),
  kgConceptCount: document.getElementById('kg-concept-count'),

  // Tab: Workflow Macros
  btnRefreshMacros: document.getElementById('btn-refresh-macros'),
  macrosList: document.getElementById('macros-list'),

  // Tab: State Watchers
  btnToggleWatcherForm: document.getElementById('btn-toggle-watcher-form'),
  btnCloseWatcherForm: document.getElementById('btn-close-watcher-form'),
  btnRefreshWatchers: document.getElementById('btn-refresh-watchers'),
  watcherCreateCard: document.getElementById('watcher-create-card'),
  watcherForm: document.getElementById('watcher-form'),
  watchersTbody: document.getElementById('watchers-tbody'),
  watchersCount: document.getElementById('watchers-count'),

  // Tab: Stealth & Profile Health
  btnRefreshStealth: document.getElementById('btn-refresh-stealth'),
  btnCleanProfile: document.getElementById('btn-clean-profile'),
  profileDirPath: document.getElementById('profile-dir-path'),
  profileHealthBadge: document.getElementById('profile-health-badge'),
  profileDiskUsage: document.getElementById('profile-disk-usage'),
  profileCacheUsage: document.getElementById('profile-cache-usage'),
  profileOrphans: document.getElementById('profile-orphans'),
  hyperparametersList: document.getElementById('hyperparameters-list'),
  hyperparametersCount: document.getElementById('hyperparameters-count'),
};

// Initialize Dashboard
function init() {
  connectSSE();
  setupEventListeners();
  pollStatus();
  setInterval(pollStatus, 3000);
}

// Switch Active Navigation Tab
function switchTab(tabId) {
  activeTabName = tabId;
  dom.tabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  dom.tabContents.forEach((content) => {
    const isTarget = content.id === `tab-${tabId}`;
    content.classList.toggle('active', isTarget);
    content.classList.toggle('hidden', !isTarget);
  });

  if (tabId === 'topology') {
    loadTopology();
    loadKnowledgeGraph();
  } else if (tabId === 'macros') {
    loadMacros();
  } else if (tabId === 'watchers') {
    loadWatchers();
  } else if (tabId === 'stealth') {
    loadProfileHealth();
    loadHyperparameters();
  }
}

// Connect to Server-Sent Events stream
function connectSSE() {
  if (currentEventSource) {
    currentEventSource.close();
  }

  currentEventSource = new EventSource('/events');

  currentEventSource.onopen = () => {
    dom.sseStatus.textContent = 'Active (Live)';
    dom.sseStatus.className = 'metric-value sse-connected';
    appendTerminalEntry('system', 'SSE connection established with Odysseus backend.');
  };

  currentEventSource.onerror = () => {
    dom.sseStatus.textContent = 'Disconnected';
    dom.sseStatus.className = 'metric-value';
  };

  currentEventSource.addEventListener('ready', (e) => {
    const data = JSON.parse(e.data || '{}');
    appendTerminalEntry('system', `Server ready: ${data.status || 'online'}`);
  });

  // Listen to domain events
  const domainEvents = [
    'agent.started',
    'agent.completed',
    'agent.failed',
    'agent.state_changed',
    'agent.deliberation',
    'agent.intervention_required',
    'agent.intervention_resolved',
    'task.created',
    'task.checkpoint',
    'task.completed',
    'task.failed',
    'task.cancelled',
    'browser.started',
    'browser.crashed',
    'action.started',
    'action.completed',
    'action.failed',
    'watcher.created',
    'watcher.updated',
    'watcher.deleted',
    'macro.replayed',
    'macro.deleted',
    'stealth.cleaned',
  ];

  for (const ev of domainEvents) {
    currentEventSource.addEventListener(ev, (e) => {
      try {
        const parsed = JSON.parse(e.data || '{}');
        handleDomainEvent(ev, parsed);
      } catch {
        appendTerminalEntry('system', `Raw event [${ev}]: ${e.data}`);
      }
    });
  }
}

// Handle incoming SSE domain events
function handleDomainEvent(eventType, data) {
  const category = eventType.split('.')[0] || 'info';
  const detail = data.payload || data;
  const message = formatEventMessage(eventType, detail);

  appendTerminalEntry(category, message);

  if (eventType === 'task.created') {
    activeTaskId = detail.taskId || data.taskId;
    dom.taskId.textContent = activeTaskId;
    dom.btnCancel.disabled = false;
    dom.btnSubmit.disabled = true;
    updateStatusBadge('running');
  } else if (eventType === 'task.checkpoint') {
    const step = detail.step ?? 0;
    const max = detail.maxSteps ?? 50;
    updateProgress(step, max);
    captureScreenshot();
  } else if (eventType === 'task.completed' || eventType === 'task.failed' || eventType === 'task.cancelled') {
    dom.btnCancel.disabled = true;
    dom.btnSubmit.disabled = false;
    dom.hitlBanner.classList.add('hidden');
    activeTaskId = null;
    pollStatus();
  } else if (eventType === 'agent.state_changed') {
    const state = detail.state || detail.to;
    if (state) {
      updateStatusBadge(state);
      if (state === 'waiting_human_intervention') {
        dom.hitlBanner.classList.remove('hidden');
      } else {
        dom.hitlBanner.classList.add('hidden');
      }
    }
  } else if (eventType === 'agent.deliberation') {
    const delib = detail.deliberation;
    if (delib) {
      dom.delibObs.textContent = delib.observation_analysis || 'Observation analyzed';
      dom.delibObstacle.textContent = delib.encountered_obstacles || 'None detected';
      dom.delibAlt.textContent = delib.alternative_considered || 'Optimal route selected';
      dom.delibRisk.textContent = delib.risk_assessment || 'Low risk';
      dom.deliberationBadge.textContent = `Step ${detail.step ?? 0}`;
      dom.deliberationContent.classList.remove('hidden');
      dom.deliberationEmpty.classList.add('hidden');
    }
    captureScreenshot();
  } else if (eventType === 'agent.intervention_required') {
    dom.hitlBanner.classList.remove('hidden');
    if (detail.reasoning) {
      dom.hitlReason.textContent = `External Barrier: ${detail.reasoning}`;
    }
    updateStatusBadge('waiting_human_intervention');
    captureScreenshot();
  } else if (eventType === 'agent.intervention_resolved') {
    dom.hitlBanner.classList.add('hidden');
    updateStatusBadge('running');
  } else if (eventType.startsWith('watcher.')) {
    if (activeTabName === 'watchers') loadWatchers();
  } else if (eventType.startsWith('macro.')) {
    if (activeTabName === 'macros') loadMacros();
  } else if (eventType === 'stealth.cleaned') {
    if (activeTabName === 'stealth') loadProfileHealth();
  }
}

function formatEventMessage(eventType, detail) {
  if (detail.reasoning) return `[${eventType}] ${detail.reasoning}`;
  if (detail.goal) return `[${eventType}] Goal: "${detail.goal}"`;
  if (detail.error) return `[${eventType}] Error: ${detail.error}`;
  if (detail.status) return `[${eventType}] Status: ${detail.status}`;
  return `[${eventType}] ${JSON.stringify(detail)}`;
}

// Terminal logger
function appendTerminalEntry(category, message) {
  const entry = document.createElement('div');
  entry.className = 'terminal-entry';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'time';
  timeSpan.textContent = new Date().toLocaleTimeString();

  const badgeSpan = document.createElement('span');
  badgeSpan.className = `badge badge-${category}`;
  badgeSpan.textContent = category.toUpperCase();

  const msgSpan = document.createElement('span');
  msgSpan.className = 'msg';
  msgSpan.textContent = message;

  entry.appendChild(timeSpan);
  entry.appendChild(badgeSpan);
  entry.appendChild(msgSpan);

  dom.terminalOutput.appendChild(entry);

  if (dom.terminalAutoScroll.checked) {
    dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
  }
}

// Update Status Badge
function updateStatusBadge(state) {
  const s = String(state || 'idle').toLowerCase();
  dom.statusBadge.className = `status-badge ${s}`;
  dom.statusText.textContent = s.toUpperCase();
}

// Update Step Progress
function updateProgress(step, max) {
  dom.stepCount.textContent = `${step} / ${max} Steps`;
  const pct = Math.min(100, Math.round((step / Math.max(1, max)) * 100));
  dom.progressFill.style.width = `${pct}%`;
}

// Poll Agent and Task Status
async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    updateStatusBadge(data.agentState);

    if (data.agentState === 'waiting_human_intervention') {
      dom.hitlBanner.classList.remove('hidden');
    } else if (!activeTaskId || data.agentState !== 'waiting_human_intervention') {
      dom.hitlBanner.classList.add('hidden');
    }

    if (data.activeTab?.url) {
      dom.activeTabUrl.textContent = data.activeTab.url;
    }

    if (data.activeTaskId) {
      activeTaskId = data.activeTaskId;
      dom.taskId.textContent = activeTaskId;
      dom.btnCancel.disabled = false;
      dom.btnSubmit.disabled = true;

      const taskRes = await fetch(`/tasks/${activeTaskId}`);
      if (taskRes.ok) {
        const taskData = await taskRes.json();
        updateProgress(taskData.stepCount || 0, taskData.maxSteps || 50);
        renderFindings(taskData.findings || []);
      }
    } else {
      if (!activeTaskId) {
        dom.btnCancel.disabled = true;
        dom.btnSubmit.disabled = false;
      }
    }
  } catch {
    // Ignore transient network errors
  }
}

// Render Research Findings
function renderFindings(findings) {
  dom.findingsCount.textContent = findings.length;
  dom.findingsBadge.textContent = `${findings.length} Verified`;

  if (findings.length === 0) {
    if (dom.findingsEmpty) dom.findingsEmpty.style.display = 'block';
    return;
  }

  if (dom.findingsEmpty) dom.findingsEmpty.style.display = 'none';

  dom.findingsFeed.innerHTML = '';
  for (const f of findings) {
    const item = document.createElement('div');
    item.className = 'finding-item';

    const claim = document.createElement('div');
    claim.className = 'finding-claim';
    claim.textContent = f.claim;

    const meta = document.createElement('div');
    meta.className = 'finding-meta';

    const conf = document.createElement('span');
    conf.className = 'confidence-pill';
    conf.textContent = f.confidence ? `${Math.round(f.confidence * 100)}% Verified` : 'Verified';

    const sources = document.createElement('span');
    sources.className = 'finding-sources';
    const sourceUrls = f.sourceUrls || f.sources || [];
    sources.innerHTML = sourceUrls
      .map((url, i) => `<a href="${url}" target="_blank" rel="noopener">Source ${i + 1}</a>`)
      .join(', ');

    meta.appendChild(conf);
    meta.appendChild(sources);
    item.appendChild(claim);
    item.appendChild(meta);
    dom.findingsFeed.appendChild(item);
  }
}

// Screenshot capture
async function captureScreenshot() {
  try {
    const res = await fetch('/api/screenshot');
    if (!res.ok) {
      appendTerminalEntry('system', 'No active webpage screenshot available.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    dom.screenshotImg.src = url;
    dom.screenshotImg.classList.remove('hidden');
    dom.viewportPlaceholder.classList.add('hidden');
  } catch (err) {
    appendTerminalEntry('error', `Failed to load screenshot: ${String(err)}`);
  }
}

// -------------------------------------------------------------
// Level 5 Subsystems: Loaders & Handlers
// -------------------------------------------------------------

// 1. Site Topology
async function loadTopology() {
  try {
    const selectedDomain = dom.topologyDomainSelect?.value || '';
    const url = selectedDomain ? `/api/topology?domain=${encodeURIComponent(selectedDomain)}` : '/api/topology';
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    if (data.domains && dom.topologyDomainSelect) {
      const current = dom.topologyDomainSelect.value;
      dom.topologyDomainSelect.innerHTML = '<option value="">All Domains</option>';
      for (const d of data.domains) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        if (d === current) opt.selected = true;
        dom.topologyDomainSelect.appendChild(opt);
      }
    }

    const nodes = data.nodes || [];
    const edges = data.edges || [];

    dom.topologyNodeCount.textContent = `${nodes.length} Nodes`;
    dom.topologyEdgeCount.textContent = `${edges.length} Edges`;

    if (nodes.length === 0) {
      dom.topologyNodesList.innerHTML = '<div class="empty-state">No topology nodes discovered yet. Execute tasks to build site map.</div>';
    } else {
      dom.topologyNodesList.innerHTML = '';
      for (const node of nodes) {
        const card = document.createElement('div');
        card.className = 'node-card';

        const header = document.createElement('div');
        header.className = 'node-card-header';
        header.innerHTML = `
          <span class="node-path">${escapeHtml(node.path)}</span>
          <span class="badge-archetype">${escapeHtml(node.archetype || 'general')}</span>
        `;

        const meta = document.createElement('div');
        meta.className = 'node-meta';
        meta.innerHTML = `
          <span>Domain: <strong>${escapeHtml(node.domain)}</strong></span>
          <span>Depth: ${node.depth}</span>
          <span>Affordances: ${(node.affordances || []).length}</span>
        `;

        card.appendChild(header);
        card.appendChild(meta);

        if (node.affordances && node.affordances.length > 0) {
          const chips = document.createElement('div');
          chips.className = 'affordance-chips';
          for (const aff of node.affordances.slice(0, 6)) {
            const chip = document.createElement('span');
            chip.className = 'affordance-chip';
            chip.textContent = `${aff.action}:${aff.role || aff.name || aff.selector.slice(0, 15)}`;
            chips.appendChild(chip);
          }
          card.appendChild(chips);
        }

        dom.topologyNodesList.appendChild(card);
      }
    }

    if (edges.length === 0) {
      dom.topologyEdgesList.innerHTML = '<div class="empty-state">No navigation transitions recorded.</div>';
    } else {
      dom.topologyEdgesList.innerHTML = '';
      for (const edge of edges) {
        const card = document.createElement('div');
        card.className = 'edge-card';
        card.innerHTML = `
          <div class="edge-transition">
            <span>${escapeHtml(edge.sourcePath)}</span>
            <span class="edge-arrow">&rarr;</span>
            <span>${escapeHtml(edge.targetPath)}</span>
          </div>
          <div class="node-meta">
            <span class="edge-type-badge">${escapeHtml(edge.transitionType)}</span>
            <span>Weight: <strong>${Number(edge.weight).toFixed(2)}</strong></span>
            <span>Trigger: ${escapeHtml(edge.triggerRole || edge.triggerName || edge.triggerSelector)}</span>
          </div>
        `;
        dom.topologyEdgesList.appendChild(card);
      }
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed loading topology: ${String(err)}`);
  }
}

// 2. Knowledge Graph Archetypes
async function loadKnowledgeGraph() {
  try {
    const res = await fetch('/api/knowledge-graph');
    if (!res.ok) return;
    const data = await res.json();

    const nodes = data.nodes || [];
    const concepts = nodes.filter((n) => n.type === 'concept');
    dom.kgConceptCount.textContent = `${concepts.length} Concepts`;

    if (concepts.length === 0) {
      dom.kgConceptsList.innerHTML = '<div class="empty-state">No transferable concepts in knowledge graph.</div>';
      return;
    }

    dom.kgConceptsList.innerHTML = '';
    for (const concept of concepts) {
      const card = document.createElement('div');
      card.className = 'concept-card';

      const header = document.createElement('div');
      header.className = 'concept-card-header';
      header.innerHTML = `
        <span class="node-path">${escapeHtml(concept.name)}</span>
        <span class="badge-archetype">${escapeHtml(concept.properties?.archetype || 'concept')}</span>
      `;

      const meta = document.createElement('div');
      meta.className = 'concept-meta';
      const hint = concept.properties?.strategyHint ? `Strategy: ${escapeHtml(concept.properties.strategyHint)}` : '';
      meta.textContent = hint;

      const meter = document.createElement('div');
      meter.className = 'reliability-meter';
      const relPct = Math.round(Number(concept.properties?.reliability ?? 0.8) * 100);
      meter.innerHTML = `
        <span style="font-size: 0.7rem; color: var(--text-dim);">Transfer Reliability:</span>
        <div class="meter-track"><div class="meter-fill" style="width: ${relPct}%;"></div></div>
        <span class="meter-val">${relPct}%</span>
      `;

      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(meter);
      dom.kgConceptsList.appendChild(card);
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed loading knowledge graph: ${String(err)}`);
  }
}

// 3. Workflow Macros
async function loadMacros() {
  try {
    const res = await fetch('/api/macros');
    if (!res.ok) return;
    const data = await res.json();
    const macros = data.macros || [];

    if (macros.length === 0) {
      dom.macrosList.innerHTML = '<div class="empty-state">No workflow macros registered yet. The agent distills macros from repeatable verified workflows.</div>';
      return;
    }

    dom.macrosList.innerHTML = '';
    for (const macro of macros) {
      const card = document.createElement('div');
      card.className = 'macro-card';

      const statusClass = macro.status || 'provisional';
      const stepsCount = (macro.steps || []).length;
      const successCount = macro.successCount || 0;
      const failureCount = macro.failureCount || 0;

      card.innerHTML = `
        <div class="macro-header">
          <div>
            <div class="macro-title">${escapeHtml(macro.domain)}</div>
            <div class="macro-intent">${escapeHtml(macro.intentKey)}</div>
          </div>
          <span class="badge-macro-status ${statusClass}">${statusClass}</span>
        </div>
        <div class="macro-stats">
          <span>Steps: <strong>${stepsCount}</strong></span>
          <span>Successes: <strong>${successCount}</strong></span>
          <span>Failures: <strong>${failureCount}</strong></span>
        </div>
        <div class="macro-steps-preview">
          ${(macro.steps || []).map((s, i) => `<div>${i + 1}. ${escapeHtml(s.actionTemplate.action)} (${escapeHtml(s.actionTemplate.selector || s.actionTemplate.url || '')})</div>`).join('')}
        </div>
        <div class="macro-actions">
          <button type="button" class="btn btn-sm btn-primary btn-replay-macro" data-id="${macro.id}">Replay Routine</button>
          <button type="button" class="btn btn-sm btn-danger btn-delete-macro" data-id="${macro.id}">Delete</button>
        </div>
      `;

      card.querySelector('.btn-replay-macro').addEventListener('click', () => replayMacro(macro.id));
      card.querySelector('.btn-delete-macro').addEventListener('click', () => deleteMacro(macro.id));

      dom.macrosList.appendChild(card);
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed loading macros: ${String(err)}`);
  }
}

async function replayMacro(macroId) {
  appendTerminalEntry('system', `Dispatching deterministic macro replay [${macroId}]...`);
  try {
    const res = await fetch(`/api/macros/${macroId}/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: {} }),
    });
    const result = await res.json();
    if (res.ok && result.success) {
      appendTerminalEntry('system', `Macro replay [${macroId}] succeeded (${result.executedSteps} steps, ${result.healedSteps} healed, ${result.durationMs}ms)`);
      loadMacros();
    } else {
      appendTerminalEntry('error', `Macro replay failed: ${result.error || res.statusText}`);
    }
  } catch (err) {
    appendTerminalEntry('error', `Error replaying macro: ${String(err)}`);
  }
}

async function deleteMacro(macroId) {
  if (!confirm(`Delete workflow macro [${macroId}]?`)) return;
  try {
    const res = await fetch(`/api/macros/${macroId}`, { method: 'DELETE' });
    if (res.ok) {
      appendTerminalEntry('system', `Macro [${macroId}] deleted.`);
      loadMacros();
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed deleting macro: ${String(err)}`);
  }
}

// 4. State Watchers
async function loadWatchers() {
  try {
    const res = await fetch('/api/watchers');
    if (!res.ok) return;
    const data = await res.json();
    const watchers = data.watchers || [];

    dom.watchersCount.textContent = `${watchers.length} Watchers`;

    if (watchers.length === 0) {
      dom.watchersTbody.innerHTML = '<tr><td colspan="8" class="text-center empty-td">No watchers configured yet. Click "New Watcher" to register.</td></tr>';
      return;
    }

    dom.watchersTbody.innerHTML = '';
    for (const w of watchers) {
      const tr = document.createElement('tr');
      const status = w.status || 'active';
      const lastCheck = w.lastCheckedAt ? new Date(w.lastCheckedAt).toLocaleTimeString() : 'Pending';

      tr.innerHTML = `
        <td><span class="status-chip ${status}">${status}</span></td>
        <td><strong>${escapeHtml(w.name)}</strong></td>
        <td><code class="code-path">${escapeHtml(w.targetUrl)}</code></td>
        <td><code>${escapeHtml(w.conditionType)} (${escapeHtml(w.conditionTarget || '')})</code></td>
        <td><span class="badge-archetype">${escapeHtml(w.triggerType)}</span></td>
        <td>${w.intervalMs}ms ${w.adaptiveJitter ? '(jitter)' : ''}</td>
        <td>${lastCheck}</td>
        <td>
          <button type="button" class="btn-sm btn-action-watcher" data-action="${status === 'active' ? 'pause' : 'resume'}" data-id="${w.id}">
            ${status === 'active' ? 'Pause' : 'Resume'}
          </button>
          <button type="button" class="btn-sm btn-danger btn-delete-watcher" data-id="${w.id}">
            &times;
          </button>
        </td>
      `;

      tr.querySelector('.btn-action-watcher').addEventListener('click', (e) => {
        const act = e.target.dataset.action;
        if (act === 'pause') pauseWatcher(w.id);
        else resumeWatcher(w.id);
      });

      tr.querySelector('.btn-delete-watcher').addEventListener('click', () => deleteWatcher(w.id));

      dom.watchersTbody.appendChild(tr);
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed loading watchers: ${String(err)}`);
  }
}

async function pauseWatcher(id) {
  try {
    const res = await fetch(`/api/watchers/${id}/pause`, { method: 'POST' });
    if (res.ok) {
      appendTerminalEntry('system', `Watcher daemon [${id}] paused.`);
      loadWatchers();
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed pausing watcher: ${String(err)}`);
  }
}

async function resumeWatcher(id) {
  try {
    const res = await fetch(`/api/watchers/${id}/resume`, { method: 'POST' });
    if (res.ok) {
      appendTerminalEntry('system', `Watcher daemon [${id}] resumed.`);
      loadWatchers();
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed resuming watcher: ${String(err)}`);
  }
}

async function deleteWatcher(id) {
  if (!confirm(`Delete watcher daemon [${id}]?`)) return;
  try {
    const res = await fetch(`/api/watchers/${id}`, { method: 'DELETE' });
    if (res.ok) {
      appendTerminalEntry('system', `Watcher daemon [${id}] deleted.`);
      loadWatchers();
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed deleting watcher: ${String(err)}`);
  }
}

// 5. Stealth & Profile Health
async function loadProfileHealth() {
  try {
    const res = await fetch('/api/stealth/profile-health');
    if (!res.ok) return;
    const report = await res.json();

    if (dom.profileDirPath) dom.profileDirPath.textContent = report.profileDir || 'data/browser-profile';

    const diskMb = (Number(report.diskUsageBytes || 0) / (1024 * 1024)).toFixed(1);
    const cacheMb = (Number(report.cacheUsageBytes || 0) / (1024 * 1024)).toFixed(1);
    const orphans = report.orphanedFilesCount ?? 0;
    const status = report.status || 'optimal';

    dom.profileDiskUsage.textContent = `${diskMb} MB`;
    dom.profileCacheUsage.textContent = `${cacheMb} MB`;
    dom.profileOrphans.textContent = `${orphans} files`;

    dom.profileHealthBadge.className = `health-status-badge ${status}`;
    dom.profileHealthBadge.textContent = status.toUpperCase();
  } catch (err) {
    appendTerminalEntry('error', `Failed loading profile health: ${String(err)}`);
  }
}

async function cleanProfile() {
  if (!confirm('Purge ephemeral Chromium cache files?\n\nAuthentication cookies, local storage, and sessions will remain strictly protected.')) {
    return;
  }
  dom.btnCleanProfile.disabled = true;
  appendTerminalEntry('system', 'Purging ephemeral cache files...');

  try {
    const res = await fetch('/api/stealth/profile-clean', { method: 'POST' });
    const result = await res.json();
    if (res.ok) {
      const freedMb = (Number(result.freedBytes || 0) / (1024 * 1024)).toFixed(1);
      appendTerminalEntry('system', `Cache purge complete. Freed ${freedMb} MB across ${result.deletedFiles} files.`);
      loadProfileHealth();
    } else {
      appendTerminalEntry('error', `Cache purge failed: ${result.error || res.statusText}`);
    }
  } catch (err) {
    appendTerminalEntry('error', `Error purging profile cache: ${String(err)}`);
  } finally {
    dom.btnCleanProfile.disabled = false;
  }
}

// 6. Hyperparameters
async function loadHyperparameters() {
  try {
    const res = await fetch('/api/optimization/hyperparameters');
    if (!res.ok) return;
    const data = await res.json();
    const params = data.hyperparameters || [];

    dom.hyperparametersCount.textContent = `${params.length} Tuned Sets`;

    if (params.length === 0) {
      dom.hyperparametersList.innerHTML = '<div class="empty-state">No domain-specific hyperparameters recorded yet. The agent adapts parameters autonomously during task execution.</div>';
      return;
    }

    dom.hyperparametersList.innerHTML = '';
    for (const p of params) {
      const card = document.createElement('div');
      card.className = 'param-card';

      card.innerHTML = `
        <div class="param-header">
          <span class="param-domain">${escapeHtml(p.domainOrArchetype)}</span>
          <span class="badge-archetype">Samples: ${p.sampleCount} (Success: ${p.successCount})</span>
        </div>
        <div class="param-grid">
          <div class="param-item">
            <span class="param-label">Risk Aversion</span>
            <span class="param-val">${Number(p.riskAversionFactor).toFixed(2)}</span>
          </div>
          <div class="param-item">
            <span class="param-label">Max Retries</span>
            <span class="param-val">${p.maxRetries}</span>
          </div>
          <div class="param-item">
            <span class="param-label">Token Budget</span>
            <span class="param-val">${p.tokenBudget}</span>
          </div>
          <div class="param-item">
            <span class="param-label">Frustration Thresh</span>
            <span class="param-val">${p.frustrationThreshold}</span>
          </div>
        </div>
      `;

      dom.hyperparametersList.appendChild(card);
    }
  } catch (err) {
    appendTerminalEntry('error', `Failed loading hyperparameters: ${String(err)}`);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------
// Event Listeners Setup
// -------------------------------------------------------------
function setupEventListeners() {
  // Navigation Tabs
  dom.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Task Form Submit
  dom.taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const goal = dom.goalInput.value.trim();
    if (!goal) return;

    const maxSteps = parseInt(dom.stepsInput.value, 10) || 30;
    const maxDurationMs = (parseInt(dom.timeoutInput.value, 10) || 300) * 1000;

    dom.btnSubmit.disabled = true;
    appendTerminalEntry('task', `Submitting task: "${goal}"...`);

    try {
      const res = await fetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, maxSteps, maxDurationMs }),
      });

      if (!res.ok) {
        const err = await res.json();
        appendTerminalEntry('error', `Task submission rejected: ${err.error || res.statusText}`);
        dom.btnSubmit.disabled = false;
        return;
      }

      const data = await res.json();
      activeTaskId = data.taskId;
      dom.taskId.textContent = activeTaskId;
      dom.btnCancel.disabled = false;
      appendTerminalEntry('task', `Task launched successfully. ID: ${activeTaskId}`);
    } catch (err) {
      appendTerminalEntry('error', `Network error during submission: ${String(err)}`);
      dom.btnSubmit.disabled = false;
    }
  });

  // Task Cancel
  dom.btnCancel.addEventListener('click', async () => {
    if (!activeTaskId) return;
    dom.btnCancel.disabled = true;
    appendTerminalEntry('task', `Aborting task ${activeTaskId}...`);

    try {
      const res = await fetch(`/tasks/${activeTaskId}/cancel`, { method: 'POST' });
      if (res.ok) {
        appendTerminalEntry('task', `Task ${activeTaskId} abort signal transmitted.`);
      }
    } catch (err) {
      appendTerminalEntry('error', `Error cancelling task: ${String(err)}`);
    }
  });

  dom.btnClearTerminal.addEventListener('click', () => {
    dom.terminalOutput.innerHTML = '';
  });

  dom.btnRefreshScreenshot.addEventListener('click', captureScreenshot);

  // HITL Resolve
  if (dom.btnResolveIntervention) {
    dom.btnResolveIntervention.addEventListener('click', async () => {
      if (!activeTaskId) return;
      dom.btnResolveIntervention.disabled = true;
      appendTerminalEntry('system', `Sending intervention resolution signal for task ${activeTaskId}...`);
      try {
        const res = await fetch(`/api/tasks/${activeTaskId}/resolve-intervention`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (res.ok && data.success) {
          appendTerminalEntry('system', 'Intervention resolution accepted. Task resuming.');
          dom.hitlBanner.classList.add('hidden');
        } else {
          appendTerminalEntry('error', `Intervention resolution rejected: ${data.error || res.statusText}`);
        }
      } catch (err) {
        appendTerminalEntry('error', `Error resolving intervention: ${String(err)}`);
      } finally {
        dom.btnResolveIntervention.disabled = false;
      }
    });
  }

  // Level 5 Toolbar and Action Listeners
  dom.btnRefreshTopology?.addEventListener('click', () => {
    loadTopology();
    loadKnowledgeGraph();
  });
  dom.topologyDomainSelect?.addEventListener('change', loadTopology);

  dom.btnRefreshMacros?.addEventListener('click', loadMacros);

  dom.btnRefreshWatchers?.addEventListener('click', loadWatchers);
  dom.btnToggleWatcherForm?.addEventListener('click', () => {
    dom.watcherCreateCard.classList.toggle('hidden');
  });
  dom.btnCloseWatcherForm?.addEventListener('click', () => {
    dom.watcherCreateCard.classList.add('hidden');
  });

  // Watcher Form Submit
  dom.watcherForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('watcher-name').value.trim();
    const targetUrl = document.getElementById('watcher-url').value.trim();
    const conditionType = document.getElementById('watcher-cond-type').value;
    const conditionTarget = document.getElementById('watcher-cond-target').value.trim();
    const conditionValue = document.getElementById('watcher-cond-val').value.trim();
    const triggerType = document.getElementById('watcher-trigger-type').value;
    const intervalMs = parseInt(document.getElementById('watcher-interval').value, 10) || 10000;
    const adaptiveJitter = document.getElementById('watcher-jitter').checked;

    try {
      const res = await fetch('/api/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          targetUrl,
          conditionType,
          conditionTarget,
          conditionValue,
          triggerType,
          intervalMs,
          adaptiveJitter,
        }),
      });

      if (res.ok) {
        appendTerminalEntry('system', `Watcher daemon "${name}" created successfully.`);
        dom.watcherForm.reset();
        dom.watcherCreateCard.classList.add('hidden');
        loadWatchers();
      } else {
        const err = await res.json();
        appendTerminalEntry('error', `Failed to create watcher: ${err.error || res.statusText}`);
      }
    } catch (err) {
      appendTerminalEntry('error', `Error creating watcher: ${String(err)}`);
    }
  });

  dom.btnRefreshStealth?.addEventListener('click', () => {
    loadProfileHealth();
    loadHyperparameters();
  });
  dom.btnCleanProfile?.addEventListener('click', cleanProfile);
}

// Run on page load
window.addEventListener('DOMContentLoaded', init);
