// Model providers the user can switch between in Options. Loaded by the background worker and the options page.
// Each provider keeps its own key, model and endpoint, so switching never sends one provider's key to another.
(() => {
  const PROVIDERS = {
    nvidia: {
      label: "NVIDIA NIM",
      kind: "openai", // OpenAI-style /chat/completions
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "nvidia/nemotron-3.5-bolt-e4b",
      editableEndpoint: true, // e.g. a local NIM container
      keyHint: "nvapi-..."
    },
    gemini: {
      label: "Google Gemini",
      kind: "gemini", // native generateContent
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
      model: "gemini-2.5-flash",
      editableEndpoint: false,
      keyHint: "Gemini API key"
    },
    custom: {
      label: "Other (OpenAI-compatible)",
      kind: "openai",
      endpoint: "",
      model: "",
      editableEndpoint: true,
      keyHint: "API key"
    }
  };

  // `apiKey`, `model` and `endpoint` at the top level are the older single-provider layout, which belonged to NVIDIA.
  const STORE_DEFAULTS = { provider: "nvidia", providers: {}, level: "balanced", storeText: false, apiKey: "", model: "", endpoint: "" };

  function resolveSettings(stored) {
    const s = { ...STORE_DEFAULTS, ...(stored || {}) };
    const provider = PROVIDERS[s.provider] ? s.provider : "nvidia";
    const def = PROVIDERS[provider];
    const providers = s.providers && typeof s.providers === "object" ? s.providers : {};
    const legacy = provider === "nvidia" && !providers.nvidia ? { apiKey: s.apiKey, model: s.model, endpoint: s.endpoint } : {};
    const mine = { ...legacy, ...(providers[provider] || {}) };
    return {
      provider,
      kind: def.kind,
      label: def.label,
      apiKey: mine.apiKey || "",
      model: mine.model || def.model,
      endpoint: def.editableEndpoint ? mine.endpoint || def.endpoint : def.endpoint,
      noThinking: !!mine.noThinking,
      level: s.level,
      storeText: !!s.storeText
    };
  }

  globalThis.PRV = { PROVIDERS, STORE_DEFAULTS, resolveSettings };
})();
