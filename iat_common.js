"use strict";

/* ============================================================
   IAT COMMON ENGINE
   ============================================================
   Shared code for the standalone single-IAT pages (iat1_age_picture.html,
   iat2_future_self_text.html, iat3_self_esteem.html, iat4_age_text.html,
   iat5_future_self_pictorial.html). Split out of the original combined
   5-task iat_experiment2.html so each IAT can be a separate Qualtrics-
   randomized page (2x2 design: Qualtrics' randomizer decides which
   IAT(s) a given participant is routed to, rather than everyone doing
   all of them in one session).

   Each HTML file loads this script, then defines its own stimuli/config
   and calls buildIAT(cfg) + jsPsych.run([...]).

   REQUIRES (declared by each HTML file before jsPsych.run() is called):
     - jsPsych core + the jsPsych plugins actually used by that page
       (plugin-iat-html and plugin-html-keyboard-response always;
       plugin-preload only if the page has images to preload;
       plugin-initialize-camera only for the pictorial Future Self page).
     - QUALTRICS_SURVEY_URL, DATAPIPE_EXPERIMENT_ID — set once below;
       edit here rather than in every HTML file.
   ============================================================ */

/* ---------- Qualtrics / participant ID ---------- */

const QUALTRICS_SURVEY_URL = "https://maastrichtuniversity.eu.qualtrics.com/jfe/form/SV_eA8urCCFn2SCTUa";

const URL_PARAMS  = new URLSearchParams(window.location.search);
const RESPONSE_ID = URL_PARAMS.get("Q_ResponseID") || URL_PARAMS.get("ResponseID") || URL_PARAMS.get("rid") || "";
const SUBJECT_ID  = URL_PARAMS.get("subject_ID") || "";

// Deterministic hash of a string so the same participant always gets the
// same assignment if they reload, while assignments are balanced across
// participants (odd/even hash bit acts like a coin flip).
function _hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// subject_ID (the student ID number, entered by the participant on a
// required Qualtrics question and piped into the launch URL) is used as
// the primary identifier: unlike Qualtrics' internal ResponseID (not
// always finalized when the page first loads) or a locally-stored ID
// (bound to one browser/device), the student ID is guaranteed present
// and identical no matter where the participant opens the link.
function getFallbackParticipantID() {
  const STORAGE_KEY = "iat_fallback_participant_id";
  const makeID = () => "local_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  try {
    let id = window.localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = makeID();
      window.localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) — condition can't be
    // made reproducible across reloads in this case.
    return makeID();
  }
}

// Priority: student ID (subject_ID) > Qualtrics ResponseID > locally-stored
// fallback. The first two come from the survey URL and are reproducible
// across any device; the last is a last-resort safety net for testing the
// file outside Qualtrics (e.g. opening it directly with no query string).
const EFFECTIVE_ID = SUBJECT_ID || RESPONSE_ID || getFallbackParticipantID();

// Counterbalancing: compatible-first ("a") vs incompatible-first ("b").
// Hashes EFFECTIVE_ID + the IAT's own name, so if a participant somehow
// encounters more than one of these standalone pages, each IAT still gets
// an independent block-order assignment rather than sharing one globally.
function groupForIAT(name) {
  return _hashString(EFFECTIVE_ID + "_" + name) % 2 === 0 ? "a" : "b";
}

/* ---------- Raw data export (jsPsych DataPipe) ---------- */
/* Setup (one-time): create a project at https://pipe.jspsych.org (log in
   with OSF), copy its Experiment ID into DATAPIPE_EXPERIMENT_ID below.
   Files appear per participant as <subject_or_response_id>_<timestamp>.csv.
   Append ?debug=1 to a page's URL to log the CSV to the console instead
   of POSTing it, for testing without seeding the real OSF project. */

const DATAPIPE_EXPERIMENT_ID = "cDHk3ROLx3Vg";
const DEBUG_MODE = URL_PARAMS.get("debug") === "1";

/* ---------- Skip button (testing only) ---------- */
/* Gated behind ?skip=1 in the URL rather than code you add/remove by hand —
   append &skip=1 to any page's link while testing the Qualtrics Survey Flow
   end-to-end, and it's simply absent for any real participant link that
   doesn't carry that parameter.

   IMPORTANT: appended to document.documentElement (the <html> tag), NOT
   document.body. When initJsPsych() runs without an explicit
   display_element, it defaults to document.body and replaces
   body.innerHTML entirely as part of its own setup — which silently wipes
   out anything placed directly inside <body>, including a skip button, no
   matter how carefully its insertion is timed relative to jsPsych's trial
   lifecycle (this is exactly what made the old combined experiment's skip
   button unreliable across many attempts). Living as a sibling of <body>
   instead makes the button immune to that wipe regardless of timing, so
   this only needs to be called once, synchronously, anywhere before
   jsPsych.run() — no on_trial_start dance required. */

const SKIP_MODE = URL_PARAMS.get("skip") === "1";

function addSkipButtonIfEnabled(onSkip) {
  if (!SKIP_MODE || document.getElementById("skip-btn")) return;
  const btn = document.createElement("button");
  btn.id = "skip-btn";
  btn.textContent = "Skip (testing only)";
  btn.style.cssText =
    "position:fixed;bottom:10px;right:10px;z-index:9999;padding:6px 14px;" +
    "font-size:13px;cursor:pointer;background:#fff;border:1px solid #999;color:#000;";
  btn.addEventListener("click", onSkip);
  document.documentElement.appendChild(btn);
}

async function saveRawDataToPipe(filenameBase, csvString) {
  if (DEBUG_MODE) {
    console.log(`[debug] Would save "${filenameBase}.csv" to DataPipe:`);
    console.log(csvString);
    return;
  }
  if (!DATAPIPE_EXPERIMENT_ID || DATAPIPE_EXPERIMENT_ID.startsWith("PASTE-")) {
    console.warn("DATAPIPE_EXPERIMENT_ID not configured — raw trial data was not saved.");
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch("https://pipe.jspsych.org/api/data/", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experimentID: DATAPIPE_EXPERIMENT_ID,
        filename:     `${filenameBase}.csv`,
        data:         csvString,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // Don't block the participant's return to Qualtrics on a failed/slow save.
    console.error("DataPipe save failed:", err);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Trial-building utilities ---------- */

const LEFT_KEY  = "e";
const RIGHT_KEY = "i";
const ISI_MS    = 250;   // inter-stimulus interval (Inquisit default: isi = 250)

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Cycle through arr in random order (no replacement within each cycle)
// to fill exactly n slots — mirrors Inquisit random() selection behaviour.
function fillN(arr, n) {
  const out = [];
  while (out.length < n) out.push(...shuffle(arr));
  return out.slice(0, n);
}

function targetHTML(w)      { return `<span class="iat-word">${w}</span>`; }
function attrHTML(w, isB)   { return `<span class="iat-word ${isB ? "iat-attr-b" : "iat-attr"}">${w}</span>`; }
function faceHTML(f)        { return `<img class="iat-face" src="${f.src}" alt="${f.alt}">`; }

// Build one IAT trial.
// Uses the plugin's native force_correct_key_press so an incorrect response
// keeps the SAME stimulus on screen, shows the red X, and waits for the
// correct key within this one trial — no separate trial/re-render, matching
// conventional IAT software. The plugin only records rt to the *first*
// keypress, so on_start/on_finish are used to record our own rt spanning
// stimulus onset through the eventual correct response.
function makeTrial(item, isAttr, keyAssoc, leftLbl, rightLbl, blockTag) {
  const isImage  = typeof item === "object" && item.src;
  const stimHTML = isAttr  ? attrHTML(item, keyAssoc === "right")
                 : isImage ? faceHTML(item)
                 : targetHTML(item);

  const errorReminder =
    `<div style="position:fixed;bottom:10px;left:0;right:0;text-align:center;` +
    `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#888;">` +
    `If you make an error, a red X will appear. Press the other key to continue.</div>`;

  let stimOnset;
  const mainTrial = {
    type:                    jsPsychIatHtml,
    stimulus:                stimHTML + errorReminder,
    stim_key_association:    keyAssoc,
    left_category_key:       LEFT_KEY,
    right_category_key:      RIGHT_KEY,
    left_category_label:     leftLbl,
    right_category_label:    rightLbl,
    display_feedback:        true,
    html_when_wrong:         `<span style="color:red;font-size:80px;font-weight:bold;display:block;text-align:center;line-height:1;margin-top:10px">X</span>`,
    force_correct_key_press: true,
    trial_duration:          null,
    response_ends_trial:     true,
    post_trial_gap:          ISI_MS,
    data:                    { block: blockTag },
    on_start:                function ()     { stimOnset = performance.now(); },
    on_finish:               function (data) { data.rt = Math.round(performance.now() - stimOnset); },
  };

  return { timeline: [mainTrial] };
}

// Single-category block (target-only or attribute-only practice).
// Returns n shuffled trials.
function makeSingleBlock(leftItems, rightItems, isAttr, leftLbl, rightLbl, blockTag, n) {
  const left  = fillN(leftItems,  Math.ceil(n / 2)).map(i => makeTrial(i, isAttr, "left",  leftLbl, rightLbl, blockTag));
  const right = fillN(rightItems, Math.floor(n / 2)).map(i => makeTrial(i, isAttr, "right", leftLbl, rightLbl, blockTag));
  return shuffle([...left, ...right]);
}

// Combined (double-category) block with strict attr->target alternation.
// Matches Inquisit: even trial positions = attributes, odd = targets
// (counting from 1 after the instruction slide).
// n must be even; half the trials are attributes, half are targets.
function makeCombinedBlock(leftTargets, rightTargets, leftAttrs, rightAttrs,
                           leftLbl, rightLbl, blockTag, n) {
  const half = n / 2;

  const attrPool = shuffle([
    ...fillN(leftAttrs,  Math.ceil(half / 2)).map(i => makeTrial(i, true,  "left",  leftLbl, rightLbl, blockTag)),
    ...fillN(rightAttrs, Math.floor(half / 2)).map(i => makeTrial(i, true,  "right", leftLbl, rightLbl, blockTag)),
  ]);
  const targetPool = shuffle([
    ...fillN(leftTargets,  Math.ceil(half / 2)).map(i => makeTrial(i, false, "left",  leftLbl, rightLbl, blockTag)),
    ...fillN(rightTargets, Math.floor(half / 2)).map(i => makeTrial(i, false, "right", leftLbl, rightLbl, blockTag)),
  ]);

  // Interleave: attr, target, attr, target …
  const result = [];
  for (let i = 0; i < half; i++) result.push(attrPool[i], targetPool[i]);
  return result;
}

// Instruction slide (advances on spacebar).
function instrSlide(html) {
  return {
    type:     jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="instr-wrap">${html}</div>`,
    choices:  [" "],
    data:     { block: "instructions" },
  };
}

// Styled helpers for instruction text
const K  = k   => `<span class="key-box">${k.toUpperCase()}</span>`;
const TT = lbl => `<span class="cat-tag">${lbl}</span>`;
const TA = lbl => `<span class="cat-tag attr">${lbl}</span>`;

/* ---------- D-score calculator ---------- */
/* Two-part improved D algorithm (Greenwald, Nosek & Banaji, 2003):
     da = (M_incompat_short - M_compat_short) / SD_pooled_short
     db = (M_incompat_long  - M_compat_long)  / SD_pooled_long
     d  = (da + db) / 2
   SD_pooled_short = SD of all valid RTs in compat-short + incompat-short
   SD_pooled_long  = SD of all valid RTs in compat-long  + incompat-long
   Valid = RT <= 10 000 ms (excluded from D-score only).
   propRT300 = proportion of ALL test-block trials with RT < 300 ms.
   excludeCriteriaMet = 1 if propRT300 > 0.10 (Greenwald et al. 2003 p.214).
   D-score interpretation (same thresholds as Inquisit output):
     |d| >= 0.65 => strong;  >= 0.35 => moderate;  >= 0.15 => slight */

function computeDScore(allData, prefix) {
  // Each trial's rt already spans stimulus onset through the eventual correct
  // response (see makeTrial: force_correct_key_press keeps the trial open on
  // an error, and on_finish records total elapsed time), matching how
  // conventional IAT software times error trials. No merging needed.
  const byTag = tag => allData.filter(d => d.block === tag);

  const sc = byTag(prefix + "_sc");
  const lc = byTag(prefix + "_lc");
  const si = byTag(prefix + "_si");
  const li = byTag(prefix + "_li");
  const all4 = [...sc, ...lc, ...si, ...li];

  // propRT300: ALL test-block trials, no RT ceiling
  const propRT300 = all4.length > 0
    ? all4.filter(d => d.rt < 300).length / all4.length : 0;

  // Exclude RT > 10 000 ms for D-score
  const valid = trials => trials.filter(d => d.rt !== null && d.rt <= 10000);
  const scV = valid(sc), lcV = valid(lc), siV = valid(si), liV = valid(li);

  function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

  function pooledSD(a, b) {
    const combined = [...a, ...b];
    if (combined.length < 2) return 1;
    const m = mean(combined);
    return Math.sqrt(combined.reduce((s, x) => s + (x - m) * (x - m), 0) / combined.length) || 1;
  }

  const scRTs = scV.map(d => d.rt), siRTs = siV.map(d => d.rt);
  const lcRTs = lcV.map(d => d.rt), liRTs = liV.map(d => d.rt);

  const sda = pooledSD(scRTs, siRTs);
  const sdb = pooledSD(lcRTs, liRTs);
  const da  = (mean(siRTs) - mean(scRTs)) / sda;
  const db  = (mean(liRTs) - mean(lcRTs)) / sdb;
  const d   = (da + db) / 2;

  const allValid   = [...scV, ...lcV, ...siV, ...liV];
  const pctCorrect = allValid.length
    ? allValid.filter(t => t.correct).length / allValid.length * 100 : 0;

  return {
    d:           +d.toFixed(3),
    da:          +da.toFixed(3),
    db:          +db.toFixed(3),
    pctCorrect:  +pctCorrect.toFixed(1),
    propRT300:   +propRT300.toFixed(3),
    exclude:     propRT300 > 0.10 ? 1 : 0,
    rtCompatS:   +mean(scRTs).toFixed(0),
    rtCompatL:   +mean(lcRTs).toFixed(0),
    rtIncompatS: +mean(siRTs).toFixed(0),
    rtIncompatL: +mean(liRTs).toFixed(0),
  };
}

/* ---------- IAT timeline builder ---------- */
/* Block structure (matched to Inquisit iat_inc.iqjs / pictureiat_inc.iqjs):
   Group a — compatible first:
     B1  Target practice          20 trials  targetA=LEFT
     B2  Attribute practice       20 trials
     B3  Compat short test        20 trials  tag: _sc
         [instruction slide]
     B5  Compat long test         40 trials  tag: _lc
     B6  Target switch practice   20 trials  targetB=LEFT
     B7  Incompat short test      20 trials  tag: _si
         [instruction slide]
     B9  Incompat long test       40 trials  tag: _li
   Group b — incompatible first: same structure, sides and _sc/_si /
   _lc/_li tags swapped.

   cfg shape: { name, group: "a"|"b", targetA: {label, stimuli},
                targetB: {label, stimuli}, attrA: {label, words},
                attrB: {label, words}, intro: "<html>" } */

function buildIAT(cfg) {
  const P           = cfg.name;
  const compatFirst = cfg.group === "a";

  // Side assignment depends on group
  const firstLeftTargets  = compatFirst ? cfg.targetA.stimuli : cfg.targetB.stimuli;
  const firstRightTargets = compatFirst ? cfg.targetB.stimuli : cfg.targetA.stimuli;
  const firstLeftTLabel   = compatFirst ? cfg.targetA.label   : cfg.targetB.label;
  const firstRightTLabel  = compatFirst ? cfg.targetB.label   : cfg.targetA.label;

  const switchLeftTargets  = compatFirst ? cfg.targetB.stimuli : cfg.targetA.stimuli;
  const switchRightTargets = compatFirst ? cfg.targetA.stimuli : cfg.targetB.stimuli;
  const switchLeftLabel    = compatFirst ? cfg.targetB.label   : cfg.targetA.label;
  const switchRightLabel   = compatFirst ? cfg.targetA.label   : cfg.targetB.label;

  // Attribute labels: attrA (good/pleasant) = green, attrB (bad/unpleasant) = red
  const attrALbl = ['<span style="color:#005f00;font-weight:bold">' + cfg.attrA.label + '</span>'];
  const attrBLbl = ['<span style="color:red;font-weight:bold">'     + cfg.attrB.label + '</span>'];

  // Category labels for combined blocks — 2-item arrays.
  // The plugin automatically inserts "or" between item[0] and item[1].
  // Layout rendered by plugin: attribute (colored) / or / target
  const firstCombLeft  = [
    '<span style="color:#005f00;font-weight:bold">' + cfg.attrA.label + '</span>',
    firstLeftTLabel
  ];
  const firstCombRight = [
    '<span style="color:red;font-weight:bold">'     + cfg.attrB.label + '</span>',
    firstRightTLabel
  ];
  const secondCombLeft  = [
    '<span style="color:#005f00;font-weight:bold">' + cfg.attrA.label + '</span>',
    switchLeftLabel
  ];
  const secondCombRight = [
    '<span style="color:red;font-weight:bold">'     + cfg.attrB.label + '</span>',
    switchRightLabel
  ];

  // Block tags — always identify compat vs incompat, regardless of order
  const scTag = compatFirst ? P + "_sc" : P + "_si";
  const lcTag = compatFirst ? P + "_lc" : P + "_li";
  const siTag = compatFirst ? P + "_si" : P + "_sc";
  const liTag = compatFirst ? P + "_li" : P + "_lc";

  // Instruction text helpers: attrA green, attrB red, targets bold
  const GN = lbl => `<span style="color:#005f00;font-weight:bold">'${lbl}'</span>`;
  const RD = lbl => `<span style="color:red;font-weight:bold">'${lbl}'</span>`;
  const BL = lbl => `<strong>'${lbl}'</strong>`;

  const tl = [];

  // ── IAT intro ────────────────────────────────────────────────────────────
  tl.push(instrSlide(cfg.intro));

  // ── B1: Target practice (20 trials) ──────────────────────────────────────
  // Inquisit instruction 1
  tl.push(instrSlide(
    `<p>Put your left finger on the ${K("e")} response key for items that belong to the category ${BL(firstLeftTLabel)}.</p>` +
    `<p>Put your right finger on the ${K("i")} response key for items that belong to the category ${BL(firstRightTLabel)}.</p>` +
    `<p>Items will appear one-by-one in the middle of the screen.</p>` +
    `<p>If you make an error, a red X will appear - to continue, press the other response key.</p>` +
    `<p>Go as fast as you can while making as few errors as possible.</p>` +
    `<p class="spacebar-note">Press the SPACE BAR to begin.</p>`
  ));
  tl.push(...makeSingleBlock(
    firstLeftTargets, firstRightTargets, false,
    [firstLeftTLabel], [firstRightTLabel],
    P + "_b1", 20
  ));

  // ── B2: Attribute practice (20 trials) ───────────────────────────────────
  // Inquisit instruction 2
  tl.push(instrSlide(
    `<p>Put your left finger on the ${K("e")} response key for items that belong to the category ${GN(cfg.attrA.label)}.</p>` +
    `<p>Put your right finger on the ${K("i")} response key for items that belong to the category ${RD(cfg.attrB.label)}.</p>` +
    `<p>If you make an error, a red X will appear - to continue, press the other response key.</p>` +
    `<p>Go as fast as you can while making as few errors as possible.</p>` +
    `<p class="spacebar-note">Press the SPACE BAR to begin.</p>`
  ));
  tl.push(...makeSingleBlock(
    cfg.attrA.words, cfg.attrB.words, true,
    attrALbl, attrBLbl,
    P + "_b2", 20
  ));

  // ── B3: First combined short test (20 trials) — D-score ──────────────────
  // Inquisit instruction 3
  tl.push(instrSlide(
    `<p>Press the left ${K("e")} key for ${GN(cfg.attrA.label)} and ${BL(firstLeftTLabel)}.</p>` +
    `<p>Press the right ${K("i")} key for ${RD(cfg.attrB.label)} and ${BL(firstRightTLabel)}.</p>` +
    `<p>Each item belongs to only one category.</p>` +
    `<p>If you make an error, a red X will appear - to continue, press the other response key.</p>` +
    `<p>Go as fast as you can while making as few errors as possible.</p>` +
    `<p class="spacebar-note">Press the SPACE BAR to begin.</p>`
  ));
  tl.push(...makeCombinedBlock(
    firstLeftTargets, firstRightTargets, cfg.attrA.words, cfg.attrB.words,
    firstCombLeft, firstCombRight, scTag, 20
  ));

  // ── Instruction between B3 and B5 (Inquisit instruction 4) ───────────────
  tl.push(instrSlide(
    `<p>This is the same task as the previous one.</p>` +
    `<br>` +
    `<p>Press the left ${K("e")} key for ${GN(cfg.attrA.label)} and ${BL(firstLeftTLabel)}.</p>` +
    `<p>Press the right ${K("i")} key for ${RD(cfg.attrB.label)} and ${BL(firstRightTLabel)}.</p>` +
    `<p>Each item belongs to only one category.</p>` +
    `<p>Go as fast as you can while making as few errors as possible.</p>` +
    `<p class="spacebar-note">Press the SPACE BAR to begin.</p>`
  ));

  // ── B5: First combined long test (40 trials) — D-score ───────────────────
  tl.push(...makeCombinedBlock(
    firstLeftTargets, firstRightTargets, cfg.attrA.words, cfg.attrB.words,
    firstCombLeft, firstCombRight, lcTag, 40
  ));

  // ── B6: Target switch practice (20 trials) ───────────────────────────────
  // Inquisit instruction 5
  tl.push(instrSlide(
    `<p>Attention! The labels have changed sides.</p>` +
    `<p>Press the left ${K("e")} key for ${BL(switchLeftLabel)}.</p>` +
    `<p>Press the right ${K("i")} key for ${BL(switchRightLabel)}.</p>` +
    `<p>Go as fast as you can while making as few errors as possible.</p>` +
    `<p class="spacebar-note">Press the SPACE BAR to begin.</p>`
  ));
  tl.push(...makeSingleBlock(
    switchLeftTargets, switchRightTargets, false,
    [switchLeftLabel], [switchRightLabel],
    P + "_b6", 20
  ));

  // ── B7: Second combined short test (20 trials) — D-score ─────────────────
  // Inquisit instruction 6
  tl.push(instrSlide(
    `<p>Press the left ${K("e")} key for ${GN(cfg.attrA.label)} and ${BL(switchLeftLabel)}.</p>` +
    `<p>Press the right ${K("i")} key for ${RD(cfg.attrB.label)} and ${BL(switchRightLabel)}.</p>` +
    `<p>If you make an error, a red X will appear - to continue, press the other response key.</p>` +
    `<p>Go as fast as you can while making as few errors as possible.</p>` +
    `<p class="spacebar-note">Press the SPACE BAR to begin.</p>`
  ));
  tl.push(...makeCombinedBlock(
    switchLeftTargets, switchRightTargets, cfg.attrA.words, cfg.attrB.words,
    secondCombLeft, secondCombRight, siTag, 20
  ));

  // ── Instruction between B7 and B9 (Inquisit instruction 7) ───────────────
  tl.push(instrSlide(
    `<p>This is the same task as the previous one.</p>` +
    `<p>Press the left ${K("e")} key for ${GN(cfg.attrA.label)} and ${BL(switchLeftLabel)}.</p>` +
    `<p>Press the right ${K("i")} key for ${RD(cfg.attrB.label)} and ${BL(switchRightLabel)}.</p>` +
    `<p>Each item belongs to only one category.</p>` +
    `<p>Go as fast as you can while making as few errors as possible.</p>` +
    `<p class="spacebar-note">Press the SPACE BAR to begin.</p>`
  ));

  // ── B9: Second combined long test (40 trials) — D-score ──────────────────
  tl.push(...makeCombinedBlock(
    switchLeftTargets, switchRightTargets, cfg.attrA.words, cfg.attrB.words,
    secondCombLeft, secondCombRight, liTag, 40
  ));

  return tl;
}

/* ---------- Shared "done" trial + Qualtrics param builder ---------- */

const finalTrial = {
  type:           jsPsychHtmlKeyboardResponse,
  stimulus:       "<p style='font-family:Helvetica,Arial,sans-serif;font-size:22px;color:#000'>All done! Saving results…</p>",
  trial_duration: 1500,
  choices:        "NO_KEYS",
  data:           { block: "end" },
};

// Shared on_finish body for a single-IAT page: computes the D-score for
// `iatName`, builds the iatN_* Qualtrics params (same field names as the
// original combined experiment, so Survey Flow / data export stays
// consistent regardless of which page a participant landed on), saves
// the raw trial CSV to DataPipe, then redirects back to Qualtrics.
// `extraParams` (optional) lets a page add fields beyond the standard
// d/da/db/... set (e.g. iat5's generationFailed flag).
async function finishAndReturnToQualtrics(jsPsychInstance, iatName, conditionGroup, extraParams) {
  const allData = jsPsychInstance.data.get().values();
  const s = computeDScore(allData, iatName);

  const paramObj = {
    subject_ID: SUBJECT_ID,
    [`${iatName}_d`]:              s.d,
    [`${iatName}_da`]:             s.da,
    [`${iatName}_db`]:             s.db,
    [`${iatName}_pctCorrect`]:     s.pctCorrect,
    [`${iatName}_propRT300`]:      s.propRT300,
    [`${iatName}_exclude`]:        s.exclude,
    [`${iatName}_conditionOrder`]: conditionGroup === "a" ? "c-ic" : "ic-c",
    [`${iatName}_rtCompatS`]:      s.rtCompatS,
    [`${iatName}_rtCompatL`]:      s.rtCompatL,
    [`${iatName}_rtIncompatS`]:    s.rtIncompatS,
    [`${iatName}_rtIncompatL`]:    s.rtIncompatL,
    ...(extraParams || {}),
  };
  const params = new URLSearchParams(paramObj);

  const idForFile = (SUBJECT_ID || EFFECTIVE_ID).replace(/[^a-zA-Z0-9_-]/g, "");
  await saveRawDataToPipe(`${idForFile}_${iatName}_${Date.now()}`, jsPsychInstance.data.get().csv());

  document.body.innerHTML =
    "<div style='display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;height:100vh;" +
    "font-family:\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-size:22px;" +
    "color:#000;background:#fff;'>" +
    "<p>Task complete. Thank you!</p>" +
    "<p style='font-size:16px;color:#555'>Returning to the survey…</p>" +
    "</div>";

  setTimeout(function () {
    window.location.href = QUALTRICS_SURVEY_URL + "?" + params.toString();
  }, 2000);
}
