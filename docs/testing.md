# Odysseus Testing & Verification Guide

## 1. Testing Philosophy & Invariant 15

In accordance with **Invariant 15 (Deterministic Testing)**:
- 100% of integration and benchmark tests run against the local mock test site (`test-site/`).
- No unit, integration, or benchmark tests make live internet requests to third-party domains.
- Tests execute with zero external side effects and zero flakiness.

---

## 2. Test Execution Commands

### Run Full Test Suite:
```bash
npm test
```
Executes all 35+ test files via Vitest in one-shot execution mode.

### Watch Mode (Development):
```bash
npm run test:watch
```

### Type Check Verification:
```bash
npm run typecheck
```
Executes `tsc --noEmit`. Must complete with **0 errors** before any commit.

### Production Build:
```bash
npm run build
```
Compiles TypeScript into pure ESM JavaScript inside `dist/`.

---

## 3. Test Suite Taxonomy

| Directory | Scope & Purpose |
|---|---|
| `tests/unit/` | Tests isolated modules (config, logger, action validation, schemas, memory, database, metrics). |
| `tests/browser/` | Tests browser lifecycle, page management, tab switching, and element registries. |
| `tests/agent/` | Tests canonical agent reasoning loop, recovery ladder, and checkpoint resumption. |
| `tests/integration/` | Tests multi-module integrations: authentication workflows, HTTP task API, SSE, and test-site. |
| `tests/e2e/` | Runs benchmark tasks T001 through T012 against the local test site. |

---

## 4. Benchmark Tasks Reference (T001 - T012)

The benchmark evaluation suite (`tests/e2e/benchmark.test.ts`) verifies all 12 core competencies:

1. **T001 — Navigate:** Direct navigation to target URL and title verification.
2. **T002 — Search:** Form query submission and navigating to top search result.
3. **T003 — Click:** Locating dynamic buttons and evaluating empirical state transitions.
4. **T004 — Fill Form:** Handling form validation errors and submitting valid inputs.
5. **T005 — Deterministic Login:** Injecting credentials from `CredentialVault` and verifying authenticated dashboard.
6. **T006 — Autonomous Registration:** Discovering registration fields and submitting agent profile data.
7. **T007 — Multi-Tab Research:** Registering, switching, and closing multiple tabs in `TabManager`.
8. **T008 — Download Artifact:** Downloading and parsing CSV and PDF artifacts via `DocumentParser`.
9. **T009 — Stale Element Recovery:** Recovering from detached DOM nodes via `RecoveryManager` Tier 2.
10. **T010 — Timeout Recovery:** Recovering from transient page timeouts via `RecoveryManager` Tier 1 backoff.
11. **T011 — Fact Cross-Checking:** Aggregating claims across independent sources and corroborating domains.
12. **T012 — End-to-End Workflow:** Complete autonomous research workflow (search $\rightarrow$ detail $\rightarrow$ download $\rightarrow$ parse $\rightarrow$ report synthesis).

---

## 5. Local Mock Test Site (`test-site/server.ts`)

The test site provides controlled mock endpoints simulating real-world browser challenges:

- **`/`**: Navigation hub.
- **`/login`**: Authentication form with cookie issuance (`session_id=session_mock_123`).
- **`/register`**: Registration form with validation rules.
- **`/dashboard`**: Protected session page requiring valid cookie.
- **`/search`**: Search portal with ranked result links.
- **`/slow-page`**: Latency simulation and delayed button elements.
- **`/broken-page`**: Mutating DOM elements and JavaScript errors.
- **`/popup-page`**: Secondary tab triggers.
- **`/iframe-page`**: Embedded cross-frame sub-forms.
- **`/download-page`**: Sample CSV and synthetic compressed PDF downloads.
- **`/dynamic-page`**: Single Page Application with client-side hash routing.
- **`/facts/source-a` & `/facts/source-b`**: Independent fact verification endpoints.
