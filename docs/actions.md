# Odysseus Typed Action Engine

## 1. Overview & Architectural Guarantees

In accordance with **Invariant 6 (No Arbitrary JS Execution)** and **Invariant 7 (Strictly Typed Actions)**, the Odysseus agent does not generate or execute arbitrary browser JavaScript (`page.evaluate(unvalidatedScript)`).

Instead, every browser interaction is expressed as a discriminated union action validated via Zod schemas before entering the execution pipeline.

All actions are dispatched through `ActionRegistry` and executed serially under `ActionMutex` (**Invariant 13**).

---

## 2. The 12 Action Types Reference

### 2.1 `navigate`
Navigates the current page to a target URL.

- **Schema:**
  ```typescript
  {
    type: 'navigate',
    url: string,            // Fully qualified URL (http/https)
    timeoutMs?: number     // Optional navigation timeout (default: 30,000ms)
  }
  ```
- **Example:**
  ```json
  {
    "type": "navigate",
    "url": "https://docs.example.com/pricing"
  }
  ```

---

### 2.2 `click`
Clicks an interactive DOM element identified by its transient stable ID.

- **Schema:**
  ```typescript
  {
    type: 'click',
    targetId: string,       // e.g. "e1", "e14"
    button?: 'left' | 'right' | 'middle',
    clickCount?: number,   // default: 1
    delayMs?: number
  }
  ```
- **Example:**
  ```json
  {
    "type": "click",
    "targetId": "e12"
  }
  ```

---

### 2.3 `type`
Enters text into an editable input element.

- **Schema:**
  ```typescript
  {
    type: 'type',
    targetId: string,
    text: string,
    clearFirst?: boolean,  // default: true
    delayMs?: number
  }
  ```
- **Example:**
  ```json
  {
    "type": "type",
    "targetId": "e5",
    "text": "Enterprise cloud hosting",
    "clearFirst": true
  }
  ```

---

### 2.4 `press_key`
Sends a single keyboard key press (e.g. Enter, Tab, Escape, ArrowDown).

- **Schema:**
  ```typescript
  {
    type: 'press_key',
    key: string,            // e.g. "Enter", "Tab", "Escape"
    targetId?: string      // Optional target element to focus first
  }
  ```
- **Example:**
  ```json
  {
    "type": "press_key",
    "key": "Enter"
  }
  ```

---

### 2.5 `scroll`
Scrolls the active page viewport or a specific element container.

- **Schema:**
  ```typescript
  {
    type: 'scroll',
    direction: 'up' | 'down' | 'left' | 'right',
    amount?: number,        // pixels (default: 500)
    targetId?: string      // Optional scroll container element
  }
  ```
- **Example:**
  ```json
  {
    "type": "scroll",
    "direction": "down",
    "amount": 600
  }
  ```

---

### 2.6 `select_option`
Selects one or more options in an HTML `<select>` element.

- **Schema:**
  ```typescript
  {
    type: 'select_option',
    targetId: string,
    values: string[]        // Values or labels to select
  }
  ```
- **Example:**
  ```json
  {
    "type": "select_option",
    "targetId": "e8",
    "values": ["annual_billing"]
  }
  ```

---

### 2.7 `wait`
Explicit delay to allow dynamic client-side animations or asynchronous network requests to settle.

- **Schema:**
  ```typescript
  {
    type: 'wait',
    durationMs: number      // Duration between 50ms and 30,000ms
  }
  ```
- **Example:**
  ```json
  {
    "type": "wait",
    "durationMs": 1500
  }
  ```

---

### 2.8 `screenshot`
Captures visual viewport snapshot into memory / disk for perception verification.

- **Schema:**
  ```typescript
  {
    type: 'screenshot',
    fullPage?: boolean      // default: false
  }
  ```
- **Example:**
  ```json
  {
    "type": "screenshot",
    "fullPage": false
  }
  ```

---

### 2.9 `hover`
Hovers the mouse cursor over an interactive element to reveal tooltips or dropdowns.

- **Schema:**
  ```typescript
  {
    type: 'hover',
    targetId: string
  }
  ```
- **Example:**
  ```json
  {
    "type": "hover",
    "targetId": "e22"
  }
  ```

---

### 2.10 `switch_tab`
Switches active browser context focus to another tab by its tab ID.

- **Schema:**
  ```typescript
  {
    type: 'switch_tab',
    tabId: string           // e.g. "tab_001", "tab_002"
  }
  ```
- **Example:**
  ```json
  {
    "type": "switch_tab",
    "tabId": "tab_002"
  }
  ```

---

### 2.11 `new_tab`
Opens a new browser tab, optionally navigating to an initial URL.

- **Schema:**
  ```typescript
  {
    type: 'new_tab',
    url?: string
  }
  ```
- **Example:**
  ```json
  {
    "type": "new_tab",
    "url": "https://www.google.com"
  }
  ```

---

### 2.12 `close_tab`
Closes a browser tab by its tab ID.

- **Schema:**
  ```typescript
  {
    type: 'close_tab',
    tabId: string
  }
  ```
- **Example:**
  ```json
  {
    "type": "close_tab",
    "tabId": "tab_002"
  }
  ```

---

## 3. Action Validation & Execution Lifecycle

```text
       LLM Decision JSON
               │
               ▼
      ActionValidator.validate(action)
        ├── Zod Schema Parsing
        └── Type Narrowing
               │
               ▼ Validated BrowserAction
        ActionMutex.runExclusive()
               │
               ▼
      ActionRegistry.dispatch(action, context)
        ├── Handler Selection
        ├── Playwright Core Method Call
        └── Timing & Telemetry Recording
               │
               ▼
          ActionResult
          (success, durationMs, error)
```
