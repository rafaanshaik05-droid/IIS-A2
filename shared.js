// Logic shared by the content script, the background worker, the test harness and the unit tests.
// Nothing here calls a model or touches the page. Nothing here may contain test-case text or answers:
// the product must behave the same on any prompt, or the evaluation proves nothing.
(() => {
  const MIN_TOKENS = 40; // below this a review costs more than it can save

  // Hosts verified with SITE_TESTS.md. Add a host here, and to the README table, only after it passes.
  // On any other site the extension edits only the box the user has clicked into.
  const TESTED_HOSTS = ["https://chatgpt.com/"];
  const tierFor = (host) => (TESTED_HOSTS.some((h) => host === h || host.endsWith("." + h)) ? "tested" : "best_effort");

  const estTokens = (s) => Math.ceil(s.length / 4); // rough: about 4 characters per token
  const RANK = { low: 0, medium: 1, high: 2 };
  const count = (s, re) => (s.match(re) || []).length;
  const quoteList = (a) => [...new Set(a)].slice(0, 3).map((x) => `“${x}”`).join(", ");

  /* ---------- dates: recognise equivalent styles and keep the author's own ---------- */
  // Covers named-month dates ("9 July", "9th of July", "July 9th", "July 9, 2031"). Numeric dates such as
  // 03/04/2026 are ambiguous between day-first and month-first, so they are treated as plain literals, never rewritten.
  const MONTHS = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
    july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
  };
  const MONTH_PAT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  const DM_SRC = `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PAT})\\b(?:,?\\s+(\\d{4})\\b)?`;
  const MD_SRC = `\\b(${MONTH_PAT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`;

  function extractDates(text) {
    if (typeof text !== "string" || !text) return [];
    const found = [];
    const add = (m, di, mi, yi, format) => {
      if (m[mi] === "may") return; // lowercase "may" is almost always the verb
      const day = +m[di];
      if (day < 1 || day > 31) return;
      found.push({ raw: m[0], day, month: MONTHS[m[mi].toLowerCase()], year: m[yi] ? +m[yi] : null, index: m.index, end: m.index + m[0].length, format });
    };
    let m;
    const dm = new RegExp(DM_SRC, "gi");
    while ((m = dm.exec(text))) add(m, 1, 2, 3, "DM");
    const md = new RegExp(MD_SRC, "gi");
    while ((m = md.exec(text))) add(m, 2, 1, 3, "MD");
    found.sort((a, b) => a.index - b.index || b.end - a.end);
    const out = [];
    let last = -1;
    for (const d of found) {
      if (d.index >= last) {
        out.push(d);
        last = d.end;
      }
    }
    return out;
  }
  const sameDate = (a, b) => a.day === b.day && a.month === b.month && a.year === b.year;

  // If the replacement writes a date from the original in another style, put the original's style back.
  // Returns the changes so the interface can show them. Indices are handled from the end so earlier edits cannot shift later ones.
  function normalizeDates(replacement, original) {
    const od = extractDates(original);
    if (!od.length || !replacement) return { text: replacement, changes: [] };
    const rd = extractDates(replacement);
    let text = replacement;
    const changes = [];
    for (let i = rd.length - 1; i >= 0; i--) {
      const o = od.find((x) => sameDate(x, rd[i]));
      if (o && o.raw !== rd[i].raw) {
        text = text.slice(0, rd[i].index) + o.raw + text.slice(rd[i].end);
        changes.push({ from: rd[i].raw, to: o.raw });
      }
    }
    return { text, changes: changes.reverse() };
  }
  const normalizeDateInText = (replacement, original) => normalizeDates(replacement, original).text;

  /* ---------- the basic check (a warning, not a semantic safeguard) ---------- */
  // It looks for: dropped numbers, dates, quotes, code, links and names; fewer negation or limit words;
  // changed line breaks; a lost question mark; reordered key words; text repeated elsewhere.
  // It cannot tell whether the meaning changed. Reading the result stays the user's job.
  const A = "['’]?";
  const NEG = `do not|does not|did not|don${A}t|doesn${A}t|didn${A}t|can${A}t|cannot|can not|won${A}t|shouldn${A}t|should not|isn${A}t|is not|not|no|never|without|nothing|none`;
  const LIM = "only|must|at least|at most|exactly|except|instead|always|avoid|maximum|minimum|fewer than|less than|more than|under|over|within|before|after|below|above";
  const WORD_RE = new RegExp(`\\b(?:${NEG}|${LIM})\\b`, "gi");
  const SEQ_RE = new RegExp(`\\b(?:${NEG}|${LIM})\\b|\\d[\\d.,]*`, "gi");
  const NEG_RE = new RegExp(`^(?:${NEG})$`, "i");
  const canon = (w) => (NEG_RE.test(w) ? "not" : w.toLowerCase().replace(/\s+/g, " "));
  const constraintTokens = (s) => (s.match(WORD_RE) || []).map(canon);
  const tally = (arr) => arr.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
  const fewerWords = (before, after) => {
    const ot = tally(constraintTokens(before));
    const rt = tally(constraintTokens(after));
    return [...ot].filter(([k, n]) => (rt.get(k) || 0) < n).map(([k]) => k);
  };

  const LIT_RES = [/https?:\/\/[^\s)]+/g, /`[^`\n]+`/g, /"[^"\n]+"|“[^”\n]+”/g, /\d[\d.,:%/-]*/g];
  const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr)\.$/;

  // Capitalised words that are not at the start of a sentence are treated as names.
  function names(text, from = 0) {
    const out = [];
    const re = /\b[A-Z][\w'’-]*/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index < from || /^I(?:['’]|$)/.test(m[0])) continue;
      const prev = text.slice(0, m.index).replace(/[ \t]+$/, "");
      if (!prev || (/[.!?:\n"“(\[]$/.test(prev) && !ABBREV.test(prev))) continue;
      out.push(m[0]);
    }
    return out;
  }

  // Dates are handled as dates (any style counts as kept), so their day number and month name are not also listed separately.
  const maskDates = (text) => extractDates(text).reduceRight((acc, d) => acc.slice(0, d.index) + " ".repeat(d.end - d.index) + acc.slice(d.end), text);

  function literals(text) {
    const masked = maskDates(text);
    const out = [];
    LIT_RES.forEach((re, i) => {
      for (const m of (i === 3 ? masked : text).match(re) || []) {
        const lit = m.replace(/[.,:/-]+$/, "");
        if (lit) out.push(lit);
      }
    });
    return out.concat(names(masked));
  }

  function editFlags(original, replacement, before) {
    const flags = [];
    const rep = replacement.toLowerCase();
    const lost = [];
    const ods = extractDates(original);
    const rds = extractDates(replacement);
    for (const d of ods) if (!rds.some((r) => sameDate(d, r))) lost.push(d.raw);
    const inDate = (lit) => ods.some((d) => d.raw.toLowerCase().includes(lit.toLowerCase()));
    for (const re of LIT_RES) for (const m of original.match(re) || []) {
      const lit = m.replace(/[.,:/-]+$/, "");
      if (lit && !rep.includes(lit.toLowerCase()) && !inDate(lit)) lost.push(lit);
    }
    for (const n of names(before + original, before.length)) if (!rep.includes(n.toLowerCase()) && !inDate(n)) lost.push(n);
    if (lost.length) flags.push({ kind: "dropped", severity: "high", text: `removes ${quoteList(lost)}` });

    const fewer = fewerWords(original, replacement);
    if (fewer.length) flags.push({ kind: "constraint", severity: "high", text: `removes ${quoteList(fewer)}` });

    if (count(original, /\n/g) !== count(replacement, /\n/g)) flags.push({ kind: "structure", severity: "high", text: "changes line breaks" });

    const a = (original.match(SEQ_RE) || []).map(canon);
    const b = (replacement.match(SEQ_RE) || []).map(canon);
    const ca = a.filter((x) => b.includes(x));
    const cb = b.filter((x) => a.includes(x));
    if (ca.length > 1 && ca.join("|") !== cb.join("|")) flags.push({ kind: "reordered", severity: "medium", text: "reorders key words" });

    if (count(original, /\?/g) > count(replacement, /\?/g)) flags.push({ kind: "punctuation", severity: "medium", text: "removes a question mark" });
    return flags;
  }

  const structureSig = (t) =>
    [count(t, /\n/g), count(t, /^\s*(?:[-*•]|\d+[.)])\s/gm), count(t, /```/g), count(t, /^[ \t]*\|.*$/gm), count(t, /^[ \t]+\S/gm)].join("|");

  /* ---------- must-keeps: derived from the user's own prompt, never from test data ---------- */
  // A date counts as kept if the result has the same date in any style, so "3 March" survives as "March 3".
  function containsTarget(text, target) {
    if (!text || !target) return false;
    if (text.toLowerCase().includes(target.toLowerCase())) return true;
    const td = extractDates(target);
    if (!td.length) return false;
    const xd = extractDates(text);
    if (!td.every((t) => xd.some((x) => sameDate(t, x)))) return false;
    const mask = (s, ds) => ds.reduceRight((acc, d) => acc.slice(0, d.index) + "\u0001" + acc.slice(d.end), s);
    return mask(text, xd).toLowerCase().includes(mask(target, td).trim().toLowerCase());
  }

  const mustKeeps = (prompt) => [...new Set([...literals(prompt), ...extractDates(prompt).map((d) => d.raw)])];

  // `extra` is for the harness only: strings a test case says must survive. The extension passes none.
  function validateMustKeeps(prompt, result, extra = []) {
    const items = [...new Set([...mustKeeps(prompt), ...extra])];
    const missing = items.filter((k) => !containsTarget(result, k));
    const fewer = fewerWords(prompt, result);
    return { mustKeeps: items, missing, fewer, passed: !missing.length && !fewer.length };
  }

  // Whole-prompt warnings for the selection the user is about to accept.
  function promptChecks(original, result) {
    const w = [];
    const v = validateMustKeeps(original, result);
    if (v.fewer.length) w.push(`Fewer ${quoteList(v.fewer)} words than in your original.`);
    if (v.missing.length) w.push(`Not in the result: ${quoteList(v.missing)}.`);
    if (structureSig(original) !== structureSig(result)) w.push("Line breaks, lists, code fences, tables or indentation changed.");
    return w;
  }

  /* ---------- clarity: rules decide when they can; otherwise the model's view is kept and labelled as the model's ---------- */
  // The extension sees only this message, not the chat. A follow-up such as "make it shorter" is fine in an ongoing
  // chat, so the rules say what is missing from THIS message and do not claim the user made a mistake.
  function classifyClarity(text) {
    const t = (text || "").trim();
    const unclear = (note) => ({ clarity: "unclear", note, decided: true });
    if (!t) return unclear("The prompt box is empty.");
    const words = t.match(/\S+/g) || [];
    const colonBody = t.includes(":") ? t.slice(t.indexOf(":") + 1).trim().length : 0;
    const hasContent = /```|`[^`\n]+`/.test(t) || /["“][^"”\n]{8,}["”]/.test(t) || colonBody > 30 || /\n\s*\n[\s\S]{30,}/.test(t);
    const missingText = "It refers to text that is not in this message. That is fine if it follows an earlier message in the chat.";
    const ACT = "make|fix|improve|rewrite|summari[sz]e|explain|check|edit|translate|review|correct|rephrase|polish|shorten|expand|proofread";

    // "Fix this" at the start of a message points at something that is not there. In the middle of a longer request
    // ("... and please make it rhyme") the pronoun usually points at something the message itself describes.
    const lead = new RegExp(`^(?:please\\s+|can you\\s+|could you\\s+|can you please\\s+|could you please\\s+)?(?:${ACT})\\s+(?:it|this|that|these|those|them)\\b`, "i");
    const anywhere = new RegExp(`\\b(?:${ACT})\\s+(?:it|this|that|these|those|them)\\b`, "i");
    if (!hasContent && (lead.test(t) || (anywhere.test(t) && words.length < 10))) return unclear(missingText);
    if (/\b(?:the following|as follows|below|attached)\s*:?\s*$/i.test(t)) return unclear("It refers to text that should follow, but nothing follows.");
    if (new RegExp(`\\b(?:${ACT})\\s+the\\s+following\\s+(?:paragraph|text|code|table|section|document|email|essay)\\b`, "i").test(t) && !hasContent) {
      return unclear("It refers to text that should follow, but nothing follows.");
    }
    if (words.length <= 8 && /^(?:please\s+)?(?:make it|make this|fix it|fix this|improve it|improve this|help me with this|help)\b/i.test(t)) return unclear("The request does not say what to work on.");
    const core = t.replace(/\b(?:please|thanks|thank you|hi|hello|hey|ok|okay|ty)\b/gi, "").match(/\w+/g) || [];
    if (core.length < 2) return unclear("No request found, only a greeting or thanks.");
    return { clarity: "unknown", note: "", decided: false };
  }

  /* ---------- protected regions: edits touching these are ignored ---------- */
  function protectedRanges(text) {
    const r = [];
    const add = (re) => {
      let m;
      while ((m = re.exec(text))) r.push([m.index, m.index + m[0].length]);
    };
    add(/```[\s\S]*?(?:```|$)/g); // fenced code, even if unterminated
    add(/`[^`\n]+`/g); // inline code
    add(/"[^"\n]+"|“[^”\n]+”/g); // quoted text
    add(/^[ \t]*\|.*$/gm); // table rows
    add(/^(?: {4}|\t).*$/gm); // indented lines
    return r;
  }

  // Place each proposed edit in the user's text. An edit is dropped, and counted by reason, if it is not found, overlaps
  // another edit, touches a protected region, or changes nothing. Dates written in a different style are put back into
  // the author's style and the change is recorded on the edit (`normalized`), never done silently.
  function locate(text, rawEdits) {
    const prot = protectedRanges(text);
    const claimed = [];
    const out = [];
    let unmatched = 0;
    let skipped = 0;
    let noop = 0;
    let normalized = 0;
    for (const raw of rawEdits) {
      if (!raw || typeof raw.original !== "string" || !raw.original || typeof raw.replacement !== "string") {
        unmatched++;
        continue;
      }
      const norm = normalizeDates(raw.replacement, raw.original);
      const replacement = norm.text;
      const changes = raw.normalized && raw.normalized.length ? raw.normalized : norm.changes;
      if (replacement === raw.original) {
        noop++;
        continue;
      }
      let occurrences = 0;
      for (let p = text.indexOf(raw.original); p !== -1; p = text.indexOf(raw.original, p + 1)) occurrences++;
      let placed = false;
      let blocked = false;
      for (let idx = text.indexOf(raw.original); idx !== -1 && !placed; idx = text.indexOf(raw.original, idx + 1)) {
        const end = idx + raw.original.length;
        const hit = (r) => idx < r[1] && end > r[0];
        if (prot.some(hit)) {
          blocked = true;
        } else if (!claimed.some(hit)) {
          claimed.push([idx, end]);
          const flags = editFlags(raw.original, replacement, text.slice(Math.max(0, idx - 8), idx));
          if (occurrences > 1) flags.push({ kind: "repeated", severity: "medium", text: `text appears ${occurrences} times, only the first is changed` });
          if (raw.type === "restructure") flags.push({ kind: "rewording", severity: "medium", text: "rewords the sentence" });
          const risk = [raw.risk, ...flags.map((f) => f.severity)].reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "low");
          if (changes.length) normalized += changes.length;
          out.push({
            original: raw.original,
            replacement,
            type: raw.type,
            reason: raw.reason,
            modelRisk: raw.risk, // what the model said
            flags, // what the basic check found
            risk, // the higher of the two
            normalized: changes, // dates put back into the author's style
            start: idx,
            end,
            accepted: risk === "low" // only edits that both the model and the check rate low start selected
          });
          placed = true;
        }
      }
      if (!placed) (blocked ? skipped++ : unmatched++);
    }
    return { edits: out.sort((a, b) => a.start - b.start), unmatched, skippedProtected: skipped, noop, normalized };
  }

  // Untouched text is copied exactly. The only characters that may change besides accepted edits are
  // spaces or tabs directly touching an accepted edit (so a deletion does not leave a double space).
  function resultText(original, edits) {
    let out = "";
    let pos = 0;
    let afterEdit = false;
    let needSpace = false;
    const gap = (g) => {
      if (afterEdit && g) {
        if (/^[,.;:!?]/.test(g)) out = out.replace(/[ \t]+$/, "");
        else if (out === "" || /[ \t]$/.test(out)) g = g.replace(/^[ \t]+/, "");
        else if (needSpace && !/^\s/.test(g)) g = " " + g;
        if (/^\r?\n/.test(g)) out = out.replace(/[ \t]+$/, "");
      }
      out += g;
      afterEdit = false;
      needSpace = false;
    };
    for (const e of edits) {
      gap(original.slice(pos, e.start));
      if (e.accepted) {
        let rep = e.replacement;
        if (rep && out && !/\s$/.test(out) && /^[ \t]/.test(e.original) && !/^[\s,.;:!?]/.test(rep)) rep = " " + rep;
        out += rep;
        afterEdit = true;
        needSpace = !!rep && /[ \t]$/.test(e.original) && !/\s$/.test(rep);
      } else {
        out += e.original;
      }
      pos = e.end;
    }
    gap(original.slice(pos));
    if (afterEdit) out = out.replace(/[ \t]+$/, "");
    return out;
  }

  /* ---------- automatic checks on a chatbot's answer (pre-written criteria, used by the harness) ---------- */
  function runChecks(answer, checks) {
    const words = (answer.trim().match(/\S+/g) || []).length;
    const failed = [];
    for (const c of checks) {
      let ok = true;
      if (c.type === "maxWords") ok = words <= c.value;
      else if (c.type === "minWords") ok = words >= c.value;
      else if (c.type === "contains") ok = answer.toLowerCase().includes(c.value.toLowerCase());
      else if (c.type === "notContains") ok = !answer.toLowerCase().includes(c.value.toLowerCase());
      else if (c.type === "notMatch") ok = !new RegExp(c.value, c.flags || "").test(answer);
      else if (c.type === "listCount") ok = count(answer, /^\s*(?:[-*•]|\d+[.)])\s+/gm) === c.value;
      else if (c.type === "maxSentences") ok = answer.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length <= c.value;
      if (!ok) failed.push(`${c.type}:${c.value}`);
    }
    return { passed: checks.length - failed.length, total: checks.length, failed };
  }

  globalThis.PR = {
    MIN_TOKENS, TESTED_HOSTS, tierFor, estTokens, locate, resultText, promptChecks, structureSig, protectedRanges, runChecks,
    extractDates, sameDate, normalizeDates, normalizeDateInText, mustKeeps, containsTarget, validateMustKeeps, classifyClarity
  };
})();
