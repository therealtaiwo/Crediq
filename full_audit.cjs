const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function preview(text, len = 90) {
  if (!text) return "(empty)";
  return text.length > len ? text.slice(0, len) + "…" : text;
}

const QUESTION_LEAK = /\bQuestion\s?\d+\b/i;              // "Question 8" literally leaking in
const SEMICOLON_AFTER_CAPS = /\b[A-Z][a-z]?;/;             // "NH;" — lost chemical subscript
const MATH_UNICODE = /[\u{1D400}-\u{1D7FF}]/u;              // 𝐶𝐻𝑂 — italic math-alphabet letters
const STRAY_PIPE = /\s\|\s|\|\d|\d\|/;                     // stray | likely meant as subscript/abs-value
const LONG_ARRAY_THRESHOLD = 6;

async function main() {
  console.log("📥 Fetching all theoryQuestions...");
  const snap = await db.collection("theoryQuestions").get();
  console.log(`   Found ${snap.size} documents\n`);

  const results = [];

  snap.docs.forEach(d => {
    const q = d.data();
    const sqs = q.subQuestions || [];
    const reasons = [];

    // ── Structural / merge signals ──
    const parts = sqs.map(sq => sq.part);
    const seen = new Set();
    let hasDupe = false;
    parts.forEach(p => { if (seen.has(p)) hasDupe = true; seen.add(p); });
    if (hasDupe) reasons.push({ cat: "MERGE", type: "duplicate-part-labels" });

    const fields = [];
    if (q.question) fields.push({ label: "question", text: q.question });
    sqs.forEach(sq => {
      if (sq.text) fields.push({ label: `(${sq.part}) text`, text: sq.text });
      if (sq.answer) fields.push({ label: `(${sq.part}) answer`, text: sq.answer });
    });

    let questionLeak = false;
    const symbolHits = [];

    fields.forEach(f => {
      if (QUESTION_LEAK.test(f.text)) questionLeak = true;
      if (SEMICOLON_AFTER_CAPS.test(f.text)) symbolHits.push({ type: "lost-subscript(;)", field: f.label, text: f.text });
      if (MATH_UNICODE.test(f.text)) symbolHits.push({ type: "math-unicode", field: f.label, text: f.text });
      if (STRAY_PIPE.test(f.text)) symbolHits.push({ type: "stray-pipe", field: f.label, text: f.text });
    });

    if (questionLeak) reasons.push({ cat: "MERGE", type: "question-number-leak" });
    if (sqs.length >= LONG_ARRAY_THRESHOLD && !hasDupe) reasons.push({ cat: "SOFT", type: `long-array(${sqs.length})` });
    symbolHits.forEach(h => reasons.push({ cat: "SYMBOL", type: h.type, detail: `${h.field}: ${preview(h.text)}` }));

    if (reasons.length > 0) {
      results.push({ id: d.id, subject: q.subject, year: q.year, sqs, reasons });
    }
  });

  const mergeFlagged = results.filter(r => r.reasons.some(x => x.cat === "MERGE"));
  const softFlagged = results.filter(r => r.reasons.some(x => x.cat === "SOFT") && !r.reasons.some(x => x.cat === "MERGE"));
  const symbolOnly = results.filter(r => r.reasons.every(x => x.cat === "SYMBOL"));

  console.log("═══════════════════════════════════════");
  console.log(`🔴 MERGE issues (structure broken, should be hidden): ${mergeFlagged.length}`);
  mergeFlagged.forEach(r => {
    const types = r.reasons.filter(x => x.cat === "MERGE").map(x => x.type).join(", ");
    console.log(`   ${r.id} (${r.subject}, ${r.year}) — ${types} — ${r.sqs.length} sub-parts`);
  });

  console.log(`\n🟡 SOFT signal (unusually long, no hard evidence — worth a glance): ${softFlagged.length}`);
  softFlagged.forEach(r => console.log(`   ${r.id} (${r.subject}, ${r.year})`));

  console.log(`\n🔵 SYMBOL corruption only (structure fine, characters wrong): ${symbolOnly.length}`);
  symbolOnly.forEach(r => {
    console.log(`   ${r.id} (${r.subject}, ${r.year})`);
    r.reasons.forEach(x => console.log(`      [${x.type}] ${x.detail}`));
  });

  console.log("\n═══════════════════════════════════════");
  console.log(`Total scanned: ${snap.size}`);
  console.log(`MERGE (structural, hide these): ${mergeFlagged.length}`);
  console.log(`SOFT (maybe fine, spot-check): ${softFlagged.length}`);
  console.log(`SYMBOL-only (content readable, chars wrong): ${symbolOnly.length}`);
  console.log(`Totally clean: ${snap.size - results.length}`);
  console.log("═══════════════════════════════════════");
  console.log("\n🛑 Scan only — nothing was changed.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
