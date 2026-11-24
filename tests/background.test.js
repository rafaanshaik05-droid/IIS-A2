// Run with: node tests/background.test.js   (worker logic with a mocked network and storage)
const assert = require("assert");
require("../shared.js");
require("../providers.js");
const bg = require("../background.js");
const PRV = globalThis.PRV;

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
const E = (original, replacement, type = "filler", risk = "low") => ({ original, replacement, type, reason: "test", risk });
const TEXT = "Hi there! Could you kindly write a short note to Mr. Patel by 3 March? `kindly` stays. Thanks so much!";

function mockEnv(settings, replyJson, status = 200, errorBody = "") {
  global.chrome = { storage: { local: { get: async () => ({ apiKey: "KEY123", ...settings }), set: async () => {} } } };
  global.fetch = async (url, init) => {
    global.lastFetch = { url, init };
    if (status !== 200) return { ok: false, status, text: async () => errorBody };
    return { ok: true, status, json: async () => ({ choices: [{ message: { content: JSON.stringify(replyJson) } }], usage: { prompt_tokens: 100, completion_tokens: 40 } }) };
  };
}

(async () => {
  await test("validate checks the shape only: a well-formed edit that is not in the draft still passes", () => {
    const v = bg.validate({ intent_summary: "x", edits: [E("not in the draft", ""), { original: "a" }] });
    assert.strictEqual(v.data.edits.length, 1);
    assert.strictEqual(v.invalid, 1);
    assert.strictEqual(v.schemaOk, false);
    assert.strictEqual(v.proposed, 2);
    assert.strictEqual(bg.validate({ intent_summary: "x", edits: [E("not in the draft", "")] }).schemaOk, true);
  });

  await test("preflight counts content drops by reason and keeps the preserved edits", () => {
    const edits = [E("Hi there! Could you kindly write", "Write"), E("`kindly`", "kind"), E("missing text", ""), E("Thanks so much!", "Thanks so much!"), E("3 March", "March 3")];
    const p = bg.preflight(TEXT, edits);
    assert.strictEqual(p.counts.preserve_checked, true);
    assert.strictEqual(p.counts.skipped_protected, 1);
    assert.strictEqual(p.counts.unmatched, 1);
    assert.strictEqual(p.counts.noop, 2);
    assert.strictEqual(p.edits.length, 1);
    assert.strictEqual(p.edits[0].replacement, "Write");
  });

  await test("preflight reports when the preservation rules could not run, instead of skipping silently", () => {
    const saved = globalThis.PR;
    delete globalThis.PR;
    try {
      const p = bg.preflight(TEXT, [E("kindly ", "")]);
      assert.strictEqual(p.counts.preserve_checked, false);
      assert.strictEqual(p.edits.length, 1);
    } finally {
      globalThis.PR = saved;
    }
  });

  await test("clarity: a rule beats the model and is labelled; the model's view is labelled when no rule fires", () => {
    const a = bg.applyClarity({ clarity: "clear", clarity_note: "" }, "Make it better and more professional. Thanks!");
    assert.strictEqual(a.clarity, "unclear");
    assert.strictEqual(a.clarity_source, "rule");
    const b = bg.applyClarity({ clarity: "unclear", clarity_note: "no audience" }, "Write a poem about the sea for my daughter who loves boats and whales and lighthouses.");
    assert.strictEqual(b.clarity, "unclear");
    assert.strictEqual(b.clarity_source, "model");
    assert.strictEqual(bg.applyClarity({ clarity: "clear" }, "List five healthy breakfast ideas under 400 calories each.").clarity_source, "");
  });

  await test("the request contains no wording, dates or numbers from the test cases", () => {
    const s = bg.buildSystem("balanced");
    assert.ok(!/3 March|12B|Patel/.test(s));
  });

  await test("endpoint: local means the host is local, not that 'localhost' appears somewhere in the URL", () => {
    assert.strictEqual(bg.endpointInfo("http://localhost:8000/v1/chat/completions").local, true);
    assert.strictEqual(bg.endpointInfo("https://evil.example/?localhost").local, false);
    assert.strictEqual(bg.endpointInfo("http://example.com/v1").secure, false);
    assert.throws(() => bg.endpointInfo("not a url"));
  });

  await test("a key is never sent over plain http to another host", async () => {
    mockEnv({ endpoint: "http://example.com/v1/chat/completions" }, {});
    await assert.rejects(() => bg.optimise(TEXT, true), /over http/);
    assert.strictEqual(global.lastFetch, undefined);
  });

  await test("end to end: the key goes in a header, the reply is filtered, counted and labelled", async () => {
    global.lastFetch = undefined;
    mockEnv({ endpoint: "https://api.test/v1/chat/completions" }, {
      intent_summary: "Write a note.", clarity: "clear", clarity_note: "", no_change_reason: "",
      edits: [E("Hi there! Could you kindly write", "Write"), E("`kindly`", "kind"), E("missing text", ""), { original: "x" }]
    });
    const r = await bg.optimise(TEXT, true);
    assert.strictEqual(global.lastFetch.init.headers.authorization, "Bearer KEY123");
    assert.ok(!global.lastFetch.url.includes("KEY123"));
    assert.strictEqual(r.data.edits.length, 1);
    assert.strictEqual(r.meta.counts.proposed, 4);
    assert.strictEqual(r.meta.counts.skipped_protected, 1);
    assert.strictEqual(r.meta.counts.unmatched, 1);
    assert.strictEqual(r.meta.invalid_dropped, 1);
    assert.strictEqual(r.meta.schema_ok, false);
    assert.strictEqual(r.meta.preserve_checked, true);
    assert.strictEqual(r.meta.endpoint_host, "api.test");
    assert.strictEqual(r.meta.prompt_version, bg.PROMPT_VERSION);
  });

  await test("an error that echoes the key is scrubbed before it can be shown or logged", async () => {
    mockEnv({ endpoint: "https://api.test/v1/chat/completions" }, {}, 401, "bad key KEY123 rejected");
    await assert.rejects(() => bg.optimise(TEXT, true), (e) => !e.message.includes("KEY123") && /\[key\]/.test(e.message));
  });

  const REPLY = { intent_summary: "Write a note.", clarity: "clear", clarity_note: "", no_change_reason: "", edits: [E("Hi there! Could you kindly write", "Write")] };
  const geminiShape = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 10 } });
  const openaiShape = (obj) => ({ choices: [{ message: { content: "```json\n" + JSON.stringify(obj) + "\n```" } }], usage: { prompt_tokens: 100, completion_tokens: 40 } });
  const TWO = { provider: "gemini", providers: { nvidia: { apiKey: "NVKEY", model: "nv-model" }, gemini: { apiKey: "GKEY", model: "gem-model", noThinking: true } } };
  function mockBoth(stored) {
    global.chrome = { storage: { local: { get: async () => stored, set: async () => {} } } };
    global.requests = [];
    global.fetch = async (url, init) => {
      global.requests.push({ url, init });
      const isGemini = url.includes("generativelanguage.googleapis.com");
      return { ok: true, status: 200, json: async () => (isGemini ? geminiShape(REPLY) : openaiShape(REPLY)) };
    };
  }

  await test("providers: the old single-provider settings still resolve to NVIDIA", () => {
    const r = PRV.resolveSettings({ apiKey: "OLD", model: "m", endpoint: "https://integrate.api.nvidia.com/v1/chat/completions" });
    assert.strictEqual(r.provider, "nvidia");
    assert.strictEqual(r.apiKey, "OLD");
    assert.strictEqual(r.model, "m");
  });

  await test("providers: Gemini's endpoint is fixed, and a custom provider has none until you set one", () => {
    const g = PRV.resolveSettings({ provider: "gemini", providers: { gemini: { apiKey: "G", endpoint: "https://evil.example/" } } });
    assert.ok(g.endpoint.startsWith("https://generativelanguage.googleapis.com/"));
    assert.strictEqual(PRV.resolveSettings({ provider: "custom" }).endpoint, "");
  });

  await test("switching to Gemini: native request, key in a header only, usage includes thinking tokens", async () => {
    mockBoth(TWO);
    const r = await bg.optimise(TEXT, true);
    const q = global.requests[0];
    assert.ok(q.url.includes("generativelanguage.googleapis.com/v1beta/models/gem-model:generateContent"), q.url);
    assert.strictEqual(q.init.headers["x-goog-api-key"], "GKEY");
    assert.ok(!q.url.includes("GKEY"));
    const body = JSON.parse(q.init.body);
    assert.ok(body.systemInstruction && body.generationConfig.responseMimeType === "application/json");
    assert.deepStrictEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    assert.strictEqual(r.meta.provider, "gemini");
    assert.strictEqual(r.meta.model, "gem-model");
    assert.strictEqual(r.meta.usage.input, 120);
    assert.strictEqual(r.meta.usage.output, 40);
    assert.strictEqual(r.meta.endpoint_host, "generativelanguage.googleapis.com");
    assert.strictEqual(r.data.edits.length, 1);
  });

  await test("switching back to NVIDIA: OpenAI-style request, its own key, fenced JSON still parsed", async () => {
    mockBoth({ ...TWO, provider: "nvidia" });
    const r = await bg.optimise(TEXT, true);
    const q = global.requests[0];
    assert.ok(q.url.startsWith("https://integrate.api.nvidia.com/"), q.url);
    assert.strictEqual(q.init.headers.authorization, "Bearer NVKEY");
    assert.strictEqual(JSON.parse(q.init.body).model, "nv-model");
    assert.strictEqual(r.meta.provider, "nvidia");
    assert.strictEqual(r.data.edits.length, 1);
  });

  await test("one provider's key never appears in a request to another", async () => {
    for (const provider of ["gemini", "nvidia"]) {
      mockBoth({ ...TWO, provider });
      await bg.optimise(TEXT, true);
      const wire = JSON.stringify(global.requests);
      const other = provider === "gemini" ? "NVKEY" : "GKEY";
      assert.ok(!wire.includes(other), `${provider} request leaked ${other}`);
    }
  });

  await test("a Gemini error that echoes the key is scrubbed, and a blocked request is explained", async () => {
    global.chrome = { storage: { local: { get: async () => TWO, set: async () => {} } } };
    global.fetch = async () => ({ ok: false, status: 400, text: async () => "API key GKEY not valid" });
    await assert.rejects(() => bg.optimise(TEXT, true), (e) => !e.message.includes("GKEY") && /\[key\]/.test(e.message));
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) });
    await assert.rejects(() => bg.optimise(TEXT, true), /blocked \(SAFETY\)/);
  });

  await test("a custom provider with no endpoint says so instead of guessing one", async () => {
    mockBoth({ provider: "custom", providers: { custom: { apiKey: "K", model: "m" } } });
    await assert.rejects(() => bg.optimise(TEXT, true), /not a valid URL/);
    assert.strictEqual(global.requests.length, 0);
  });

  await test("provider switch needs no other change: the same request text goes to both", async () => {
    const seen = [];
    for (const provider of ["gemini", "nvidia"]) {
      mockBoth({ ...TWO, provider });
      await bg.optimise(TEXT, true);
      const b = JSON.parse(global.requests[0].init.body);
      seen.push(provider === "gemini" ? b.systemInstruction.parts[0].text : b.messages[0].content);
    }
    assert.strictEqual(seen[0], seen[1]);
  });

  console.log(`\n${passed} passed`);
})();
