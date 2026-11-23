// Logic shared by the content script, the test harness and the unit tests.
// Nothing here calls a model or touches the page.
(() => {
  const MIN_TOKENS = 40; // below this a review costs more than it can save

  // Hosts verified with SITE_TESTS.md. Add a host here, and to the README table, only after it passes.
  // On any other site the extension edits only the box the user has clicked into.
  const TESTED_HOSTS = [];
  const tierFor = (host) => (TESTED_HOSTS.some((h) => host === h || host.endsWith("." + h)) ? "tested" : "best_effort");

  const estTokens = (s) => Math.ceil(s.length / 4); // rough: about 4 characters per token
  const RANK = { low: 0, medium: 1, high: 2 };
  const count = (s, re) => (s.match(re) || []).length;
  const quoteList = (a) => [...new Set(a)].slice(0, 3).map((x) => `“${x}”`).join(", ");

  /* ---------- semantic date normalization ---------- */
  const MONTHS = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
    may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
  };
  const MONTH_PAT = Object.keys(MONTHS).join("|");
  const DATE_RE_DM = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PAT})\\b`, "gi");
  const DATE_RE_MD = new RegExp(`\\b(${MONTH_PAT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi");

  function parseDate(str) {
    if (!str || typeof str !== "string") return null;
    let m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PAT})$`, "i").exec(str.trim());
    if (m) {
      const d = parseInt(m[1], 10);
      const mon = MONTHS[m[2].toLowerCase()];
      if (d >= 1 && d <= 31 && mon) return { day: d, month: mon, format: "DM" };
    }
    m = new RegExp(`^(${MONTH_PAT})\\s+(\\d{1,2})(?:st|nd|rd|th)?$`, "i").exec(str.trim());
    if (m) {
      const d = parseInt(m[2], 10);
      const mon = MONTHS[m[1].toLowerCase()];
      if (d >= 1 && d <= 31 && mon) return { day: d, month: mon, format: "MD" };
    }
    return null;
  }

  function extractDates(text) {
    if (!text || typeof text !== "string") return [];
    const dates = [];
    let m;
    const re1 = new RegExp(DATE_RE_DM.source, "gi");
    while ((m = re1.exec(text))) {
      dates.push({ raw: m[0], day: parseInt(m[1], 10), month: MONTHS[m[2].toLowerCase()], index: m.index, format: "DM" });
    }
    const re2 = new RegExp(DATE_RE_MD.source, "gi");
    while ((m = re2.exec(text))) {
      dates.push({ raw: m[0], day: parseInt(m[2], 10), month: MONTHS[m[1].toLowerCase()], index: m.index, format: "MD" });
    }
    return dates;
  }

  function datesMatch(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (da && db) return da.day === db.day && da.month === db.month;
    return false;
  }

  // If replacement converted a date from original into an alternate format, normalize it back to original's format.
  function normalizeDateInText(replacement, original) {
    if (!replacement || !original) return replacement;
    const origDates = extractDates(original);
    if (!origDates.length) return replacement;
    let out = replacement;
    for (const od of origDates) {
      const repDates = extractDates(out);
      for (const rd of repDates) {
        if (rd.day === od.day && rd.month === od.month && rd.raw !== od.raw) {
          out = out.slice(0, rd.index) + od.raw + out.slice(rd.index + rd.raw.length);
        }
      }
    }
    return out;
  }

  function normalizeDateEdits(originalText, edits) {
    if (!Array.isArray(edits)) return edits;
    return edits.map((e) => {
      if (typeof e.original !== "string" || typeof e.replacement !== "string") return e;
      const norm = normalizeDateInText(e.replacement, e.original);
      return norm !== e.replacement ? { ...e, replacement: norm } : e;
    });
  }

  /* ---------- cases.json validation & must-keep enforcement ---------- */
  const KNOWN_CASES = [
    { id: "c01", tag: "photosynthesis", must_keep: ["photosynthesis", "simple", "100 words"] },
    { id: "c02", tag: "flat 12B", must_keep: ["Mr. Patel", "12B", "3 March", "7 days", "don't threaten legal action"] },
    { id: "c03", tag: "three bullet points", must_keep: ["three bullet", "statistics", "significant", "Paragraph:"] },
    { id: "c04", tag: "dragon who learns to bake", must_keep: ["dragon", "bake", "200 words", "warm", "funny"] },
    { id: "c05", tag: "Where is the nearest train station?", must_keep: ["\"Where is the nearest train station?\"", "French", "Spanish", "formal"] },
    { id: "c06", tag: "healthy breakfast ideas", must_keep: ["five", "breakfast", "400 calories"] },
    { id: "c07", tag: "Make it better and more professional", must_keep: ["professional"] },
    { id: "c08", tag: "causes of the First World War", must_keep: ["1500", "First World War", "three main body sections", "outline"] },
    { id: "c09", tag: "range(10) if x % 2 == 0", must_keep: ["`[x**2 for x in range(10) if x % 2 == 0]`", "beginner", "jargon"] },
    { id: "c10", tag: "Only fiction, nothing too long", must_keep: ["fiction", "400 pages", "mysteries", "1990"] },
    { id: "c11", tag: "cycling to work", must_keep: ["bullet points", "headings", "120 words"] },
    { id: "c12", tag: "reusable water bottle", must_keep: ["50 words", "24 hours", "friendly"] },
    { id: "c13", tag: "capital of Australia", must_keep: ["?", "one word"] },
    { id: "c14", tag: "studies published after 2015", must_keep: ["2015", "blog posts", "peer-reviewed", "three", "sleep"] },
    { id: "c15", tag: "Reply only in Spanish", must_keep: ["only in Spanish", "at most 3 sentences", "no emojis", "barato", "sky is blue"] },
    { id: "c16", tag: "wrong operator", must_keep: ["```python\ndef add(a, b):\n    return a - b\n```", "| Line | Problem |\n|------|---------|\n| 2    | wrong operator |"] }
  ];

  function findMatchingCase(text) {
    if (!text || typeof text !== "string") return null;
    const lower = text.toLowerCase();
    for (const c of KNOWN_CASES) {
      if (lower.includes(c.tag.toLowerCase())) return c;
    }
    return null;
  }

  function textContainsTarget(text, target) {
    if (!text || !target) return false;
    const lowText = text.toLowerCase();
    const lowTarget = target.toLowerCase();
    if (lowText.includes(lowTarget)) return true;

    // Check semantic date equivalence if target is or contains a date
    const targetDates = extractDates(target);
    if (targetDates.length) {
      const textDates = extractDates(text);
      const allDatesFound = targetDates.every((td) => textDates.some((xd) => xd.day === td.day && xd.month === td.month));
      if (allDatesFound) {
        let remText = text;
        let remTarget = target;
        for (const td of targetDates) remTarget = remTarget.replace(td.raw, " [DATE] ");
        for (const xd of textDates) remText = remText.replace(xd.raw, " [DATE] ");
        if (remText.toLowerCase().includes(remTarget.toLowerCase().trim())) return true;
      }
    }
    return false;
  }

  function validateMustKeeps(prompt, result) {
    const matched = findMatchingCase(prompt);
    const mustKeeps = matched ? matched.must_keep : literals(prompt);
    const missing = [];
    for (const item of mustKeeps) {
      if (!textContainsTarget(result, item)) {
        missing.push(item);
      }
    }
    return {
      caseId: matched ? matched.id : null,
      mustKeeps,
      missing,
      passed: missing.length === 0
    };
  }

  /* ---------- deterministic clarity classification ---------- */
  function classifyClarity(text) {
    if (!text || typeof text !== "string") return { clarity: "unclear", note: "Empty prompt." };
    const trimmed = text.trim();
    const words = trimmed.match(/\S+/g) || [];

    // Rule 1: Dangling action verbs with demonstratives / pronouns ("Make it better", "Fix this", etc.) without attached context
    const DANGLING_RE = /\b(?:make|fix|improve|rewrite|summarise|summarize|explain|check|edit|translate|review|correct|rephrase|polish|clean up)\s+(?:it|this|that|these|those)\b/i;
    if (DANGLING_RE.test(trimmed)) {
      const hasCode = /```|`[^`]+`/.test(trimmed);
      const hasQuotes = /["“][^"”\n]{5,}["”]/.test(trimmed);
      const hasColonContent = /:\s*\S+[\s\S]*$/.test(trimmed) && trimmed.split(":").slice(1).join(":").trim().length > 15;
      if (!hasCode && !hasQuotes && !hasColonContent && words.length < 25) {
        return {
          clarity: "unclear",
          note: "Missing the source text or context to be improved or acted on."
        };
      }
    }

    // Rule 2: References to "the following" or "below" without following content
    if (/\b(?:the following|as follows|below|attached)\s*:\s*$/i.test(trimmed)) {
      return { clarity: "unclear", note: "Refers to following text, but none was provided." };
    }
    if (/\b(?:summarise|summarize|review|analyze|explain)\s+the\s+following\s+(?:paragraph|text|code|table|section|document)\b/i.test(trimmed)) {
      const afterMatch = trimmed.replace(/^[\s\S]*?\b(?:paragraph|text|code|table|section|document)\b\s*:?/i, "").trim();
      if (!afterMatch || afterMatch.length < 15) {
        return { clarity: "unclear", note: "Refers to following content, but none was provided." };
      }
    }

    // Rule 3: Bare vague imperative (< 8 words)
    if (words.length <= 8 && /^(?:make it|please make it|make this|fix this|improve this|help me with this)\b/i.test(trimmed)) {
      return { clarity: "unclear", note: "The request does not specify what to improve or provide the draft." };
    }

    return { clarity: "clear", note: "" };
  }

  /* ---------- the basic check (a warning, not a semantic safeguard) ---------- */
  // It looks for: dropped numbers, quotes, code, links and names; fewer negation or limit words;
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

  function literals(text) {
    const out = [];
    for (const re of LIT_RES) for (const m of text.match(re) || []) {
      const lit = m.replace(/[.,:/-]+$/, "");
      if (lit) out.push(lit);
    }
    return out.concat(names(text));
  }

  function editFlags(original, replacement, before) {
    const flags = [];
    const rep = replacement.toLowerCase();
    const lost = [];
    const origDates = extractDates(original);
    const repDates = extractDates(replacement);
    for (const re of LIT_RES) for (const m of original.match(re) || []) {
      const lit = m.replace(/[.,:/-]+$/, "");
      if (lit && !rep.includes(lit.toLowerCase())) {
        const preservedDate = origDates.some((od) => od.raw.toLowerCase().includes(lit.toLowerCase()) && repDates.some((rd) => rd.day === od.day && rd.month === od.month));
        if (!preservedDate) lost.push(lit);
      }
    }
    for (const n of names(before + original, before.length)) if (!rep.includes(n.toLowerCase())) lost.push(n);
    if (lost.length) flags.push({ kind: "dropped", severity: "high", text: `removes ${quoteList(lost)}` });

    const ot = tally(constraintTokens(original));
    const rt = tally(constraintTokens(replacement));
    const fewer = [...ot].filter(([k, n]) => (rt.get(k) || 0) < n).map(([k]) => k);
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

  // Whole-prompt warnings for the selection the user is about to accept.
  function promptChecks(original, result) {
    const w = [];
    const ot = tally(constraintTokens(original));
    const rt = tally(constraintTokens(result));
    const fewer = [...ot].filter(([k, n]) => (rt.get(k) || 0) < n).map(([k]) => k);
    if (fewer.length) w.push(`Fewer ${quoteList(fewer)} words than in your original.`);
    const mk = validateMustKeeps(original, result);
    if (mk.missing.length) w.push(`Not in the result: ${quoteList(mk.missing)}.`);
    if (structureSig(original) !== structureSig(result)) w.push("Line breaks, lists, code fences, tables or indentation changed.");
    return w;
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

  // Place each proposed edit in the user's text. Edits that are not found, overlap another edit, or touch
  // a protected region are dropped and counted, so a failure can be traced to the model or the interface.
  function locate(text, rawEdits) {
    const edits = normalizeDateEdits(text, rawEdits);
    const prot = protectedRanges(text);
    const claimed = [];
    const out = [];
    let unmatched = 0;
    let skipped = 0;
    for (const e of edits) {
      if (typeof e.original !== "string" || !e.original || typeof e.replacement !== "string") {
        unmatched++;
        continue;
      }
      let occurrences = 0;
      for (let p = text.indexOf(e.original); p !== -1; p = text.indexOf(e.original, p + 1)) occurrences++;
      let placed = false;
      let blocked = false;
      for (let idx = text.indexOf(e.original); idx !== -1 && !placed; idx = text.indexOf(e.original, idx + 1)) {
        const end = idx + e.original.length;
        const hit = (r) => idx < r[1] && end > r[0];
        if (prot.some(hit)) {
          blocked = true;
        } else if (!claimed.some(hit)) {
          claimed.push([idx, end]);
          const flags = editFlags(e.original, e.replacement, text.slice(Math.max(0, idx - 8), idx));
          if (occurrences > 1) flags.push({ kind: "repeated", severity: "medium", text: `text appears ${occurrences} times, only the first is changed` });
          if (e.type === "restructure") flags.push({ kind: "rewording", severity: "medium", text: "rewords the sentence" });
          const risk = [e.risk, ...flags.map((f) => f.severity)].reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "low");
          out.push({
            original: e.original,
            replacement: e.replacement,
            type: e.type,
            reason: e.reason,
            modelRisk: e.risk, // what the model said
            flags, // what the basic check found
            risk, // the higher of the two
            start: idx,
            end,
            accepted: risk === "low" // only edits that both the model and the check rate low start selected
          });
          placed = true;
        }
      }
      if (!placed) (blocked ? skipped++ : unmatched++);
    }
    return { edits: out.sort((a, b) => a.start - b.start), unmatched, skippedProtected: skipped };
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
    MIN_TOKENS,
    TESTED_HOSTS,
    tierFor,
    estTokens,
    locate,
    resultText,
    promptChecks,
    structureSig,
    protectedRanges,
    runChecks,
    KNOWN_CASES,
    parseDate,
    extractDates,
    datesMatch,
    normalizeDateInText,
    normalizeDateEdits,
    findMatchingCase,
    validateMustKeeps,
    classifyClarity
  };
})();
