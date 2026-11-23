// Simulated-page tests (jsdom) for the content script. Run with: npm install && node tests/content.test.js
// They cover the protections around the user's text. They do not replace testing on real sites (SITE_TESTS.md).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(__dirname, "..");
const SHARED = fs.readFileSync(path.join(root, "shared.js"), "utf8");
const CONTENT = fs.readFileSync(path.join(root, "content.js"), "utf8");

const PROMPT = "I was wondering if you could possibly write a short poem about the sea for my daughter, who is seven and loves boats and whales and lighthouses, please make it rhyme. Thanks so much!";
const REWRITE = "write a short poem about the sea for my daughter, who is seven and loves boats and whales and lighthouses, please make it rhyme.";
const data = () => ({
  intent_summary: "Write a rhyming sea poem for a seven-year-old.",
  clarity: "clear", clarity_note: "", no_change_reason: "",
  edits: [
    { original: "I was wondering if you could possibly ", replacement: "", type: "filler", reason: "Politeness padding.", risk: "low" },
    { original: " Thanks so much!", replacement: "", type: "filler", reason: "Thanks are not needed.", risk: "low" }
  ]
});

function setup(opts = {}) {
  const dom = new JSDOM(`<!doctype html><body><textarea id="a"></textarea><textarea id="b"></textarea></body>`, {
    url: opts.url || "https://example.com/", runScripts: "outside-only", pretendToBeVisual: true
  });
  const w = dom.window;
  let n = 0;
  w.Element.prototype.getBoundingClientRect = function () {
    const bottom = this.id === "b" ? 400 : 100;
    return { width: 300, height: 40, top: bottom - 40, left: 0, right: 300, bottom };
  };
  if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, "crypto", { value: { randomUUID: () => `id${++n}abcdef` } });
  const logs = [];
  const patches = [];
  let listener;
  w.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === "optimise") {
          if (opts.delay) await sleep(opts.delay);
          opts.during?.();
          return { ok: true, data: opts.data ? opts.data() : data(), meta: { prompt_version: "t", model: "m", level: "balanced", usage: { input: 10, output: 5 }, schema_ok: true, invalid_dropped: 0, store_text: false } };
        }
        if (msg.type === "log") logs.push(msg.entry);
        if (msg.type === "log_patch") patches.push(msg.patch);
        return { ok: true };
      },
      onMessage: { addListener: (fn) => (listener = fn) }
    }
  };
  w.eval(SHARED);
  if (opts.tested) w.PR.TESTED_HOSTS.push("example.com");
  w.eval(CONTENT);
  const sr = w.document.getElementById("prompt-review-host").shadowRoot;
  const api = {
    w, logs, patches, a: w.document.getElementById("a"), b: w.document.getElementById("b"),
    review: () => listener({ type: "review" }),
    panelText: () => sr.querySelector(".panel")?.textContent || "",
    toastText: () => sr.querySelector(".toast")?.textContent || "",
    btn: (t) => [...sr.querySelectorAll("button")].find((x) => x.textContent === t),
    focus: (el) => el.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true })),
    type: (el, v, fire = true) => {
      el.value = v;
      if (fire) el.dispatchEvent(new w.Event("input", { bubbles: true }));
    }
  };
  return api;
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("ok   ", name);
  } catch (e) {
    console.error("FAIL ", name, "\n     ", e.message);
    process.exitCode = 1;
  }
}

(async () => {
  await test("untested site: does not guess a box until the user has clicked into one", async () => {
    const t = setup();
    t.a.value = PROMPT;
    t.b.value = "something else";
    t.review();
    await sleep(20);
    assert.ok(/will not guess/.test(t.panelText()), t.panelText());
    assert.strictEqual(t.logs.length, 0);
  });

  await test("untested site: uses the box the user focused, not the lowest one", async () => {
    const t = setup();
    t.a.value = PROMPT;
    t.b.value = "unrelated text in another box";
    t.focus(t.a);
    t.review();
    await sleep(30);
    assert.ok(/Suggestion ready/.test(t.panelText()), t.panelText());
    t.btn("Accept rewrite").click();
    assert.strictEqual(t.a.value, REWRITE);
    assert.strictEqual(t.b.value, "unrelated text in another box");
  });

  await test("tested site: may fall back to the lowest text box", async () => {
    const t = setup({ tested: true });
    t.b.value = PROMPT;
    t.review();
    await sleep(30);
    assert.ok(/Suggestion ready/.test(t.panelText()), t.panelText());
    assert.strictEqual(t.logs.length, 0);
    t.btn("Keep original").click();
    assert.strictEqual(t.logs[0].target_method, "heuristic");
    assert.strictEqual(t.logs[0].site_tier, "tested");
  });

  await test("accept writes the rewrite, logs it, and Undo restores the original", async () => {
    const t = setup();
    t.a.value = PROMPT;
    t.focus(t.a);
    t.review();
    await sleep(30);
    t.btn("Accept rewrite").click();
    assert.strictEqual(t.a.value, REWRITE);
    assert.strictEqual(t.logs[0].decision, "accepted");
    assert.strictEqual(t.logs[0].write_back, "exact");
    t.btn("Undo").click();
    assert.strictEqual(t.a.value, PROMPT);
    assert.strictEqual(JSON.stringify(t.patches[0]), '{"decision":"undone"}');
  });

  await test("keep original leaves the box untouched", async () => {
    const t = setup();
    t.a.value = PROMPT;
    t.focus(t.a);
    t.review();
    await sleep(30);
    t.btn("Keep original").click();
    assert.strictEqual(t.a.value, PROMPT);
    assert.strictEqual(t.logs[0].decision, "kept_original");
  });

  await test("editing the prompt while the review is open turns Accept off", async () => {
    const t = setup();
    t.a.value = PROMPT;
    t.focus(t.a);
    t.review();
    await sleep(30);
    t.type(t.a, PROMPT + " Also mention puffins.");
    assert.strictEqual(t.btn("Accept rewrite").disabled, true);
    assert.ok(/prompt changed after this suggestion/.test(t.panelText()));
    assert.strictEqual(t.a.value, PROMPT + " Also mention puffins.");
  });

  await test("Accept re-checks at write time, even if no input event was seen", async () => {
    const t = setup();
    t.a.value = PROMPT;
    t.focus(t.a);
    t.review();
    await sleep(30);
    t.type(t.a, "A completely new prompt the user typed meanwhile.", false); // no input event
    t.btn("Accept rewrite").click();
    assert.strictEqual(t.a.value, "A completely new prompt the user typed meanwhile.");
    assert.strictEqual(t.logs[0].decision, "blocked_changed");
    assert.ok(/nothing was replaced/.test(t.panelText()));
  });

  await test("text changed while waiting for the model: review opens with Accept off", async () => {
    let t;
    t = setup({ delay: 40, during: () => (t.a.value = "The user replaced the prompt during the wait.") });
    t.a.value = PROMPT;
    t.focus(t.a);
    t.review();
    await sleep(120);
    assert.strictEqual(t.btn("Accept rewrite").disabled, true);
    assert.strictEqual(t.a.value, "The user replaced the prompt during the wait.");
  });

  await test("Undo is skipped when the box no longer holds the rewrite", async () => {
    const t = setup();
    t.a.value = PROMPT;
    t.focus(t.a);
    t.review();
    await sleep(30);
    t.btn("Accept rewrite").click();
    t.type(t.a, "A newer draft written after accepting.");
    t.btn("Undo").click();
    assert.strictEqual(t.a.value, "A newer draft written after accepting.");
    assert.strictEqual(JSON.stringify(t.patches[0]), '{"undo":"blocked"}');
    assert.ok(/Undo was skipped/.test(t.toastText()));
  });

  await test("untouched text with indentation and a table is written back unchanged", async () => {
    const text = "Could you kindly look at this table and tell me what the two columns could mean for a small shop, thank you so much for helping me out with it today, it is really appreciated?\n\n| A  | B |\n|----|---|\n| 1  | 2 |\n\n    indented   line\n\nThanks!";
    const t = setup({
      data: () => ({ intent_summary: "x", clarity: "clear", clarity_note: "", no_change_reason: "", edits: [{ original: "Could you kindly look at", replacement: "Look at", type: "filler", reason: "Padding.", risk: "low" }, { original: "| A  | B |", replacement: "| A | B |", type: "wordy", reason: "x", risk: "low" }] })
    });
    t.a.value = text;
    t.focus(t.a);
    t.review();
    await sleep(30);
    assert.ok(/Suggestion ready: 1 change,/.test(t.panelText()), t.panelText());
    t.btn("Accept rewrite").click();
    assert.strictEqual(t.a.value, text.replace("Could you kindly look at", "Look at"));
  });

  await test("a flagged edit starts left out and is explained with model and check labelled separately", async () => {
    const text = "Please write a short and friendly note to Mr. Patel about the broken heater in flat 12B, and make sure it is done within 7 days, thank you so much for all of your kind help with this.";
    const t = setup({
      data: () => ({ intent_summary: "x", clarity: "clear", clarity_note: "", no_change_reason: "", edits: [{ original: ", and make sure it is done within 7 days", replacement: "", type: "filler", reason: "Wordy.", risk: "low" }] })
    });
    t.a.value = text;
    t.focus(t.a);
    t.review();
    await sleep(30);
    assert.ok(/0 selected, 1 left out/.test(t.panelText()), t.panelText());
    const edit = t.w.document.getElementById("prompt-review-host").shadowRoot.querySelector(".edit");
    edit.dispatchEvent(new t.w.Event("mouseenter"));
    const detail = t.w.document.getElementById("prompt-review-host").shadowRoot.querySelector(".detail").textContent;
    assert.ok(/Model: low risk/.test(detail) && /Basic check: removes/.test(detail), detail);
    t.btn("Accept rewrite").click();
    assert.strictEqual(t.a.value, text); // nothing selected, so the prompt is unchanged
  });

  await test("no edits: says no rewrite was suggested and does not call the prompt optimal", async () => {
    const t = setup({ data: () => ({ intent_summary: "x", clarity: "clear", clarity_note: "", no_change_reason: "Every phrase states a requirement.", edits: [] }) });
    t.a.value = PROMPT;
    t.focus(t.a);
    t.review();
    await sleep(30);
    const txt = t.panelText();
    assert.ok(/No rewrite suggested/.test(txt) && /Every phrase states a requirement/.test(txt) && /does not mean your prompt is perfect/.test(txt), txt);
  });

  await test("Accept is blocked if a cases.json must-keep is missing from the resulting prompt", async () => {
    const text = "Can you please write me a formal email to my landlord, Mr. Patel, about the broken heater in flat 12B? It has been broken since 3 March and I want it fixed within 7 days. Please make sure the email is formal and polite. Please don't threaten legal action.";
    const t = setup({
      data: () => ({
        intent_summary: "Email landlord", clarity: "clear", clarity_note: "", no_change_reason: "",
        edits: [{ original: " in flat 12B", replacement: "", type: "filler", reason: "Remove flat number.", risk: "low" }]
      })
    });
    t.a.value = text;
    t.focus(t.a);
    t.review();
    await sleep(30);
    const edit = t.w.document.getElementById("prompt-review-host").shadowRoot.querySelector(".edit");
    if (edit && !edit.classList.contains("on")) edit.click();
    t.btn("Accept rewrite").click();
    assert.ok(/Cannot accept rewrite/i.test(t.panelText()) && /12B/.test(t.panelText()), t.panelText());
    assert.strictEqual(t.a.value, text);
  });

  console.log(`\n${passed} passed`);
})();
