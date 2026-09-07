import type { LLMMessage, MessageContentPart } from './LLM.js';

export interface ActionHistoryEntry {
  step: number;
  actionType: string;
  targetId?: string;
  outcome?: string;
  summary?: string;
}

export interface TabInfo {
  tabId: string;
  url: string;
  title?: string;
}

export interface BranchInfo {
  branchId: string;
  tabId: string;
  branchGoal: string;
}

export interface PromptContext {
  goal: string;
  currentObservationText?: string;
  activeUrl?: string;
  activeTabId?: string;
  openTabs?: TabInfo[];
  activeBranches?: BranchInfo[];
  recentActions?: ActionHistoryEntry[];
  workingMemoryFacts?: string[];
  customInstructions?: string;
  planSummary?: string;
  domainPlaybooks?: string[];
  screenshotBase64?: string;
}

export class PromptBuilder {
  /**
   * Constructs complete message list for an LLM decision request.
   * If screenshotBase64 is provided in PromptContext, creates an OpenAI-compatible multimodal message.
   */
  public buildMessages(context: PromptContext): LLMMessage[] {
    const userPromptText = this.buildUserPrompt(context);
    const userContent: string | MessageContentPart[] = context.screenshotBase64
      ? [
          { type: 'text', text: userPromptText },
          {
            type: 'image_url',
            image_url: {
              url: context.screenshotBase64.startsWith('data:')
                ? context.screenshotBase64
                : `data:image/png;base64,${context.screenshotBase64}`,
              detail: 'auto',
            },
          },
        ]
      : userPromptText;

    return [
      {
        role: 'system',
        content: this.buildSystemPrompt({ customInstructions: context.customInstructions }),
      },
      {
        role: 'user',
        content: userContent,
      },
    ];
  }

  /**
   * Builds the static/system prompt establishing agent persona, operational directives,
   * available action schemas, and strict JSON output requirements.
   */
  public buildSystemPrompt(options?: { customInstructions?: string }): string {
    const sections: string[] = [];

    // 1. Core Persona & Directives (Spec Section 43)
    sections.push(`You are Odysseus, an autonomous browser agent. Your persistent Chromium browser is your primary working environment.
Follow these operational directives at all times:
1. Observe before acting: Carefully analyze the current browser observation before deciding on the next step.
2. Strictly typed actions: You may ONLY execute the 12 approved browser action schemas. Never attempt to generate or execute arbitrary JavaScript.
3. Empirical verification: Always specify an expectedOutcome. Verify important outcomes on subsequent observations.
4. Target elements accurately: When interacting with page elements, reference their transient element IDs (e.g., el_001, el_002) from the observation snapshot.
5. Systematic recovery: If an element is missing, stale, or an action fails, inspect the latest observation to recover or retry.
6. Factual accuracy: Do not hallucinate or invent facts. For research goals, extract findings directly from page content and cite exact URLs.
7. Credentials & Security: Never emit plaintext credentials, passwords, or tokens in your reasoning or actions. Credentials are injected directly by isolated subsystems.
8. Stop condition: When the goal is complete, set status to "complete" and include final findings if applicable. If blocked by an external boundary (e.g. CAPTCHA, MFA), set status to "waiting_human_intervention" if manual human resolution is feasible, or "blocked" if impossible to proceed.
9. Transparent reasoning: Keep "reasoning_summary" concise and focused on the immediate observation and choice. You may provide structured deliberation in "deliberation" before finalizing your action.`);

    // 2. Action Catalog
    sections.push(`Available Browser Action Types:
- navigate: { "type": "navigate", "url": "https://...", "waitUntil": "load"|"domcontentloaded"|"networkidle" }
- click: { "type": "click", "targetId": "el_XXX" }
- fill: { "type": "fill", "targetId": "el_XXX", "value": "text to fill" }
- type: { "type": "type", "targetId": "el_XXX", "text": "text to type", "delayMs": 30 }
- press: { "type": "press", "key": "Enter"|"Tab"|"Escape", "targetId": "el_XXX" (optional) }
- scroll: { "type": "scroll", "direction": "up"|"down", "amount": 500 }
- wait: { "type": "wait", "condition": "network-idle"|"navigation"|"timeout"|"selector", "timeoutMs": 5000 }
- screenshot: { "type": "screenshot", "fullPage": false }
- new_tab: { "type": "new_tab", "url": "https://..." (optional) }
- switch_tab: { "type": "switch_tab", "tabId": "tab_XXX" }
- close_tab: { "type": "close_tab", "tabId": "tab_XXX" }
- extract: { "type": "extract", "targetId": "el_XXX" (optional), "instruction": "Extract text content" }
- branch_tab: { "type": "branch_tab", "url": "https://..." (optional), "targetId": "el_XXX" (optional), "branchGoal": "Goal for speculative branch" }
- prune_branch: { "type": "prune_branch", "tabId": "tab_XXX" (optional), "reason": "Reason for pruning dead-end branch" }
- promote_branch: { "type": "promote_branch", "tabId": "tab_XXX" }
- harvest_network_payload: { "type": "harvest_network_payload", "urlPattern": "pattern", "jsonPath": "data.items", "destination": "both"|"research"|"working", "topic": "topic" }`);

    // 3. Response Format
    sections.push(`You MUST respond with a single valid JSON object strictly matching this schema:
{
  "status": "continue" | "complete" | "blocked" | "waiting_human_intervention",
  "deliberation": {
    "observation_analysis": "<analysis of visible elements and changes>",
    "encountered_obstacles": ["<any obstacles or blocking overlays>"],
    "alternative_considered": "<alternative action evaluated>",
    "risk_assessment": "<preconditions or potential issues>"
  },
  "reasoning_summary": "<concise explanation of why this action was chosen based on observation>",
  "actions": [ { <one of the action objects above> } ],
  "candidates": [
    {
      "action": { <action object> },
      "reasoning": "<why this candidate alternative is plausible>",
      "confidence": 0.85,
      "riskScore": 0.2
    }
  ],
  "expectedOutcome": "<what page state change is expected after executing this action(s)>",
  "finalFindings": [
    {
      "claim": "<verified factual finding>",
      "sourceUrls": ["https://..."],
      "confidence": 1.0,
      "notes": "<optional notes>"
    }
  ]
}

Note: If status is "continue", "actions" (or single "action") and "expectedOutcome" MUST be provided. You may optionally provide "candidates" when considering multiple viable paths or weighing riskier alternatives; the agent will empirically evaluate and score candidate utilities to select the safest high-confidence action. If status is "complete", include "finalFindings" if the task required extracting information.`);

    if (options?.customInstructions) {
      sections.push(`Special Task Instructions:\n${options.customInstructions}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Builds the dynamic user prompt combining task goal, environment state,
   * recent history, memory, and current observation snapshot.
   */
  public buildUserPrompt(context: PromptContext): string {
    const parts: string[] = [];

    // Task Goal
    parts.push(`## Task Goal\n${context.goal}`);

    // Active Plan Summary (if available)
    if (context.planSummary) {
      parts.push(`## Active Execution Plan\n${context.planSummary}`);
    }

    // Browser State
    const stateLines: string[] = [];
    if (context.activeTabId) stateLines.push(`- Active Tab: ${context.activeTabId}`);
    if (context.activeUrl) stateLines.push(`- Active URL: ${context.activeUrl}`);
    if (context.openTabs && context.openTabs.length > 0) {
      const tabsFormatted = context.openTabs
        .map((t) => `${t.tabId} (${t.url}${t.title ? ` - "${t.title}"` : ''})`)
        .join(', ');
      stateLines.push(`- Open Tabs: [${tabsFormatted}]`);
    }
    if (stateLines.length > 0) {
      parts.push(`## Browser State\n${stateLines.join('\n')}`);
    }

    // Active Speculative Branches (Tree-of-Thought)
    if (context.activeBranches && context.activeBranches.length > 0) {
      const branchLines = context.activeBranches.map(
        (b) => `- [Branch ${b.branchId}] in Tab ${b.tabId}: "${b.branchGoal}"`
      );
      parts.push(`## Active Speculative Branches (Tree-of-Thought)\n${branchLines.join('\n')}\n(You may evaluate, prune with prune_branch, or promote with promote_branch)`);
    }

    // Domain Playbooks / Knowledge (if available)
    if (context.domainPlaybooks && context.domainPlaybooks.length > 0) {
      const playbooksList = context.domainPlaybooks.map((p) => `- ${p}`).join('\n');
      parts.push(`## Known Domain Playbooks\n${playbooksList}`);
    }

    // Working Memory Facts
    if (context.workingMemoryFacts && context.workingMemoryFacts.length > 0) {
      const factsList = context.workingMemoryFacts.map((f) => `- ${f}`).join('\n');
      parts.push(`## Working Memory Facts\n${factsList}`);
    }

    // Recent Action History
    if (context.recentActions && context.recentActions.length > 0) {
      const historyLines = context.recentActions.map((h) => {
        const target = h.targetId ? ` target=${h.targetId}` : '';
        const outcome = h.outcome ? ` -> ${h.outcome}` : '';
        const summary = h.summary ? ` (${h.summary})` : '';
        return `- Step ${h.step}: ${h.actionType}${target}${summary}${outcome}`;
      });
      parts.push(`## Recent Action History\n${historyLines.join('\n')}`);
    }

    // Current Observation Snapshot
    parts.push(`## Current Browser Observation\n${context.currentObservationText || 'No observation available.'}`);

    // Final prompt directive
    parts.push(`Decide the next action to advance toward the goal. Respond with a valid JSON object.`);

    return parts.join('\n\n');
  }
}
