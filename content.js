// Prompt Review: content script.
// System boundary: the model proposes text, this script displays it, the user decides.
// Nothing is written to the chat box without a click on Accept, and never over text the user changed since the review began.
(() => {
  if (window.__promptReviewLoaded) return;
  window.__promptReviewLoaded = true;
  const PR = globalThis.PR;
  const TIER = PR.tierFor(location.hostname); // "tested" or "best_effort"
  const SEL = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], div[role="textbox"]';

  /* ---------- find, read and write the chat box ---------- */
  let lastEditable = null;

  function editHost(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search)?$/.test(el.type))) return el;
    if (!el.isContentEditable) return null;
    let h = el;
    while (h.parentElement && h.parentElement.isContentEditable) h = h.parentElement;
    return h;
  }
  document.addEventListener(
    "focusin",
    (e) => {
      const h = editHost(e.composedPath()[0]);
      if (h) lastEditable = h;
    },
    true
  );

  function visible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  }

  // Tested sites: the box the user last clicked, else the lowest text box. Any other site: only the box the user
  // has clicked into. The extension does not guess there, because a wrong guess edits the wrong field.
  function resolveTarget() {
    if (lastEditable && document.contains(lastEditable) && visible(lastEditable)) return { el: lastEditable, method: "focused" };
    if (TIER === "tested") {
      const c = [...document.querySelectorAll(SEL)].filter(visible);
      c.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      if (c[0]) return { el: c[0], method: "heuristic" };
    }
    return { el: null, method: "none" };
  }

  const readText = (el) => (el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value : el.innerText);
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  // innerText can differ slightly between reads on rich editors, so compare exactly first, then ignoring whitespace runs.
  const same = (a, b) => a === b || squash(a) === squash(b);

  // Returns "exact", "approx" (the site changed whitespace or line breaks) or null (the box did not take it).
  function writeText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const sel = getSelection();
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand("insertText", false, text);
    }
    const now = readText(el);
    if (now === text) return "exact";
    return squash(now) === squash(text) ? "approx" : null;
  }

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  }

  /* ---------- styles (shadow DOM so site CSS cannot interfere) ---------- */
  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  [hidden]{display:none!important}
  :host{--bg:#fff;--fg:#1c2330;--muted:#5d6678;--line:#d9dee7;--soft:#f3f5f9;--del:#fde8e8;--delfg:#b42323;--ins:#e3f6e8;--insfg:#14703a;--warn:#a15c00;--accent:#1f4fd8;--accentfg:#fff}
  @media (prefers-color-scheme:dark){:host{--bg:#1d2129;--fg:#e8ecf3;--muted:#9aa4b6;--line:#343b49;--soft:#262b35;--del:#4a2326;--delfg:#ff9a9a;--ins:#1c3d2a;--insfg:#8fe0ad;--warn:#f2b45a;--accent:#7ea2ff;--accentfg:#0d1220}}
  .launcher{position:fixed;right:20px;bottom:96px;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);opacity:.85}
  .launcher:hover,.launcher:focus-visible{opacity:1;outline:2px solid var(--accent)}
  .panel{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);width:min(680px,94vw);max-height:82vh;overflow:auto;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:16px 18px;font-size:14px;line-height:1.5;outline:none}
  .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
  .top b{font-size:15px}
  .top span{color:var(--muted);font-size:12px;margin-left:8px}
  .x{border:0;background:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1}
  .status{font-size:13px;font-weight:600;margin-bottom:10px}
  .box{background:var(--soft);border-left:3px solid var(--warn);padding:7px 10px;border-radius:4px;margin-bottom:10px;font-size:13px}
  .box .actions{margin-top:6px}
  .intent{background:var(--soft);border-radius:8px;padding:9px 12px;margin-bottom:12px}
  .intent .lbl{color:var(--muted);font-size:12px}
  .fb{display:flex;gap:8px;margin-top:6px}
  .fb button{font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
  .fb button[aria-pressed=true]{background:var(--accent);color:var(--accentfg);border-color:var(--accent)}
  .links{display:flex;gap:14px;margin-bottom:6px}
  .link{border:0;background:none;color:var(--accent);font-size:12px;cursor:pointer;padding:0;text-decoration:underline}
  .diff{white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);border-radius:8px;padding:12px;max-height:34vh;overflow:auto;line-height:1.9}
  .edit{cursor:pointer;border-radius:4px;padding:1px 0}
  .edit:focus-visible{outline:2px solid var(--accent)}
  .edit del{background:var(--del);color:var(--delfg);text-decoration:line-through}
  .edit ins{background:var(--ins);color:var(--insfg);text-decoration:none;margin-left:3px}
  .edit.risk-medium.on,.edit.risk-high.on{outline:1px solid var(--warn);outline-offset:1px}
  .edit.off .kept{border-bottom:2px dashed var(--muted)}
  .edit.risk-high.off .kept{border-bottom-color:var(--warn)}
  .warn{color:var(--warn);font-size:11px;margin-left:2px}
  .detail{min-height:22px;margin:8px 0;color:var(--muted);font-size:13px}
  .editbox{width:100%;min-height:130px;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--bg);color:var(--fg);font-size:14px;line-height:1.5;resize:vertical}
  .meter{margin:8px 0 12px}
  .meter .row{display:flex;justify-content:space-between;font-size:13px}
  .bar{height:6px;border-radius:3px;background:var(--soft);margin-top:5px;overflow:hidden}
  .bar i{display:block;height:100%;background:var(--accent);transition:width .15s}
  .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .actions .sp{flex:1}
  button.btn{font-size:13px;padding:7px 12px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
  button.btn:disabled{opacity:.45;cursor:not-allowed}
  button.btn.primary{background:var(--accent);color:var(--accentfg);border-color:var(--accent);font-weight:600}
  button.btn.quiet{border-color:transparent;color:var(--muted)}
  button.btn:focus-visible,.link:focus-visible,.x:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  details.note{color:var(--muted);font-size:12px;margin-top:10px}
  details.note p{margin:6px 0 0}
  .err{color:var(--delfg)}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;gap:12px;align-items:center;max-width:94vw;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:13px;box-shadow:0 8px 28px rgba(0,0,0,.25)}
  @media (prefers-reduced-motion:reduce){.bar i{transition:none}}
  `;

  const host = document.createElement("div");
  host.id = "prompt-review-host";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.append(h("style", {}, CSS));
  root.append(h("button", { class: "launcher", title: "Ask for a shorter version of your prompt (Alt+Shift+R)", onclick: () => startReview(false) }, "Suggest rewrite"));
  document.documentElement.append(host);

  /* ---------- panel plumbing ---------- */
  let panel = null;
  let toast = null;
  let toastTimer = null;
  let state = null;
  const ui = { refreshStale: null };

  function onEsc(e) {
    if (e.key === "Escape") closePanel();
  }
  function unwatch(s) {
    if (s && s.input && s.onInput) s.input.removeEventListener("input", s.onInput);
  }
  function closePanel() {
    if (state && !state.logged) log("dismissed");
    unwatch(state);
    document.removeEventListener("keydown", onEsc, true);
    panel?.remove();
    panel = null;
    ui.refreshStale = null;
    state?.input?.focus?.();
  }
  function openPanel(...kids) {
    panel?.remove();
    panel = h("section", { class: "panel", role: "dialog", "aria-label": "Suggested rewrite", tabindex: "-1" });
    panel.append(
      h("div", { class: "top" }, h("div", {}, h("b", {}, "Suggested rewrite"), h("span", {}, "You decide. Nothing is sent.")), h("button", { class: "x", "aria-label": "Close", onclick: () => closePanel() }, "×")),
      ...kids.flat().filter(Boolean)
    );
    root.append(panel);
    panel.focus({ preventScroll: true });
    document.addEventListener("keydown", onEsc, true);
  }
  function showMessage(text, isError, extra) {
    openPanel(
      h("p", { class: isError ? "err" : "", role: "status" }, text),
      h("div", { class: "actions" }, [].concat(extra || []), h("span", { class: "sp" }), h("button", { class: "btn", onclick: () => closePanel() }, "Close"))
    );
  }
  function showToast(text, label, onAction, ms) {
    toast?.remove();
    clearTimeout(toastTimer);
    toast = h("div", { class: "toast", role: "status" }, text, label ? h("button", { class: "btn", onclick: onAction }, label) : null);
    root.append(toast);
    toastTimer = setTimeout(() => toast?.remove(), ms);
  }
  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {});

  /* ---------- trace: enough to explain a failure, no prompt text unless the user opted in ---------- */
  function log(decision) {
    const s = state;
    if (!s || s.logged) return;
    s.logged = true;
    const applied = decision === "accepted" || decision === "edited";
    const before = PR.estTokens(s.original);
    const entry = {
      trace_id: s.traceId,
      ts: Date.now(),
      host: location.hostname,
      site_tier: TIER,
      target_method: s.targetMethod,
      decision,
      outcome: s.edits.length ? "ok" : "no_edits",
      prompt_version: s.meta.prompt_version,
      model: s.meta.model,
      level: s.meta.level,
      tokens_before: before,
      tokens_proposed: PR.estTokens(PR.resultText(s.original, s.edits)),
      tokens_after: applied ? PR.estTokens(s.finalText) : before,
      review_cost_in: s.meta.usage?.input ?? "",
      review_cost_out: s.meta.usage?.output ?? "",
      edits_proposed: s.proposed,
      edits_total: s.edits.length,
      edits_accepted: s.edits.filter((e) => e.accepted).length,
      edits_flagged_by_check: s.edits.filter((e) => e.flags.length).length, // found by the basic check, not the model
      dropped_unmatched: s.unmatched,
      dropped_protected: s.skipped,
      dropped_invalid: s.meta.invalid_dropped,
      schema_ok: s.meta.schema_ok,
      clarity: s.clarity, // "unclear" points at the original request rather than the rewrite
      write_back: s.writeBack || "",
      review_ms: Date.now() - s.openedAt,
      intent_feedback: s.intentFeedback,
      edits: s.edits.map((e) => ({ type: e.type, model_risk: e.modelRisk, check: e.flags.map((f) => f.kind), accepted: e.accepted })),
      text_before: s.original, // removed by the background worker unless the user opted in
      text_after: applied ? s.finalText : ""
    };
    try {
      chrome.runtime.sendMessage({ type: "log", entry });
    } catch {
      /* extension was reloaded; ignore */
    }
  }
  const patchLog = (patch) => {
    try {
      chrome.runtime.sendMessage({ type: "log_patch", trace_id: state?.traceId, patch });
    } catch {
      /* ignore */
    }
  };

  /* ---------- protecting the user's newer text ---------- */
  const inputUnchanged = (s) => !!s.input && document.contains(s.input) && same(readText(s.input), s.original);

  function watchInput(s) {
    s.onInput = () => {
      s.stale = !inputUnchanged(s);
      ui.refreshStale?.();
    };
    s.input.addEventListener("input", s.onInput);
  }

  function showConflict(s, out) {
    log("blocked_changed");
    showMessage(
      "Your prompt changed while this review was open, so nothing was replaced and your newer text is safe.",
      false,
      [h("button", { class: "btn", onclick: () => copy(out) }, "Copy the rewrite"), h("button", { class: "btn", onclick: () => startReview(false) }, "Suggest again")]
    );
  }

  /* ---------- decisions ---------- */
  function keepOriginal() {
    log("kept_original");
    closePanel();
  }

  function accept() {
    const s = state;
    const auto = PR.resultText(s.original, s.edits);
    const out = s.mode === "edit" ? s.manualText ?? auto : auto;
    s.finalText = out;
    if (PR.validateMustKeeps) {
      const mk = PR.validateMustKeeps(s.original, out);
      if (!mk.passed && mk.missing.length > 0) {
        showMessage(
          `Cannot accept rewrite: the following required must-keep details would be lost: ${mk.missing.map((x) => `“${x}”`).join(", ")}. Please include the necessary changes or use Edit to restore them.`,
          true
        );
        return;
      }
    }
    if (!inputUnchanged(s)) return showConflict(s, out); // re-check at the moment of writing, not only while watching
    unwatch(s);
    const input = s.input;
    const result = writeText(input, out);
    s.writeBack = result || "failed";
    if (!result) {
      const restored = writeText(input, s.original); // do not leave a half-written box behind
      log("write_failed");
      copy(out);
      return showMessage(
        `This site's text box did not accept the change cleanly. ${restored ? "Your original was put back" : "Check the box"} and the rewrite was copied, so you can paste it if you want it.`,
        true
      );
    }
    s.afterWrite = readText(input);
    log(s.mode === "edit" && out !== auto ? "edited" : "accepted");
    closePanel();
    const original = s.original;
    const written = s.afterWrite;
    showToast(
      result === "approx" ? "Prompt replaced. This site may have changed line breaks, so check the box." : "Prompt replaced.",
      "Undo",
      () => {
        // Undo only if the box still holds what we wrote; otherwise a newer draft could be lost.
        if (!document.contains(input) || !same(readText(input), written)) {
          patchLog({ undo: "blocked" });
          return showToast("You have changed the prompt since, so Undo was skipped to protect your newer text.", "Copy original", () => copy(original), 10000);
        }
        const restored = writeText(input, original);
        if (!restored) copy(original);
        patchLog(restored ? { decision: "undone" } : { undo: "failed" });
        showToast(restored ? "Original restored." : "Could not restore it in the box. The original was copied, so paste it in.", null, null, 5000);
      },
      30000
    );
  }

  /* ---------- the review panel ---------- */
  function showReview() {
    const s = state;
    const editing = s.mode === "edit";
    const auto = () => PR.resultText(s.original, s.edits);
    const current = () => (editing ? s.manualText ?? auto() : auto());
    const tokens = h("span");
    const saved = h("span");
    const bar = h("i");
    const warnbox = h("div", { class: "box", role: "status", hidden: true });
    const diff = h("div", { class: "diff", "aria-label": "Your prompt with suggested changes" });
    const detail = h("div", { class: "detail", "aria-live": "polite" }, "Red is removed, green is added. Click a change to include it or leave it out.");
    const acceptBtn = h("button", { class: "btn primary", title: "Put this prompt in the chat box. Nothing is sent.", onclick: accept }, editing ? "Accept edited prompt" : "Accept rewrite");
    const stale = h(
      "div",
      { class: "box", role: "alert", hidden: !s.stale },
      "Your prompt changed after this suggestion was made. Accept is turned off so your newer text is not overwritten.",
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => startReview(false) }, "Suggest again"))
    );
    ui.refreshStale = () => {
      stale.hidden = !s.stale;
      acceptBtn.disabled = s.stale;
    };

    function meter() {
      const before = PR.estTokens(s.original);
      const result = current();
      const after = PR.estTokens(result);
      const pct = before ? Math.round(((before - after) / before) * 100) : 0;
      tokens.textContent = `≈ ${before} → ≈ ${after} tokens`;
      saved.textContent = pct > 0 ? `${pct}% shorter` : pct < 0 ? `${-pct}% longer` : "no saving";
      bar.style.width = `${before ? Math.min(100, (after / before) * 100) : 100}%`;
      const w = result === s.original ? [] : PR.promptChecks(s.original, result);
      warnbox.hidden = !w.length;
      warnbox.textContent = w.length ? `Check before accepting: ${w.join(" ")}` : "";
    }

    function editNode(e) {
      const toggle = () => {
        e.accepted = !e.accepted;
        renderDiff();
      };
      const show = () => {
        const check = e.flags.length ? `Basic check: ${e.flags.map((f) => f.text).join("; ")}.` : "Basic check: found nothing.";
        detail.textContent = `${e.reason} Model: ${e.modelRisk} risk. ${check} Click to ${e.accepted ? "leave it out" : "include it"}.`;
      };
      const who = e.modelRisk !== "low" && e.flags.length ? "Flagged by the model and the basic check" : e.flags.length ? "Flagged by the basic check" : "Flagged by the model";
      return h(
        "span",
        {
          class: `edit ${e.accepted ? "on" : "off"} risk-${e.risk}`,
          tabindex: "0",
          role: "button",
          "aria-pressed": String(e.accepted),
          onclick: toggle,
          onkeydown: (k) => {
            if (k.key === "Enter" || k.key === " ") {
              k.preventDefault();
              toggle();
            }
          },
          onmouseenter: show,
          onfocus: show
        },
        e.accepted ? [h("del", {}, e.original), e.replacement ? h("ins", {}, e.replacement) : null] : h("span", { class: "kept" }, e.original),
        e.risk !== "low" ? h("sup", { class: "warn", title: who }, "⚠") : null
      );
    }

    function renderDiff() {
      diff.replaceChildren();
      let pos = 0;
      for (const e of s.edits) {
        if (e.start > pos) diff.append(s.original.slice(pos, e.start));
        diff.append(editNode(e));
        pos = e.end;
      }
      if (pos < s.original.length) diff.append(s.original.slice(pos));
      meter();
    }

    const setAll = (v) => {
      s.edits.forEach((e) => (e.accepted = v));
      renderDiff();
    };

    const fb = (label, val) =>
      h(
        "button",
        {
          "aria-pressed": String(s.intentFeedback === val),
          onclick: (ev) => {
            const me = ev.currentTarget;
            s.intentFeedback = val;
            me.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === me)));
            if (val === "mismatch" && !editing && s.edits.length) {
              setAll(false); // a rewrite that misreads the request is not applied by default
              detail.textContent = "All changes left out. Include any you still want, or use Edit.";
            }
          }
        },
        label
      );

    const n = s.edits.length;
    const left = n - s.preSelected;
    const children = [
      h("div", { class: "status", role: "status" }, n ? `Suggestion ready: ${n} change${n === 1 ? "" : "s"}, ${s.preSelected} selected${left ? `, ${left} left out to check` : ""}` : "No rewrite suggested"),
      s.clarity === "unclear" ? h("div", { class: "box" }, `Your prompt may be unclear: ${s.clarityNote || "something important may be missing."}`) : null,
      h("div", { class: "intent" }, h("div", { class: "lbl" }, "What the chatbot will understand"), h("div", {}, s.intent || "No summary returned."), h("div", { class: "fb" }, fb("Matches what I meant", "match"), fb("Not quite", "mismatch")))
    ];

    if (!n) {
      const why = s.proposed
        ? `The model suggested ${s.proposed} change${s.proposed === 1 ? "" : "s"}, but none could be applied safely (${s.skipped} inside code, tables or quotes, ${s.unmatched} not found in your text).`
        : `The model found no safe cut${s.noChangeReason ? `: ${s.noChangeReason}` : "."}`;
      children.push(
        h("p", {}, `${why} That does not mean your prompt is perfect. It only means no safe change was found.`),
        h("div", { class: "actions" }, h("span", { class: "sp" }), h("button", { class: "btn primary", onclick: () => closePanel() }, "Close"))
      );
    } else {
      children.push(stale, warnbox);
      if (editing) {
        const box = h("textarea", { class: "editbox", "aria-label": "Edit the final prompt" });
        box.value = s.manualText ?? auto();
        box.addEventListener("input", () => {
          s.manualText = box.value;
          meter();
        });
        children.push(box);
      } else {
        children.push(
          h("div", { class: "links" }, h("button", { class: "link", onclick: () => setAll(true) }, "Include all changes"), h("button", { class: "link", onclick: () => setAll(false) }, "Leave all out")),
          diff,
          detail
        );
      }
      children.push(
        h("div", { class: "meter" }, h("div", { class: "row" }, tokens, saved), h("div", { class: "bar" }, bar)),
        h(
          "div",
          { class: "actions" },
          h("button", { class: "btn quiet", title: "Close and leave your prompt as it is", onclick: keepOriginal }, "Keep original"),
          h("span", { class: "sp" }),
          editing
            ? h("button", { class: "btn", title: "Go back to the list of changes", onclick: () => { s.mode = "changes"; s.manualText = null; showReview(); } }, "Back to changes")
            : h("button", { class: "btn", title: "Change the rewrite by hand before using it", onclick: () => { s.mode = "edit"; showReview(); } }, "Edit"),
          acceptBtn
        )
      );
    }
    children.push(
      h(
        "details",
        { class: "note" },
        h("summary", {}, "About this suggestion"),
        h("p", {}, "Changes start selected only when both the model and a basic automatic check rate them low risk. The check only looks for dropped numbers, quotes, code, links and names, fewer words like not or only, changed line breaks, a lost question mark, and reordered key words. It cannot tell whether the meaning changed, so read the result before you accept."),
        h("p", {}, "Your draft was sent to the NVIDIA NIM API to make this suggestion. Token counts are estimates."),
        TIER === "best_effort" ? h("p", {}, "This site is not in the tested list. If the box does not update properly, copy the rewrite and paste it in.") : null,
        s.meta.store_text ? h("p", {}, "Prompt text is being saved to your study log in this browser.") : null
      )
    );
    openPanel(...children);
    ui.refreshStale?.();
    if (n) {
      if (editing) meter();
      else renderDiff();
    }
  }

  /* ---------- run a review ---------- */
  async function startReview(force) {
    if (state && !state.logged) log("dismissed");
    unwatch(state);
    const target = resolveTarget();
    if (!target.el) {
      return showMessage(
        TIER === "tested"
          ? "Click into your prompt box first, then choose Suggest rewrite."
          : "Click inside your prompt box first, then choose Suggest rewrite again. This site is not in the tested list, so the extension will not guess which box to use."
      );
    }
    const input = target.el;
    const raw = readText(input); // kept exactly as typed, so untouched text can be preserved
    if (!raw.trim()) return showMessage("Your prompt box is empty. Type your prompt, then choose Suggest rewrite.");
    const t = PR.estTokens(raw);
    if (!force && t < PR.MIN_TOKENS) {
      return showMessage(
        `This prompt is short (about ${t} tokens). A review would likely cost more than it saves, so nothing was sent.`,
        false,
        h("button", { class: "btn", onclick: () => startReview(true) }, "Suggest anyway")
      );
    }
    openPanel(h("p", { role: "status" }, "Working on a suggestion…"), h("p", { class: "detail" }, "Your draft is being sent to the NVIDIA NIM API."));
    const mine = panel;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "optimise", text: raw });
    } catch {
      if (panel === mine) showMessage("The extension was updated. Refresh this page and try again.", true);
      return;
    }
    if (panel !== mine) return; // the user closed the panel while waiting
    if (!res || !res.ok) return showMessage(res?.error || "Something went wrong.", true);
    const located = PR.locate(raw, res.data.edits);
    state = {
      traceId: crypto.randomUUID().slice(0, 8),
      original: raw,
      edits: located.edits,
      unmatched: located.unmatched,
      skipped: located.skippedProtected,
      proposed: res.data.edits.length,
      preSelected: located.edits.filter((e) => e.accepted).length,
      intent: res.data.intent_summary,
      clarity: res.data.clarity,
      clarityNote: res.data.clarity_note,
      noChangeReason: res.data.no_change_reason,
      meta: res.meta,
      input,
      targetMethod: target.method,
      mode: "changes",
      manualText: null,
      openedAt: Date.now(),
      intentFeedback: "",
      logged: false,
      stale: false
    };
    watchInput(state);
    if (!inputUnchanged(state)) state.stale = true; // changed while waiting for the model
    showReview();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "review") startReview(false);
  });
})();
