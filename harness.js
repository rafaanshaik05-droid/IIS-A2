// Test harness: same cases, same order, same request as the extension.
// Per case: make the default rewrite, get the chatbot's answer to the original and to the rewrite, run the
// pre-written automatic checks on both answers, and let a rater score the answers without knowing which is which.

const $ = (id) => document.getElementById(id);
const FAULTS = ["", "none", "model rewrite", "interface", "original request", "answer hallucination"];
const HALLUCINATIONS = ["", "none", "rewrite answer", "original answer", "both"];
const SCORES = ["", "0", "1", "2"];
const BETTER = ["", "A", "B", "same"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COLS = [
  "case_id", "category", "run_ts", "prompt_version", "model", "level",
  "api_tokens_original", "api_tokens_rewrite", "api_saved_pct", "est_saved_pct_default", "est_saved_pct_all_changes",
  "edits_proposed", "edits_selected", "edits_flagged_by_check", "dropped_protected", "dropped_unmatched", "dropped_invalid",
  "schema_ok", "clarity", "changed", "expectation_met", "reject_is_best", "reject_outcome_ok", "must_keep_missing",
  "checks_total", "checks_passed_original", "checks_passed_rewrite", "review_cost_in", "review_cost_out",
  "meaning", "constraints", "added", "answer_a_is", "score_a", "score_b", "better", "task_score_original", "task_score_rewrite",
  "fault", "answer_hallucination", "notes", "rewrite_text", "answer_original", "answer_rewrite", "error"
];

let rows = [];

// Retry on rate limits, since a full run makes about three calls per case.
async function call(msg) {
  for (let i = 0; i < 3; i++) {
    const res = await chrome.runtime.sendMessage(msg);
    if (res && (res.ok || !/429|rate/i.test(res.error || ""))) return res;
    await sleep(6000);
  }
  return { ok: false, error: "Rate limited (429) after retries" };
}

async function runCase(c) {
  const row = { case_id: c.id, category: c.category, run_ts: new Date().toISOString(), reject_is_best: !!c.reject_is_best, meaning: "", constraints: "", added: "", score_a: "", score_b: "", better: "", fault: "", answer_hallucination: "", notes: "" };
  const r = await call({ type: "optimise", text: c.text, harness: true });
  if (!r.ok) return { ...row, error: r.error };

  const loc = PR.locate(c.text, r.data.edits); // default selection, exactly as the user would see it
  const out = PR.resultText(c.text, loc.edits);
  const all = PR.resultText(c.text, loc.edits.map((e) => ({ ...e, accepted: true })));
  const changed = out !== c.text;
  const est = (t) => Math.round(((PR.estTokens(c.text) - PR.estTokens(t)) / PR.estTokens(c.text)) * 100);

  const a0 = await call({ type: "answer", text: c.text });
  if (!a0.ok) return { ...row, error: `answer (original): ${a0.error}` };
  let a1 = a0;
  if (changed) {
    a1 = await call({ type: "answer", text: out }); // an unchanged prompt needs no second answer
    if (!a1.ok) return { ...row, error: `answer (rewrite): ${a1.error}` };
  }
  const checks = c.checks || [];
  const c0 = PR.runChecks(a0.text, checks);
  const c1 = PR.runChecks(a1.text, checks);
  const mkCheck = PR.validateMustKeeps ? PR.validateMustKeeps(c.text, out) : { missing: (c.must_keep || []).filter((k) => !out.toLowerCase().includes(k.toLowerCase())) };
  const missing = mkCheck.missing;
  const met = c.expect === "none" ? loc.edits.length === 0 || !changed : c.expect === "unclear" ? r.data.clarity === "unclear" : changed;
  const tIn0 = a0.usage.input;
  const tIn1 = a1.usage.input;
  const flipped = changed && Math.random() < 0.5; // which answer is shown as A
  return {
    ...row,
    prompt_version: r.meta.prompt_version, model: r.meta.model, level: r.meta.level,
    api_tokens_original: tIn0 ?? "", api_tokens_rewrite: tIn1 ?? "",
    api_saved_pct: tIn0 && tIn1 ? Math.round(((tIn0 - tIn1) / tIn0) * 100) : "",
    est_saved_pct_default: est(out), est_saved_pct_all_changes: est(all),
    edits_proposed: r.data.edits.length, edits_selected: loc.edits.filter((e) => e.accepted).length,
    edits_flagged_by_check: loc.edits.filter((e) => e.flags.length).length,
    dropped_protected: loc.skippedProtected, dropped_unmatched: loc.unmatched, dropped_invalid: r.meta.invalid_dropped,
    schema_ok: r.meta.schema_ok, clarity: r.data.clarity, changed, expectation_met: met,
    reject_outcome_ok: c.reject_is_best ? !changed : "",
    must_keep_missing: missing.join(" | "),
    checks_total: checks.length, checks_passed_original: c0.passed, checks_passed_rewrite: c1.passed,
    review_cost_in: r.meta.usage.input ?? "", review_cost_out: r.meta.usage.output ?? "",
    answer_a_is: changed ? (flipped ? "rewrite" : "original") : "original",
    rubric: c.rubric, rewrite_text: out, answer_original: a0.text, answer_rewrite: changed ? a1.text : "",
    task_score_original: "", task_score_rewrite: ""
  };
}

function cell(text, cls) {
  const td = document.createElement("td");
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}
function select(row, key, options) {
  const td = document.createElement("td");
  const sel = document.createElement("select");
  for (const o of options) sel.append(new Option(o, o));
  sel.value = row[key];
  sel.addEventListener("change", () => {
    row[key] = sel.value;
    derive(row);
    summary();
  });
  td.append(sel);
  return td;
}

// Un-blind the scores: A and B were shown in random order.
function derive(r) {
  if (r.score_a === "") return;
  if (!r.changed) {
    r.task_score_original = r.task_score_rewrite = r.score_a;
    return;
  }
  const aIsRewrite = r.answer_a_is === "rewrite";
  r.task_score_rewrite = aIsRewrite ? r.score_a : r.score_b;
  r.task_score_original = aIsRewrite ? r.score_b : r.score_a;
}

function answerBox(r) {
  const td = document.createElement("td");
  const d = document.createElement("details");
  const s = document.createElement("summary");
  s.textContent = r.changed ? "Answers A and B" : "Answer (rewrite unchanged)";
  d.append(s);
  const rub = document.createElement("pre");
  rub.textContent = `Rubric: ${r.rubric}`;
  d.append(rub);
  const mk = (label, text) => {
    const p = document.createElement("pre");
    p.textContent = `${label}\n${text}`;
    return p;
  };
  if (r.changed) {
    const aText = r.answer_a_is === "rewrite" ? r.answer_rewrite : r.answer_original;
    const bText = r.answer_a_is === "rewrite" ? r.answer_original : r.answer_rewrite;
    d.append(mk("Answer A", aText), mk("Answer B", bText));
  } else {
    d.append(mk("Answer", r.answer_original));
  }
  td.append(d);
  const rw = document.createElement("details");
  const rs = document.createElement("summary");
  rs.textContent = "Rewrite text";
  rw.append(rs, mk("", r.rewrite_text));
  td.append(rw);
  return td;
}

function render() {
  const head = ["Case", "Prompt tokens (API) and saved", "Changes selected / flagged / proposed", "Auto checks passed: original → rewrite", "As expected", "Must-keep missing", "Meaning 0-2", "Constraints 0-2", "Added 0-2", "Answer A 0-2", "Answer B 0-2", "Better", "Fault", "Hallucination", "Notes", "Answers"];
  const thead = document.createElement("tr");
  head.forEach((t) => {
    const th = document.createElement("th");
    th.textContent = t;
    thead.append(th);
  });
  const body = rows.map((r) => {
    const tr = document.createElement("tr");
    if (r.error) {
      tr.append(cell(`${r.case_id} ${r.category}`), cell(r.error, "bad"));
      return tr;
    }
    const tok = r.api_tokens_original !== "" ? `${r.api_tokens_original} → ${r.api_tokens_rewrite} (${r.api_saved_pct}%)` : "n/a";
    const exp = r.reject_is_best ? (r.reject_outcome_ok ? "rejected (best outcome)" : "changed (rejecting was best)") : r.expectation_met ? "yes" : "no";
    const expBad = r.reject_is_best ? !r.reject_outcome_ok : !r.expectation_met;
    tr.append(
      cell(`${r.case_id} ${r.category}`), cell(tok), cell(`${r.edits_selected} / ${r.edits_flagged_by_check} / ${r.edits_proposed}`),
      cell(`${r.checks_passed_original}/${r.checks_total} → ${r.checks_passed_rewrite}/${r.checks_total}`, r.checks_passed_rewrite < r.checks_passed_original ? "bad" : ""),
      cell(exp, expBad ? "bad" : ""), cell(r.must_keep_missing || "none", r.must_keep_missing ? "bad" : ""),
      select(r, "meaning", SCORES), select(r, "constraints", SCORES), select(r, "added", SCORES),
      select(r, "score_a", SCORES), r.changed ? select(r, "score_b", SCORES) : cell("n/a"), r.changed ? select(r, "better", BETTER) : cell("n/a"),
      select(r, "fault", FAULTS),
      select(r, "answer_hallucination", HALLUCINATIONS)
    );
    const notes = document.createElement("td");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = r.notes;
    inp.addEventListener("input", () => (r.notes = inp.value));
    notes.append(inp);
    tr.append(notes, answerBox(r));
    return tr;
  });
  $("table").replaceChildren(thead, ...body);
  summary();
}

function summary() {
  const ok = rows.filter((r) => !r.error);
  const box = $("summary");
  if (!ok.length) return (box.hidden = true);
  const changed = ok.filter((r) => r.changed);
  const sum = (a, k) => a.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const saved = changed.reduce((t, r) => t + Math.max(0, (Number(r.api_tokens_original) || 0) - (Number(r.api_tokens_rewrite) || 0)), 0);
  const cost = sum(ok, "review_cost_in") + sum(ok, "review_cost_out");
  const scored = changed.filter((r) => r.task_score_original !== "" && r.task_score_rewrite !== "");
  const worse = scored.filter((r) => Number(r.task_score_rewrite) < Number(r.task_score_original)).length;
  const equalOrBetter = scored.length - worse;
  const chkO = sum(changed, "checks_passed_original");
  const chkR = sum(changed, "checks_passed_rewrite");
  const chkT = sum(changed, "checks_total");
  const rejectCases = ok.filter((r) => r.reject_is_best);
  const faultCounts = ok.reduce((acc, r) => {
    if (r.fault) acc[r.fault] = (acc[r.fault] || 0) + 1;
    return acc;
  }, {});
  const hallucinationCount = ok.filter((r) => (r.answer_hallucination && r.answer_hallucination !== "none") || r.fault === "answer hallucination").length;
  const faultDetails = Object.entries(faultCounts).map(([k, v]) => `${k}: ${v}`).join(", ") || "none logged";
  const lines = [
    `Cases run: ${ok.length} of ${rows.length}. Rewrite changed the prompt in ${changed.length}; left it alone in ${ok.length - changed.length}.`,
    `Prompt tokens saved (API counts, changed cases): ${saved}. Tokens spent on the rewrite requests: ${cost}. Net: ${saved - cost}.`,
    `Automatic answer checks passed, changed cases: original ${chkO}/${chkT}, rewrite ${chkR}/${chkT}.`,
    `Rater scores so far: ${scored.length} changed cases scored. Rewrite answer as good or better in ${equalOrBetter}, worse in ${worse}.`,
    `Rejecting was the best outcome in ${rejectCases.length} case(s): the default selection left the prompt alone in ${rejectCases.filter((r) => r.reject_outcome_ok).length}.`,
    `Fault attribution: ${faultDetails}. Answer hallucinations logged: ${hallucinationCount} (marked separately from rewrite faults).`,
    `Edits left out by default because of model or check risk: ${sum(ok, "edits_proposed") - sum(ok, "edits_selected") - sum(ok, "dropped_protected") - sum(ok, "dropped_unmatched") - sum(ok, "dropped_invalid")}. Saving if everything were included instead (estimate, mean): ${Math.round(sum(ok, "est_saved_pct_all_changes") / ok.length)}% versus ${Math.round(sum(ok, "est_saved_pct_default") / ok.length)}% by default.`
  ];
  box.replaceChildren(...lines.map((t) => Object.assign(document.createElement("div"), { textContent: t })));
  box.hidden = false;
}

$("run").addEventListener("click", async () => {
  $("run").disabled = true;
  $("export").disabled = true;
  const cases = await (await fetch("cases.json")).json();
  rows = [];
  for (let i = 0; i < cases.length; i++) {
    $("progress").textContent = `Running ${i + 1} of ${cases.length}…`;
    rows.push(await runCase(cases[i]));
    render();
    await sleep(400);
  }
  const first = rows.find((r) => r.prompt_version);
  $("runinfo").textContent = first ? `Prompt version ${first.prompt_version}, model ${first.model}, level ${first.level}, run at ${first.run_ts}` : "";
  $("progress").textContent = "Done. Score the answers (A and B are in random order), then export.";
  $("run").disabled = false;
  $("export").disabled = false;
});

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

$("export").addEventListener("click", () => {
  rows.forEach(derive);
  const lines = [COLS.join(",")].concat(rows.map((r) => COLS.map((c) => csvCell(r[c])).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = `harness-${rows.find((r) => r.prompt_version)?.prompt_version || "run"}-${Date.now()}.csv`;
  a.click();
});
