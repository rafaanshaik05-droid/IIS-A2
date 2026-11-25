# Prompt Review

**Prose word count:** ~1,140 words (excluding code blocks and tables)

A Chrome/Chromium Manifest V3 browser extension that adds a **tracked-changes review step** (`Alt+Shift+R` or extension toolbar icon) to chatbot prompt boxes before you send a prompt. It proposes shorter, clearer edits while preserving formatting and important details, and lets you inspect, toggle, accept, or undo every change.

## Repository & Development Evidence

- **Public GitHub Repository:** [https://github.com/rafaanshaik05-droid/IIS-A2](https://github.com/rafaanshaik05-droid/IIS-A2)
- **Submitted Commit:** Attached in the submitted report
- **Development Record:** See the structured entries below and the full commit history on `main` ([commits](https://github.com/rafaanshaik05-droid/IIS-A2/commits/main)).

---

## Development Record

1. **Core edit placement, preservation rules, and ChatGPT DOM verification** — [`48ebba7`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/48ebba7), [`c083245`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/c083245), [`1e4a789`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/1e4a789), [`2d526e2`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/2d526e2)
   - **What changed:** Built the edit-placement and protected-region engine (`shared.js`), the service worker API caller and JSON schema validator (`background.js`), the in-page tracked-changes review panel (`content.js`), and updated `TESTED_HOSTS` in `shared.js` (`2d526e2`).
   - **Why:** To propose concise prompt rewrites without altering fenced code, inline code, tables, indentation, or quotes, and to restrict fallback chatbox selection to hosts whose DOM selectors have been verified live.
   - **How checked:** Verified with `tests/shared.test.js` (23 tests) and `tests/content.test.js` (16 tests in a `jsdom` simulated DOM), plus live testing on `chatgpt.com` and `chat.openai.com`.

2. **Multi-provider support, header-only API keys, and two-click loss confirmation** — [`fadc0fb`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/fadc0fb), [`fec6413`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/fec6413), [`8846248`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8846248)
   - **What changed:** Added isolated per-provider settings for NVIDIA NIM, Google Gemini, and custom OpenAI-compatible endpoints (`fadc0fb`), and replaced the hard must-keep block with a two-click confirmation (**Accept rewrite** → **Accept again**) alongside date-style normalization and endpoint host attribution (`fec6413`).
   - **Why:** To ensure switching providers never sends one provider's key to another, API keys stay in request headers and are scrubbed from errors, and users can intentionally override a preservation warning without silent detail loss.
   - **How checked:** Verified with `tests/options.test.js` (5 tests) and `tests/background.test.js` (17 tests covering header-only key transmission, error scrubbing, and provider switching).

3. **Evaluation harness, held-out dataset, and anti-leakage guard** — [`6725dc7`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/6725dc7), [`8ffc44e`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8ffc44e), [`52488d0`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/52488d0), [`ecc88f2`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/ecc88f2)
   - **What changed:** Added separate development (`cases.json`, 16 cases) and held-out (`cases.heldout.json`, 6 cases) evaluation sets with CSV export (`6725dc7`, `ecc88f2`), rule tests (`52488d0`), and `tests/no-test-data.test.js` (`8ffc44e`).
   - **Why:** To prevent test-case wording or `must_keep` strings from leaking into product code (`shared.js`, `background.js`, `content.js`, `options.js`) and to keep held-out evaluation cases uncontaminated.
   - **How checked:** Verified via `npm test` (`tests/rules.test.js`: 12 tests; `tests/no-test-data.test.js`: 1 test; 74 tests passing overall).

---

## Features

- **Tracked-Changes Review (`content.js`, `shared.js`):**
  - Displays proposed edits inline before applying them to the active chat input.
  - Protects sensitive regions from modification: fenced code blocks, inline code, Markdown tables, indented lines, and blockquotes.
  - Separates **model risk** from **rule-based interface checks** (e.g., dropped numbers, names, links, quotes, punctuation, negations/qualifiers like `not`/`only`, reordered keywords, or changed line breaks). Only low-risk edits are selected by default.
  - Normalizes restyled dates back to the user's original date format and warns when required details would be lost using a two-click confirmation (**Accept rewrite** → **Accept again**).
  - Includes stale-text protection (disables **Accept** if the draft changes while the review is open) and one-click **Undo**.
- **Multi-Provider Support (`providers.js`, `background.js`, `options.html`, `options.js`):**
  - **NVIDIA NIM** (default `https://integrate.api.nvidia.com/v1/chat/completions`, or a custom/local NIM endpoint).
  - **Google Gemini** (`https://generativelanguage.googleapis.com/v1beta/models`, with an optional toggle to disable extra thinking budget).
  - **Other (OpenAI-compatible)** custom endpoints (requests explicit Chrome host permission on save).
  - Each provider stores its own API key, model, and endpoint; keys are sent in request headers only, never written to logs, and scrubbed from error messages.
  - Compression levels: `light`, `balanced`, and `aggressive`.
- **Privacy & Study Log (`options.html`, `options.js`):**
  - By default (`storeText: false`), only counts, token estimates, preservation warnings, and user decisions are logged in `chrome.storage`.
  - Supports exporting the study log to CSV and clearing all stored log data.
- **Supported Chatbot Sites (`manifest.json`, best effort):**
  - `chatgpt.com`, `chat.openai.com` (verified live); `claude.ai`, `gemini.google.com`, `copilot.microsoft.com`, `www.perplexity.ai`, `grok.com`, `chat.deepseek.com`, `chat.mistral.ai`, and `poe.com` (configured in `manifest.json` on a best-effort basis; not yet verified live).

---

## Project Structure

| File / Folder | Purpose |
| :--- | :--- |
| `manifest.json` | Manifest V3 extension configuration, permissions, shortcut (`Alt+Shift+R`), and content script matches |
| `shared.js` | Core edit-placement, protected-region detection, date normalization, must-keep validation, and risk checks |
| `content.js` | In-page chatbox detection, tracked-changes review panel UI, stale-text guard, accept, and undo |
| `background.js` | Service worker handling provider API calls, JSON schema validation, key scrubbing, and trace logging |
| `providers.js` | Provider definitions (`nvidia`, `gemini`, `custom`) and per-provider settings resolution |
| `options.html` / `options.js` | Extension settings page, privacy notice, study statistics, and CSV export |
| `harness.html` / `harness.js` | Evaluation harness for running fixed test cases and exporting scored results |
| `cases.json` / `cases.heldout.json` | 16 development cases and 6 held-out evaluation cases |
| `tests/` | Automated Node.js test suites (`options`, `shared`, `rules`, `background`, `no-test-data`, `content`) |
| `results/` | 'harness-cases.heldout-rw-5-1795546461629.csv'|

---

## Installation & Usage

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or a Chromium-based browser).
3. Enable **Developer mode**, click **Load unpacked**, and select the repository folder.
4. Open the extension's **Options** page, choose a provider (**NVIDIA NIM**, **Google Gemini**, or **Other**), enter your API key, and click **Save settings**.
5. Navigate to a supported chatbot site, type a draft prompt, and press `Alt+Shift+R` (or click the **Prompt Review** toolbar icon) to review suggested edits.

---

## Testing & Evaluation

### Automated Tests

Install dev dependencies (`jsdom`) and run the test suite:

```bash
npm install
npm test
```

The `npm test` script runs 6 test files (74 tests total):
- `tests/options.test.js` (5 tests) — provider settings, per-provider isolation, and host permission prompts
- `tests/shared.test.js` (23 tests) — formatting/protected-region preservation, risk flags, and edit placement
- `tests/rules.test.js` (12 tests) — date equivalence, must-keep checks, and clarity detection
- `tests/background.test.js` (17 tests) — response validation, provider switching, preflight filtering, and key scrubbing
- `tests/no-test-data.test.js` (1 test) — ensures test-case strings do not leak into production code
- `tests/content.test.js` (16 tests) — simulated DOM interaction, accept/undo, two-click loss confirmation, and stale-text protection

### Evaluation Harness

Open **Options → Open the test harness** (`harness.html`) to run the fixed **Development** (`cases.json`, 16 cases) or **Held-out** (`cases.heldout.json`, 6 cases) datasets and export results to CSV for blind scoring.

---

## Use of AI

**Claude (Anthropic)** was used in two parts of this project:

1. **Developing the prototype:** Assisted with drafting, iterating on, and debugging the extension modules (`shared.js`, `content.js`, `background.js`, `providers.js`), the evaluation harness (`harness.js`), and the Node.js test suites.
2. **Preparing the report:** Assisted with structuring, drafting, and refining the written report and this `README.md`.

**What was checked and changed:**
- **Removed hardcoded must-keep test strings:** Checked `shared.js` to ensure must-keep details are extracted dynamically from the user's prompt rather than from test data, and added `tests/no-test-data.test.js` ([`8ffc44e`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8ffc44e)) to fail the build if any 6-word test-case phrase or `must_keep` string appears in product code.
- **Verified ChatGPT DOM selectors:** Tested chatbox detection live on `chatgpt.com` and `chat.openai.com` and updated `TESTED_HOSTS` in `shared.js` ([`2d526e2`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/2d526e2)) so unverified sites require explicit user focus rather than guessing a text box.
- **Enforced header-only API keys & error scrubbing:** Checked `background.js` and `providers.js` with `tests/background.test.js` ([`8846248`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8846248)) to confirm API keys are sent only in request headers, remain isolated per provider, and are scrubbed from any error messages before logging or display.
- **Verified all reported metrics:** Re-ran `npm test` (74/74 passing) and checked dataset counts (16 development cases, 6 held-out cases) against the repository files.

---

## References & Acknowledgements

- [Chrome Extensions Manifest V3 Documentation](https://developer.chrome.com/docs/extensions/mv3/) — service workers, `storage`, `activeTab`, `scripting`, and `commands` APIs.
- [jsdom](https://github.com/jsdom/jsdom) (`^26.0.0`) — used as a dev dependency to simulate DOM behavior in `tests/content.test.js` and `tests/options.test.js`.
- [NVIDIA NIM API](https://build.nvidia.com/) and [Google Gemini API (`generateContent`)](https://ai.google.dev/gemini-api/docs) — LLM inference endpoints supported by the extension.
