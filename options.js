const $ = (id) => document.getElementById(id);
const { PROVIDERS, STORE_DEFAULTS, resolveSettings } = PRV;

const COLS = [
  "trace_id", "ts", "host", "site_tier", "target_method", "decision", "undo", "outcome", "prompt_version", "provider", "model", "level",
  "tokens_before", "tokens_proposed", "tokens_after", "saved_pct", "review_cost_in", "review_cost_out",
  "edits_proposed", "edits_total", "edits_accepted", "edits_flagged_by_check", "edits_normalized", "dropped_unmatched", "dropped_protected", "dropped_noop", "dropped_invalid",
  "schema_ok", "preserve_checked", "clarity", "clarity_source", "confirmed_loss", "lost_at_decision", "write_back", "review_ms", "intent_feedback", "error", "text_before", "text_after"
];

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const sum = (arr, k) => arr.reduce((t, l) => t + (Number(l[k]) || 0), 0);

// Compression is one row among several: the others describe what people decided and what went wrong.
function renderStats(log) {
  const count = (d) => log.filter((l) => l.decision === d).length;
  const reviews = log.filter((l) => l.decision || l.outcome !== "ok");
  const used = log.filter((l) => l.decision === "accepted" || l.decision === "edited");
  const withEdits = log.filter((l) => l.edits_total > 0);
  const rated = log.filter((l) => l.intent_feedback);
  const failures = log.filter((l) => l.outcome === "api_error" || l.outcome === "schema_error");
  const saved = sum(used, "tokens_before") - sum(used, "tokens_after");
  const cost = sum(log, "review_cost_in") + sum(log, "review_cost_out");
  const times = log.map((l) => l.review_ms).filter(Boolean).sort((a, b) => a - b);
  const median = times.length ? `${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} s` : "n/a";
  const rows = [
    ["Reviews run", reviews.length],
    ["Accepted as suggested", count("accepted")],
    ["Accepted after editing by hand", count("edited")],
    ["Kept original", count("kept_original")],
    ["Dismissed", count("dismissed")],
    ["Undone after accepting", count("undone")],
    ["Undo skipped to protect newer text", log.filter((l) => l.undo === "blocked").length],
    ["Accept blocked because the prompt changed", count("blocked_changed")],
    ["Box would not take the change", count("write_failed")],
    ["Accepted after confirming a lost detail", log.filter((l) => l.confirmed_loss && (l.decision === "accepted" || l.decision === "edited")).length],
    ["Dates put back into the writer's style", sum(log, "edits_normalized")],
    ["Reviews run without the preservation checks", log.filter((l) => l.preserve_checked === false).length],
    ["Changes selected by the user", pct(sum(withEdits, "edits_accepted"), sum(withEdits, "edits_total"))],
    ["Changes the basic check flagged", sum(log, "edits_flagged_by_check")],
    ["Suggestions ignored (inside code, tables, quotes)", sum(log, "dropped_protected")],
    ["Readback rated 'matches what I meant'", rated.length ? `${pct(rated.filter((l) => l.intent_feedback === "match").length, rated.length)} of ${rated.length}` : "no ratings yet"],
    ["Median time to decide", median],
    ["Prompt tokens saved on used prompts (estimate)", saved],
    ["Tokens spent on the reviews themselves", cost],
    ["Net tokens (saved minus review cost)", saved - cost],
    ["API or format failures", failures.length]
  ];
  $("stats").replaceChildren(
    ...rows.map(([a, b]) => {
      const tr = document.createElement("tr");
      const t1 = document.createElement("td");
      const t2 = document.createElement("td");
      t1.textContent = a;
      t2.textContent = b;
      tr.append(t1, t2);
      return tr;
    })
  );
}

let stored = { ...STORE_DEFAULTS, log: [] };
let active = "nvidia";
const safeHost = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

// Show the fields for one provider, filled from what is stored for that provider only.
function showProvider(name) {
  active = name;
  const def = PROVIDERS[name];
  const mine = resolveSettings({ ...stored, provider: name });
  $("provider").value = name;
  $("apiKey").value = mine.apiKey;
  $("apiKey").placeholder = def.keyHint;
  $("model").value = mine.model;
  $("model").placeholder = def.model || "model name";
  $("endpoint").value = def.editableEndpoint ? mine.endpoint : "";
  $("endpoint").placeholder = def.endpoint || "https://.../v1/chat/completions";
  $("endpointRow").hidden = !def.editableEndpoint;
  $("thinkingRow").hidden = def.kind !== "gemini";
  $("noThinking").checked = mine.noThinking;
  $("modelHint").textContent = name === "gemini" ? "Any Gemini model your key can access." : "Any model your key or endpoint can access.";
  const host = safeHost(def.editableEndpoint ? $("endpoint").value || def.endpoint : def.endpoint);
  $("whereSent").textContent = `Your draft will be sent to ${host || "the endpoint you enter below"}.`;
}

async function load() {
  stored = { ...STORE_DEFAULTS, log: [], ...(await chrome.storage.local.get({ ...STORE_DEFAULTS, log: [] })) };
  $("level").value = stored.level;
  $("storeText").checked = stored.storeText;
  showProvider(resolveSettings(stored).provider);
  renderStats(stored.log);
}

$("provider").addEventListener("change", () => showProvider($("provider").value));
$("endpoint").addEventListener("input", () => {
  const h = safeHost($("endpoint").value);
  if (h) $("whereSent").textContent = `Your draft will be sent to ${h}.`;
});

$("save").addEventListener("click", async () => {
  const def = PROVIDERS[active];
  let endpoint = def.endpoint;
  if (def.editableEndpoint) {
    endpoint = $("endpoint").value.trim() || def.endpoint;
    try {
      const u = new URL(endpoint);
      const known = ["integrate.api.nvidia.com", "localhost", "127.0.0.1"];
      if (!known.includes(u.hostname)) {
        // A custom host needs the user's explicit permission, granted now and only for that host.
        const ok = await chrome.permissions.request({ origins: [`${u.origin}/*`] });
        if (!ok) return ($("status").textContent = `Not saved: permission for ${u.hostname} was not granted.`);
      }
    } catch {
      return ($("status").textContent = "Not saved: the endpoint is not a valid URL.");
    }
  }
  // Only the active provider's entry changes; the others keep their own keys.
  const providers = { ...(stored.providers || {}) };
  providers[active] = {
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || def.model,
    ...(def.editableEndpoint ? { endpoint } : {}),
    ...(def.kind === "gemini" ? { noThinking: $("noThinking").checked } : {})
  };
  const next = { provider: active, providers, level: $("level").value, storeText: $("storeText").checked };
  await chrome.storage.local.set(next);
  stored = { ...stored, ...next };
  $("status").textContent = `Saved. Using ${def.label}.`;
  setTimeout(() => ($("status").textContent = ""), 2200);
});

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

$("export").addEventListener("click", async () => {
  const { log = [] } = await chrome.storage.local.get({ log: [] });
  const lines = [COLS.join(",")];
  for (const l of log) {
    const saved = l.tokens_before ? Math.round(((l.tokens_before - l.tokens_after) / l.tokens_before) * 100) : "";
    lines.push(COLS.map((c) => csvCell(c === "saved_pct" ? saved : l[c])).join(","));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = "prompt-review-log.csv";
  a.click();
});

$("clear").addEventListener("click", async () => {
  if (!confirm("Delete all logged reviews?")) return;
  await chrome.storage.local.set({ log: [] });
  renderStats([]);
});

load();
