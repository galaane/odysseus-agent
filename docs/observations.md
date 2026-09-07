# Odysseus Observation & Perception Subsystem

## 1. Architectural Philosophy (Invariant 8)

Raw HTML from modern websites routinely exceeds 200,000 tokens, containing megabytes of minified JavaScript, CSS stylesheets, inline SVGs, and tracking scripts that overwhelm LLM context windows and degrade reasoning accuracy.

In compliance with **Invariant 8 (Structured Observation)**:
- Raw HTML is **never** transmitted directly to the LLM.
- Webpage state is transformed into semantic, compressed snapshots with transient stable element identifiers (`e1`, `e2`, `e3`, ...).
- Observations are bounded strictly within a **2,000–4,000 token budget**.

---

## 2. Dual Perception Pipeline

```text
                     Active Chromium Page
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
          DOM Observer                  A11y Observer
      (DOM Node Tree & Bounds)     (Semantic Accessibility Tree)
               │                             │
               └──────────────┬──────────────┘
                              ▼
                      ElementRegistry
          (Assigns Transient IDs: e1, e2, e3...)
                              ▼
                  ObservationCompressor
           ├── Strips Scripts, Styles, & SVGs
           ├── Prunes Hidden / Inactive Nodes
           ├── Token Budget Bounding (2k - 4k)
           └── Generates Markdown Page Summary
                              ▼
                        PageSnapshot
          (Supplied to PromptBuilder & Evaluator)
```

---

## 3. Element Identification (`ElementRegistry`)

Interactive elements (buttons, inputs, links, select menus) are assigned deterministic, transient IDs during each observation pass.

### Properties Captured per Element:
```typescript
export interface RegisteredElement {
  id: string;               // e.g. "e1", "e2"
  role: string;             // e.g. "button", "textbox", "link", "combobox"
  name: string;             // Visible label or accessibility name
  selector: string;         // Playwright CSS / XPath locator selector
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
  isEnabled: boolean;
  tagName: string;
}
```

When an action targeting `e12` is executed, `ElementRegistry.resolveLocator(id, page)` translates the transient ID back into a Playwright `Locator`.

---

## 4. Observation Compression Rules

`ObservationCompressor` applies four progressive pruning tiers:

1. **Tag Filtering:** Completely removes `<script>`, `<style>`, `<noscript>`, `<svg>`, `<canvas>`, and `<template>` elements.
2. **Visibility Pruning:** Discards elements with `display: none`, `visibility: hidden`, or zero bounding boxes.
3. **Hierarchy Flattening:** Collapses deeply nested `<div>` and `<span>` wrappers while retaining textual prose and semantic headings (`<h1>`–`<h6>`).
4. **Token Budget Enforcement:** If the compressed observation exceeds 4,000 tokens:
   - Truncates repetitive list items and table rows.
   - Retains visible interactive elements and headings.
   - Emits a continuation notice indicating truncated content.

---

## 5. Structured Output Example

```text
[Page Context]
URL: https://example.com/checkout
Title: Shopping Cart & Checkout
Active Tab: tab_001

[Page Summary]
Headings:
# Order Review
## Shipping Information

Prose:
Review your selected items before proceeding to payment. Standard shipping arrives in 3-5 business days.

[Interactive Elements]
- [e1] textbox "Full Name" (value: "")
- [e2] textbox "Shipping Address" (value: "")
- [e3] combobox "Country" (options: United States, Canada, United Kingdom)
- [e4] button "Continue to Payment"
- [e5] link "Return to Cart"
```
