# Prompt Review

**README prose word count: 997** (excludes code blocks, commands, tables and URLs)

**Submitted commit:** Attached in the report
**Repository:** https://github.com/rafaanshaik05-droid/IIS-A2
**Course:** Intelligent Interactive Systems, Assignment 2 (University of Birmingham)

A Chrome/Chromium Manifest V3 extension that adds a **tracked-changes review step** before a chatbot receives your prompt. Press `Alt+Shift+R` (or click the toolbar icon) and a language model proposes a shorter version. You can include or leave out each change, edit the result, accept it, keep your original, or undo within 30 seconds. Nothing is ever sent automatically.

## Project status

**Works (implemented):**
- Tracked-changes review panel with an intent summary and one-line explanations per edit.
- Per-edit toggles, manual editing, Accept, Keep original and 30-second Undo.
- Dual-risk selection: an edit starts selected only if both the model and the rule-based check rate it low risk.
- Protected regions (code, tables, quotes, indented lines), two-click confirmation when a flagged detail would be lost, and stale-input protection.
- Three providers (NVIDIA NIM, Google Gemini, custom OpenAI-compatible), with separate settings per provider.
- Evaluation harness with a 16-case development set and a 6-case held-out set.
- 74 automated tests (all passing).

**Verified live:** `chatgpt.com` and `chat.openai.com` only.

**Simulated:** Scenarios B (flagged deletion) and C (typing while a review is open) in the report were exercised in a simulated DOM (jsdom), not on a live site.

**Not finished:**
- Blind A/B response-quality scoring is pending. The held-out CSV in `results/` is unscored harness output.
- Other configured chatbot sites (Claude, Gemini, Copilot, Perplexity, Grok, DeepSeek, Mistral, Poe) are best-effort and unverified.
- No user evaluation has been run.
- On a dense prompt (case h05) the model proposed a 7% trim instead of no edits, because there is no minimum-saving gate.
- Token counts are character-based estimates.

**Planned (not built):** send-time suggestion, an in-page compression slider (strength is currently chosen only on the Options page: `light`, `balanced`, `aggressive`), and exact per-chatbot token counts.

## Technology stack

- **Chrome Manifest V3:** extension loading, service worker, storage, permissions, toolbar command.
- **Vanilla JavaScript, HTML, CSS:** review panel, edit placement, provider requests, options page and harness, with no framework.
- **Node.js test runner and jsdom:** automated tests; jsdom provides the simulated DOM.
- **NVIDIA NIM** (default, and the evaluated provider): the held-out run used `nvidia/nemotron-3.5-bolt-e4b`. The model is configurable.
- **Google Gemini and OpenAI-compatible endpoints:** supported as optional, unevaluated providers.
- **Undecided:** which model to use for future evaluation runs.

## Running or inspecting

1. Clone or download this repository.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the repository folder.
3. Open the extension's **Options** page, choose a provider, enter your own API key and click **Save settings**.
4. Go to a supported chatbot site, type a draft and press `Alt+Shift+R`.

**API keys.** No key is committed to this repository. Each reviewer supplies their own: an `nvapi-...` key from [build.nvidia.com](https://build.nvidia.com/) or an `AIza...` key from [aistudio.google.com](https://aistudio.google.com/). Keys are sent in request headers only and scrubbed from error messages.

**Inspecting without a key.** The automated tests need no API key:

```bash
npm install
npm test
```

The harness (**Options → Open the test harness**) and live use need a key. To inspect past results without one, open `results/harness-cases.heldout-rw-5-1795546461629.csv`.

| Test file | Tests |
| :--- | :--- |
| `tests/shared.test.js` | 23 |
| `tests/background.test.js` | 17 |
| `tests/content.test.js` | 16 |
| `tests/rules.test.js` | 12 |
| `tests/options.test.js` | 5 |
| `tests/no-test-data.test.js` | 1 |

## Key files

| File | Purpose |
| :--- | :--- |
| `manifest.json` | Permissions, shortcut and site matches |
| `shared.js` | Edit placement, protected regions, risk and must-keep checks |
| `content.js` | Chatbox detection, review panel, stale-input guard, Accept and Undo |
| `background.js` | Provider calls, schema validation, key scrubbing, trace logging |
| `providers.js` | Provider definitions and per-provider settings |
| `options.html` / `options.js` | Settings, privacy notice, study statistics, CSV export |
| `harness.html` / `harness.js` | Fixed-case evaluation and CSV export |
| `cases.json` / `cases.heldout.json` | 16 development and 6 held-out cases |

## Development record

1. **Stage 1: edit placement, preservation and review panel.** Commits [`48ebba7`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/48ebba7), [`c083245`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/c083245), [`1e4a789`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/1e4a789), [`2d526e2`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/2d526e2)
   - **Changed:** built the edit-placement and protected-region engine, the service worker with schema validation, and the in-page tracked-changes panel. Restricted fallback chatbox selection to verified hosts (`TESTED_HOSTS`).
   - **Why:** to propose shorter prompts without altering code, tables, indentation or quotes, and to avoid guessing a text box on unverified sites (Assignment 1's transparency gap).
   - **Checked:** `tests/shared.test.js`, `tests/content.test.js` and live use on ChatGPT.

2. **Stage 2: providers, safer decisions, Undo.** Commits [`fadc0fb`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/fadc0fb), [`fec6413`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/fec6413), [`8846248`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8846248)
   - **Changed:** added per-provider settings; replaced the hard block on flagged deletions with a two-click confirmation (`fec6413`), because the block prevented intentional edits; added date-style normalisation, 30-second Undo, a 40-token skip threshold and an 8-edit cap.
   - **Why:** users can deliberately override a warning without silent detail loss, and one provider's key is never sent to another. The skip threshold exists because the review call costs about 785 tokens.
   - **Checked:** `tests/options.test.js` and `tests/background.test.js` (header-only keys, error scrubbing, provider switching).

3. **Stage 3: evaluation harness and held-out validation.** Commits [`6725dc7`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/6725dc7), [`8ffc44e`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8ffc44e), [`52488d0`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/52488d0), [`ecc88f2`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/ecc88f2)
   - **Changed:** added development and held-out case sets with CSV export, rule tests, and a test that fails if test-case text appears in product code. Replaced hard-coded must-keep keywords with extraction from the user's own draft.
   - **Why:** development on the 16-case set showed that must-keep strings in runtime code leaked test ground truth.
   - **Checked:** `npm test` (74/74). Held-out run: 6/6 passed schema and preservation checks, 5/6 met behavioural expectations, with 11.6% average downstream token saving (up to 22%).

## AI assistance

**Claude (Anthropic)** was used to:
- draft and debug the extension modules, harness and test suites (Manifest V3 boilerplate, jsdom fixtures and early drafts);
- help prepare the report, its figures and this README.

**Google Gemini** was used only as an optional runtime provider, not as a coding or writing assistant.

**What I checked or changed:**
- Claude's must-keep checks used keywords that leaked test data. I replaced them with dynamic extraction and added `tests/no-test-data.test.js` ([`8ffc44e`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8ffc44e)).
- Claude's hard block on flagged deletions became two-click confirmation ([`fec6413`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/fec6413)).
- I tested chatbox detection live on ChatGPT and limited fallback selection to verified hosts ([`2d526e2`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/2d526e2)).
- I checked key handling with `tests/background.test.js` ([`8846248`](https://github.com/rafaanshaik05-droid/IIS-A2/commit/8846248)).
- I removed references I could not verify, re-ran `npm test`, and checked the case counts and metrics against the repository files.
- Architecture, mapping of lecture concepts to design choices, and evaluation criteria are my own.

## Additional files

None. There is no accompanying ZIP. The report (with its architecture diagram and storyboards) is submitted separately through the assignment portal. Held-out results are in `results/`.

## References and acknowledgements

- [Chrome Extensions Manifest V3 documentation](https://developer.chrome.com/docs/extensions/mv3/)
- [jsdom](https://github.com/jsdom/jsdom) (`^26.0.0`), a dev dependency for simulated-DOM tests
- [NVIDIA NIM API](https://build.nvidia.com/) and [Google Gemini API](https://ai.google.dev/gemini-api/docs), the supported model endpoints