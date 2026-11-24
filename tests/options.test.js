// Run with: node tests/options.test.js   (options page in jsdom: switching providers keeps each provider's settings apart)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function open(initial) {
  const html = fs.readFileSync(path.join(root, "options.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/" });
  const w = dom.window;
  const store = { ...initial };
  const asked = [];
  w.chrome = {
    storage: { local: { get: async (d) => ({ ...d, ...store }), set: async (o) => Object.assign(store, o) } },
    permissions: { request: async (o) => (asked.push(o), true) }
  };
  w.confirm = () => true;
  w.eval(fs.readFileSync(path.join(root, "providers.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(root, "options.js"), "utf8"));
  await sleep(20);
  const $ = (id) => w.document.getElementById(id);
  const choose = async (v) => {
    $("provider").value = v;
    $("provider").dispatchEvent(new w.Event("change"));
    await sleep(5);
  };
  const save = async () => {
    $("save").click();
    await sleep(20);
  };
  return { w, $, store, asked, choose, save };
}

(async () => {
  await test("old single-provider settings show up under NVIDIA", async () => {
    const o = await open({ apiKey: "OLD", model: "m1" });
    assert.strictEqual(o.$("provider").value, "nvidia");
    assert.strictEqual(o.$("apiKey").value, "OLD");
    assert.strictEqual(o.$("model").value, "m1");
  });

  await test("each provider keeps its own key and model when you switch back and forth", async () => {
    const o = await open({});
    o.$("apiKey").value = "NVKEY";
    o.$("model").value = "nv-model";
    await o.save();
    await o.choose("gemini");
    assert.strictEqual(o.$("apiKey").value, "", "the NVIDIA key must not appear under Gemini");
    o.$("apiKey").value = "GKEY";
    o.$("model").value = "gem-model";
    await o.save();
    assert.strictEqual(o.store.provider, "gemini");
    assert.strictEqual(o.store.providers.nvidia.apiKey, "NVKEY");
    assert.strictEqual(o.store.providers.gemini.apiKey, "GKEY");
    await o.choose("nvidia");
    assert.strictEqual(o.$("apiKey").value, "NVKEY");
    assert.strictEqual(o.$("model").value, "nv-model");
  });

  await test("Gemini hides the endpoint field and shows the thinking option; NVIDIA does the opposite", async () => {
    const o = await open({});
    assert.strictEqual(o.$("endpointRow").hidden, false);
    assert.strictEqual(o.$("thinkingRow").hidden, true);
    await o.choose("gemini");
    assert.strictEqual(o.$("endpointRow").hidden, true);
    assert.strictEqual(o.$("thinkingRow").hidden, false);
  });

  await test("the page says which host the draft will go to, and updates when you switch", async () => {
    const o = await open({});
    assert.ok(/integrate\.api\.nvidia\.com/.test(o.$("whereSent").textContent));
    await o.choose("gemini");
    assert.ok(/generativelanguage\.googleapis\.com/.test(o.$("whereSent").textContent));
  });

  await test("a custom endpoint asks for permission for that host only; refusal means nothing is saved", async () => {
    const o = await open({});
    await o.choose("custom");
    o.$("apiKey").value = "K";
    o.$("model").value = "m";
    o.$("endpoint").value = "https://llm.example.org/v1/chat/completions";
    await o.save();
    assert.strictEqual(JSON.stringify(o.asked[0].origins), '["https://llm.example.org/*"]');
    assert.strictEqual(o.store.provider, "custom");
    const o2 = await open({});
    o2.w.chrome.permissions.request = async () => false;
    await o2.choose("custom");
    o2.$("endpoint").value = "https://llm.example.org/v1/chat/completions";
    await o2.save();
    assert.strictEqual(o2.store.provider, undefined);
    assert.ok(/not granted/.test(o2.$("status").textContent));
  });

  console.log(`\n${passed} passed`);
})();
