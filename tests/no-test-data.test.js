// Guard against tuning the product to the test: no run of six words from any test case may appear in product code.
// Run with: node tests/no-test-data.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const cases = ["cases.json", "cases.heldout.json"].flatMap((f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8")));
const product = ["shared.js", "background.js", "content.js", "options.js"].map((f) => [f, fs.readFileSync(path.join(root, f), "utf8").toLowerCase().replace(/\s+/g, " ")]);

let bad = [];
for (const c of cases) {
  const words = c.text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i + 6 <= words.length; i++) {
    const w = words.slice(i, i + 6).join(" ");
    for (const [f, src] of product) if (src.replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").includes(w)) bad.push(`${c.id} in ${f}: "${w}"`);
  }
  for (const k of c.must_keep || []) {
    if (k.length >= 8) for (const [f, src] of product) if (src.includes(k.toLowerCase())) bad.push(`${c.id} must_keep in ${f}: "${k}"`);
  }
}
try {
  assert.deepStrictEqual(bad, []);
  console.log("ok    no test-case text or must-keep strings in product code\n\n1 passed");
} catch (e) {
  console.error("FAIL  test data found in product code:\n  " + bad.slice(0, 10).join("\n  "));
  process.exitCode = 1;
}
