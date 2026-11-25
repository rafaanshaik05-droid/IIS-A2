# Prompt Review

A Chrome/Chromium Manifest V3 browser extension that adds a **tracked-changes review step** (`Alt+Shift+R` or extension toolbar icon) to chatbot prompt boxes before you send a prompt. It proposes shorter, clearer edits while preserving formatting and important details, and lets you inspect, toggle, accept, or undo every change.

## Repository & Development Evidence

- **Public GitHub Repository:** [https://github.com/rafaanshaik05-droid/IIS-A2](https://github.com/rafaanshaik05-droid/IIS-A2)
- **Submitted Commit:** README Commit attached in submitted reportS
- **Development Record:** See the repository commit history (`git log --oneline`) on the `main` branch, which records the incremental development of the core edit-placement and risk-checking logic, background API worker, content-script review panel, multi-provider options page, study log, evaluation harness, and automated test suites.

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
  - `chatgpt.com`, `chat.openai.com`,(verified live) `claude.ai`, `gemini.google.com`, `copilot.microsoft.com`, `www.perplexity.ai`, `grok.com`, `chat.deepseek.com`, `chat.mistral.ai`, and `poe.com` (configured in manifest.json on a best effort basis; not yet verified live).

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

AI tools were used in two parts of this project:

1. **Developing the prototype:** AI was used to assist with drafting, iterating on, and debugging the extension code, provider integrations, evaluation harness, and automated tests.
2. **Preparing the report:** AI was used to assist with structuring, drafting, and refining the written report and this `README.md`.

**Verification and changes made:** All AI-assisted code, design choices, and written claims were reviewed against the actual implementation. Code changes were verified by running the `npm test` suite (all 74 tests passing) and testing the extension's UI and provider behavior, with manual edits made where needed to correct inaccuracies, enforce privacy/security constraints (such as header-only API keys and error scrubbing), and ensure the documentation accurately reflects the submitted system.

---

## References & Acknowledgements

- [Chrome Extensions Manifest V3 Documentation](https://developer.chrome.com/docs/extensions/mv3/) — service workers, `storage`, `activeTab`, `scripting`, and `commands` APIs.
- [jsdom](https://github.com/jsdom/jsdom) (`^26.0.0`) — used as a dev dependency to simulate DOM behavior in `tests/content.test.js` and `tests/options.test.js`.
- [NVIDIA NIM API](https://build.nvidia.com/) and [Google Gemini API (`generateContent`)](https://ai.google.dev/gemini-api/docs) — LLM inference endpoints supported by the extension.
