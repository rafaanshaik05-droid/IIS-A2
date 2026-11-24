// Run with: node tests/rules.test.js   (dates, must-keeps, clarity, locate)
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

test("dates: common written styles are recognised as the same date", () => {
  const d = (s) => PR.extractDates(s);
  assert.strictEqual(d("on 3 March please")[0].day, 3);
  assert.ok(PR.sameDate(d("3 March")[0], d("March 3")[0]));
  assert.ok(PR.sameDate(d("3rd of March")[0], d("March 3rd")[0]));
  assert.ok(PR.sameDate(d("3 March 2026")[0], d("March 3, 2026")[0]));
  assert.ok(!PR.sameDate(d("3 March 2026")[0], d("3 March")[0]), "a year that appears or disappears is a different statement");
  assert.ok(!PR.sameDate(d("3 March")[0], d("4 March")[0]));
});

test("dates: the verb 'may' and numeric slash dates are not treated as named dates", () => {
  assert.strictEqual(PR.extractDates("you may 5 times try").length, 0);
  assert.strictEqual(PR.extractDates("due 03/04/2026").length, 0);
  assert.strictEqual(PR.extractDates("due May 5").length, 1);
});

test("dates: a restyled date is put back, several in one replacement, lengths differing", () => {
  const n = PR.normalizeDates("Between March 3 and March 15th we meet.", "Between 3 March and 15 March we meet.");
  assert.strictEqual(n.text, "Between 3 March and 15 March we meet.");
  assert.strictEqual(n.changes.length, 2);
  assert.deepStrictEqual(PR.normalizeDates("Due 4 March.", "Due 3 March.").changes, []);
  assert.strictEqual(PR.normalizeDateInText("March 3, 2026", "3 March"), "March 3, 2026", "different year: left alone");
});

test("locate: a restyled date is normalised, recorded, and not counted as a dropped detail", () => {
  const t = "Please could you kindly write to Mr. Patel about the heater by 3 March, thank you so much.";
  const r = PR.locate(t, [E("kindly write to Mr. Patel about the heater by 3 March", "write to Mr. Patel about the heater by March 3")]);
  assert.strictEqual(r.edits.length, 1);
  assert.strictEqual(r.edits[0].replacement, "write to Mr. Patel about the heater by 3 March");
  assert.strictEqual(r.edits[0].normalized.length, 1);
  assert.ok(!r.edits[0].flags.some((f) => f.kind === "dropped"), JSON.stringify(r.edits[0].flags));
  assert.strictEqual(r.normalized, 1);
});

test("locate: an edit that only restyles a date changes nothing and is dropped as a no-op", () => {
  const r = PR.locate("The party is on 3 March at noon.", [E("3 March", "March 3")]);
  assert.strictEqual(r.edits.length, 0);
  assert.strictEqual(r.noop, 1);
});

test("locate: a dropped date is reported as the date, not as a stray number", () => {
  const r = PR.locate("Send it by 3 March, thank you so much for helping.", [E(" by 3 March", "")]);
  const f = r.edits[0].flags.find((x) => x.kind === "dropped");
  assert.ok(f && /3 March/.test(f.text), JSON.stringify(r.edits[0].flags));
  assert.strictEqual(r.edits[0].accepted, false);
});

test("must-keeps come from the prompt itself, never from stored test data", () => {
  const prompt = "Explain photosynthesis to me in simple terms.";
  const v = PR.validateMustKeeps(prompt, "Explain photosynthesis simply.");
  assert.ok(!v.mustKeeps.some((k) => /100/.test(k)), "must not demand text the prompt never had");
  assert.strictEqual(v.passed, true);
});

test("must-keeps: dates count as kept in any style, a missing detail is reported", () => {
  const prompt = "Write to Mr. Patel about flat 12B, it has been broken since 3 March and must be fixed within 7 days.";
  assert.strictEqual(PR.validateMustKeeps(prompt, "Write to Mr. Patel about flat 12B: broken since March 3, fix within 7 days, must.").missing.length, 0);
  const v = PR.validateMustKeeps(prompt, "Write to Mr. Patel about flat 12B.");
  assert.ok(v.missing.includes("3 March") && v.missing.includes("7"), JSON.stringify(v.missing));
});

test("must-keeps: extra strings are checked too (harness only), and fewer 'not' words are reported", () => {
  const v = PR.validateMustKeeps("Do not use bullets. Do not use headings.", "Do not use bullets. Use headings.", ["bullets"]);
  assert.deepStrictEqual(v.missing, []);
  assert.deepStrictEqual(v.fewer, ["not"]);
  assert.strictEqual(v.passed, false);
  assert.deepStrictEqual(PR.validateMustKeeps("Write a poem.", "Write a poem.", ["haiku"]).missing, ["haiku"]);
});

test("clarity: dangling references are unclear, and the note does not blame the user for follow-ups", () => {
  for (const t of ["Make it better and more professional. Thanks!", "Fix this.", "Summarise the following paragraph in three bullet points.", "Please summarise the following text:", "Thanks!"]) {
    const c = PR.classifyClarity(t);
    assert.strictEqual(c.clarity, "unclear", t);
    assert.strictEqual(c.decided, true);
  }
  assert.ok(/earlier message in the chat/.test(PR.classifyClarity("Make it shorter.").note));
});

test("clarity: prompts with their content, or self-contained, are not called unclear by the rules", () => {
  const ok = [
    "Summarise the following paragraph in three bullet points.\n\nParagraph: Many companies now let staff work from home and say it saves time for everyone involved.",
    "Explain what this Python line does: `[x**2 for x in range(10)]`.",
    "List five healthy breakfast ideas under 400 calories each.",
    "Write a poem about the sea for my daughter, who loves boats, and please make it rhyme nicely at the end of each line."
  ];
  for (const t of ok) {
    const c = PR.classifyClarity(t);
    assert.strictEqual(c.decided, false, t);
    assert.notStrictEqual(c.clarity, "clear", "the rules never claim a prompt is clear");
  }
});

test("locate: edits that reach the page are exactly the verbatim, unprotected, non-overlapping ones", () => {
  const t = "Could you kindly write a note? `kindly` stays here. Thanks so much for helping me out today.";
  const r = PR.locate(t, [E("Could you kindly write", "Write"), E("`kindly`", "kind"), E("not present", ""), E("Thanks so much for helping me out today.", "Thanks.")]);
  assert.strictEqual(r.edits.length, 2);
  assert.strictEqual(r.skippedProtected, 1);
  assert.strictEqual(r.unmatched, 1);
});

console.log(`\n${passed} passed`);
