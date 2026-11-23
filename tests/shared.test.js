// Run with: node tests/shared.test.js
const assert = require("assert");
require("../shared.js");
const PR = globalThis.PR;

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log("ok   ", name);
  } catch (e) {
    console.error("FAIL ", name, "\n     ", e.message);
    process.exitCode = 1;
  }
};
const E = (original, replacement, type = "filler", risk = "low") => ({ original, replacement, type, reason: "test", risk });
const apply = (text, edits, selectAll = false) => {
  const loc = PR.locate(text, edits);
  if (selectAll) loc.edits.forEach((e) => (e.accepted = true));
  return { ...loc, out: PR.resultText(text, loc.edits) };
};

const CODE = "Explain this:\n\n    def f(x):\n        return x  *  2\n\nPlease be brief, thanks!";
const TABLE = "Compare these, kindly:\n\n| Name | Score |\n|------|-------|\n| Ann  |   9   |\n\nThanks so much!";
const FENCE = "Could you kindly fix this?\n```js\nconst a  =  1;\n\tif (a) {  }\n```\nThanks!";

test("nothing selected returns the original byte-for-byte", () => {
  for (const t of [CODE, TABLE, FENCE, "  leading and trailing  \n\n", "a  b\t\tc"]) {
    const loc = PR.locate(t, [E("Please be brief", "Be brief"), E("kindly ", ""), E("Thanks!", "")]);
    loc.edits.forEach((e) => (e.accepted = false));
    assert.strictEqual(PR.resultText(t, loc.edits), t);
  }
});

test("untouched text, including double spaces and indentation, is preserved exactly", () => {
  const r = apply(CODE, [E("Please be brief, thanks!", "Be brief.")]);
  assert.strictEqual(r.out, "Explain this:\n\n    def f(x):\n        return x  *  2\n\nBe brief.");
});

test("tables keep their spacing when prose around them is edited", () => {
  const r = apply(TABLE, [E("kindly ", ""), E("\n\nThanks so much!", "")], true);
  assert.ok(r.out.includes("| Ann  |   9   |"));
  assert.ok(r.out.includes("|------|-------|"));
  assert.strictEqual(r.out.startsWith("Compare these,"), true);
});

test("code fence contents are never changed", () => {
  const r = apply(FENCE, [E("Could you kindly fix this?", "Fix this."), E("Thanks!", "")]);
  assert.ok(r.out.includes("```js\nconst a  =  1;\n\tif (a) {  }\n```"));
});

test("edits inside code, tables, indented lines, inline code and quotes are ignored", () => {
  assert.strictEqual(apply(FENCE, [E("const a  =  1;", "const a = 1;")]).skippedProtected, 1);
  assert.strictEqual(apply(TABLE, [E("| Ann  |   9   |", "| Ann | 9 |")]).skippedProtected, 1);
  assert.strictEqual(apply(CODE, [E("return x  *  2", "return x*2")]).skippedProtected, 1);
  assert.strictEqual(apply("Run `ls   -la` please", [E("ls   -la", "ls -la")]).skippedProtected, 1);
  assert.strictEqual(apply('Translate "Where is the   station?" now', [E("Where is the   station?", "Where is the station?")]).skippedProtected, 1);
});

test("a deleted phrase does not leave a double space or a space before punctuation", () => {
  assert.strictEqual(apply("I really love cats and dogs.", [E("really", "")], true).out, "I love cats and dogs.");
  assert.strictEqual(apply("Hi! Please write a poem about the sea, thanks so much!", [E("Hi! Please write", "Write"), E(", thanks so much", "")], true).out, "Write a poem about the sea!");
  assert.strictEqual(apply("Hi there, write code.", [E("Hi there,", "")], true).out, "write code.");
  assert.strictEqual(apply("Do X, thanks.\n", [E(", thanks", "")], true).out, "Do X.\n");
});

test("a replacement that swallowed a space does not glue words together", () => {
  assert.strictEqual(apply("Can you please write me a poem", [E("Can you please write me ", "Write")], true).out, "Write a poem");
});

test("only low-risk edits start selected", () => {
  const r = apply("Please write a note, thanks. Do not use emojis.", [E(", thanks", "", "filler", "low"), E("Please write", "Write", "wordy", "medium")]);
  assert.strictEqual(r.edits.find((e) => e.original === "Please write").accepted, false);
  assert.strictEqual(r.edits.find((e) => e.original === ", thanks").accepted, true);
});

test("model risk and interface risk are kept separate", () => {
  const r = apply("Keep it within 7 days.", [E(" within 7 days", "", "filler", "low")]);
  const e = r.edits[0];
  assert.strictEqual(e.modelRisk, "low");
  assert.strictEqual(e.risk, "high");
  assert.ok(e.flags.some((f) => f.kind === "dropped"));
  assert.strictEqual(e.accepted, false);
});

test("repeated not/only words: removing one of several is flagged", () => {
  const t = "Do not use bullet points, and do not use headings. Do not exceed 120 words.";
  const f = apply(t, [E("do not use headings", "use headings")]).edits[0];
  assert.ok(f.flags.some((x) => x.kind === "constraint"));
  const g = apply("Only use sources from 2020, only peer-reviewed.", [E(", only peer-reviewed", ", peer-reviewed")]).edits[0];
  assert.ok(g.flags.some((x) => x.kind === "constraint"));
});

test("a negation kept in the replacement but with fewer occurrences is still flagged", () => {
  const f = apply("Do not use jargon and do not use slang.", [E("Do not use jargon and do not use slang", "Do not use jargon and slang")]).edits[0];
  assert.ok(f.flags.some((x) => x.kind === "constraint"));
  assert.strictEqual(f.accepted, false);
});

test("duplicate phrases: only the first match is changed and the edit is flagged", () => {
  const t = "Please write a blurb. Please make it friendly. Please keep it short.";
  const r = apply(t, [E("Please ", "")]);
  assert.strictEqual(r.edits.length, 1);
  assert.ok(r.edits[0].flags.some((f) => f.kind === "repeated"));
  assert.strictEqual(r.edits[0].accepted, false);
});

test("punctuation: removing a question mark is flagged", () => {
  const f = apply("What is the capital of Australia? Answer in one word.", [E("What is the capital of Australia?", "Capital of Australia")]).edits[0];
  assert.ok(f.flags.some((x) => x.kind === "punctuation"));
});

test("reordered key words are flagged", () => {
  const t = "Only include studies after 2015, not earlier ones.";
  const f = apply(t, [E("Only include studies after 2015, not earlier ones", "Not earlier ones, only studies after 2015")]).edits[0];
  assert.ok(f.flags.some((x) => x.kind === "reordered"));
});

test("changing line breaks is flagged and excluded by default", () => {
  const f = apply("Line one,\nline two please.", [E("Line one,\nline two", "Line one, line two")]).edits[0];
  assert.ok(f.flags.some((x) => x.kind === "structure"));
  assert.strictEqual(f.accepted, false);
});

test("dropped names, quotes, numbers and links are flagged", () => {
  const t = "Write to Mr. Patel at https://example.com about flat 12B by 3 March.";
  assert.ok(apply(t, [E("Write to Mr. Patel", "Write")]).edits[0].flags.some((f) => f.kind === "dropped"));
  assert.ok(apply(t, [E(" by 3 March", "")]).edits[0].flags.some((f) => f.kind === "dropped"));
  assert.ok(apply(t, [E(" at https://example.com", "")]).edits[0].flags.some((f) => f.kind === "dropped"));
});

test("a harmless deletion is rated low by the check", () => {
  const f = apply("Write a poem, thanks so much.", [E(", thanks so much", "")]).edits[0];
  assert.strictEqual(f.flags.length, 0);
  assert.strictEqual(f.accepted, true);
});

test("whole-prompt warnings catch a combination the per-edit check cannot", () => {
  const t = "Do not use emojis. Say it briefly. Do not add links.";
  const w = PR.promptChecks(t, "Use emojis. Say it briefly. Do not add links.");
  assert.ok(w.some((x) => /not/.test(x)));
  assert.deepStrictEqual(PR.promptChecks(t, t), []);
});

test("whole-prompt warnings catch changed structure", () => {
  const w = PR.promptChecks("a\n- one\n- two\nb", "a - one - two b");
  assert.ok(w.some((x) => /Line breaks/.test(x)));
});

test("unmatched and invalid edits are counted, not applied", () => {
  const r = apply("Write a poem.", [E("not in the text", ""), { original: 5, replacement: "" }]);
  assert.strictEqual(r.edits.length, 0);
  assert.strictEqual(r.unmatched, 2);
});

test("overlapping edits: the later one is dropped", () => {
  const r = apply("Please kindly write a poem", [E("Please kindly", "Please"), E("kindly write", "write")]);
  assert.strictEqual(r.edits.length, 1);
  assert.strictEqual(r.unmatched, 1);
});

test("answer checks", () => {
  const ans = "- one\n- two\n- three\n";
  assert.strictEqual(PR.runChecks(ans, [{ type: "listCount", value: 3 }, { type: "maxWords", value: 10 }, { type: "notContains", value: "four" }]).passed, 3);
  assert.deepStrictEqual(PR.runChecks("Hello there. How are you? Fine.", [{ type: "maxSentences", value: 2 }]).failed, ["maxSentences:2"]);
  assert.strictEqual(PR.runChecks("Nice 😀", [{ type: "notMatch", value: "\\p{Extended_Pictographic}", flags: "u" }]).passed, 0);
});

test("tier: no host is tested until it is listed", () => {
  assert.strictEqual(PR.tierFor("claude.ai"), PR.TESTED_HOSTS.includes("claude.ai") ? "tested" : "best_effort");
  assert.strictEqual(PR.tierFor("example.com"), "best_effort");
});

test("deterministic clarity: flags dangling pronouns without context as unclear (c07)", () => {
  const c07 = PR.classifyClarity("Make it better and more professional. Thanks!");
  assert.strictEqual(c07.clarity, "unclear");
  assert.ok(/Missing the source text/i.test(c07.note), c07.note);

  const fixThis = PR.classifyClarity("Fix this bug please.");
  assert.strictEqual(fixThis.clarity, "unclear");

  const followingEmpty = PR.classifyClarity("Summarise the following paragraph:");
  assert.strictEqual(followingEmpty.clarity, "unclear");

  const clearPrompt = PR.classifyClarity("Explain photosynthesis in simple terms under 100 words.");
  assert.strictEqual(clearPrompt.clarity, "clear");
});

test("semantic date normalization: recognizes equivalent date formats", () => {
  assert.strictEqual(PR.datesMatch("3 March", "March 3"), true);
  assert.strictEqual(PR.datesMatch("3rd March", "March 3rd"), true);
  assert.strictEqual(PR.datesMatch("3 March", "4 March"), false);
});

test("semantic date normalization: automatically preserves author's date format in edits", () => {
  const normalized = PR.normalizeDateInText("Broken since March 3", "broken since 3 March");
  assert.strictEqual(normalized, "Broken since 3 March");

  const edits = [{ original: "broken since 3 March", replacement: "broken since March 3", type: "filler", risk: "low" }];
  const res = PR.normalizeDateEdits("It has been broken since 3 March", edits);
  assert.strictEqual(res[0].replacement, "broken since 3 March");
});

test("must-keep validation: detects missing cases.json must-keeps", () => {
  const c02Text = "Can you please write me a formal email to my landlord, Mr. Patel, about the broken heater in flat 12B? It has been broken since 3 March and I want it fixed within 7 days. Please make sure the email is formal and polite. Please don't threaten legal action.";
  // Intentionally drop "flat 12B"
  const missingResult = "Can you write an email to Mr. Patel about the broken heater? Broken since 3 March, fix within 7 days. Please don't threaten legal action.";
  const valMissing = PR.validateMustKeeps(c02Text, missingResult);
  assert.strictEqual(valMissing.passed, false);
  assert.ok(valMissing.missing.includes("12B"));

  // Keep all must-keeps (with semantic date normalization "March 3" satisfying "3 March")
  const validResult = "Write a formal email to Mr. Patel about the broken heater in flat 12B. Broken since March 3, fix within 7 days. Don't threaten legal action.";
  const valOk = PR.validateMustKeeps(c02Text, validResult);
  assert.strictEqual(valOk.passed, true);
  assert.strictEqual(valOk.missing.length, 0);
});

test("background.js validate: exact-preservation checks", () => {
  const bg = require("../background.js");
  const prompt = "Please check this code: ```def f(): return 1``` and date 3 March. Thanks!";

  // 1. Non-verbatim edit should be dropped
  const nonVerbatim = {
    intent_summary: "Test", clarity: "clear", clarity_note: "", no_change_reason: "",
    edits: [{ original: "non existent text", replacement: "foo", type: "filler", risk: "low", reason: "test" }]
  };
  const res1 = bg.validate(nonVerbatim, prompt);
  assert.strictEqual(res1.data.edits.length, 0);
  assert.strictEqual(res1.invalid, 1);

  // 2. Protected region edit should be dropped
  const insideCode = {
    intent_summary: "Test", clarity: "clear", clarity_note: "", no_change_reason: "",
    edits: [{ original: "return 1", replacement: "return 2", type: "wordy", risk: "low", reason: "test" }]
  };
  const res2 = bg.validate(insideCode, prompt);
  assert.strictEqual(res2.data.edits.length, 0);
  assert.strictEqual(res2.invalid, 1);

  // 3. Verbatim edit outside protected region is kept and date normalized
  const validEdit = {
    intent_summary: "Test", clarity: "clear", clarity_note: "", no_change_reason: "",
    edits: [{ original: "date 3 March", replacement: "date March 3", type: "wordy", risk: "low", reason: "test" }]
  };
  const res3 = bg.validate(validEdit, prompt);
  assert.strictEqual(res3.data.edits.length, 1);
  assert.strictEqual(res3.data.edits[0].replacement, "date 3 March"); // normalized to author's format!
});

test("background.js validate and parse tolerate malformed model objects", () => {
  const bg = require("../background.js");
  const parsedNull = bg.validate(null, "Explain photosynthesis.");
  assert.strictEqual(parsedNull.data.edits.length, 0);
  assert.strictEqual(parsedNull.schemaOk, false);

  const parsed = bg.parseJson("```json\n{\"intent_summary\":\"Test\",\"clarity\":\"clear\",\"clarity_note\":\"\",\"no_change_reason\":\"\",\"edits\":[]}\n```");
  assert.strictEqual(parsed.intent_summary, "Test");
  assert.strictEqual(parsed.edits.length, 0);

  // 4. Deterministic clarity on unclear request
  const unclearReq = {
    intent_summary: "Make better", clarity: "clear", clarity_note: "", no_change_reason: "",
    edits: []
  };
  const res4 = bg.validate(unclearReq, "Make it better and more professional. Thanks!");
  assert.strictEqual(res4.data.clarity, "unclear");
});

console.log(`\n${passed} passed`);
