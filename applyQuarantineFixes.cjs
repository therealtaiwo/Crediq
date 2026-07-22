#!/usr/bin/env node
/**
 * applyQuarantineFixes.cjs
 *
 * Reads quarantined-questions.csv and applies two kinds of fixes to the
 * "questions" collection in Firestore, where each docId in the CSV is the
 * literal Firestore document ID:
 *
 *   1. verdict is a resolved letter (A/B/C/D)
 *        -> updates correctAnswer on that document
 *        -> if the docId is in RECOVERED_CONTENT below, also updates
 *           question + explanation with the recovered excerpt text
 *
 *   2. action_needed is non-empty ("PULL FROM ROTATION - ...")
 *        -> sets isValid: false on that document, which the app's existing
 *           client-side filter already excludes from question pools —
 *           no app-code change needed, this alone hides it.
 *
 * Rows where verdict === "UNCLEAR" and action_needed is empty are left
 * untouched (nothing to apply yet).
 *
 * SAFETY: dry-run by default. Nothing is written to Firestore unless you
 * pass --apply. Always run without --apply first and read the output.
 *
 * ─── Setup ──────────────────────────────────────────────────────────────
 * 1. npm install firebase-admin
 * 2. Get a service account key from Firebase Console:
 *    Project Settings -> Service Accounts -> Generate new private key
 *    Save it somewhere OUTSIDE your git repo, e.g. ~/keys/serviceAccount.json
 * 3. Run:
 *      node applyQuarantineFixes.cjs quarantined-questions.csv \
 *        --key ~/keys/serviceAccount.json
 *    (dry run — prints every change it WOULD make, writes nothing)
 *
 *      node applyQuarantineFixes.cjs quarantined-questions.csv \
 *        --key ~/keys/serviceAccount.json --apply
 *    (writes for real)
 *
 * ─── Usage ──────────────────────────────────────────────────────────────
 *   node applyQuarantineFixes.cjs <csv-file> --key <path-to-service-account.json> [--apply] [--collection questions]
 */

const fs = require("fs");
const path = require("path");

// ── CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const keyIdx = args.indexOf("--key");
const keyPath = keyIdx !== -1 ? args[keyIdx + 1] : null;
const collIdx = args.indexOf("--collection");
const collectionName = collIdx !== -1 ? args[collIdx + 1] : "questions";
// csvPath is the first positional arg that isn't a flag and isn't a flag's value
const flagValues = new Set([keyPath, collIdx !== -1 ? args[collIdx + 1] : null]);
const csvPath = args.find(a => !a.startsWith("--") && !flagValues.has(a));

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error("Usage: node applyQuarantineFixes.cjs <csv-file> --key <service-account.json> [--apply]");
  console.error(`  CSV file not found: ${csvPath}`);
  process.exit(1);
}
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error("Usage: node applyQuarantineFixes.cjs <csv-file> --key <service-account.json> [--apply]");
  console.error(`  Service account key not found: ${keyPath}`);
  console.error("  Get one from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key");
  process.exit(1);
}

// ── Firebase Admin init ────────────────────────────────────────────────
const admin = require("firebase-admin");
const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(keyPath), "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Minimal CSV parser (handles quoted fields, embedded commas/newlines) ─
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip, \n handles the break */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  return rows
    .filter(r => r.length === headers.length && r.some(v => v !== ""))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

// ── The 6 LIT questions where we recovered the real excerpt text.
//    For these, question + explanation are pushed too, not just correctAnswer.
//    (Everything else only gets correctAnswer / isValid touched — we don't
//    want to silently overwrite question text we didn't actually verify.) ──
const RECOVERED_CONTENT = new Set([
  "LIT-2024-015", "LIT-2025-001", "LIT-2025-002",
  "LIT-2025-003", "LIT-2025-027", "LIT-2025-034",
]);

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(csvText);
  console.log(`Loaded ${rows.length} rows from ${csvPath}`);
  console.log(apply ? "*** LIVE MODE — will write to Firestore ***" : "--- DRY RUN — no writes will be made (pass --apply to write) ---");
  console.log("");

  let answerFixes = 0, contentFixes = 0, pulled = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    const docId = (row.docId || "").trim();
    const verdict = (row.verdict || "").trim();
    const actionNeeded = (row.action_needed || "").trim();

    if (!docId) continue;

    const update = {};
    let reason = [];

    if (actionNeeded) {
      update.isValid = false;
      reason.push(`PULL (isValid:false) — ${actionNeeded}`);
    } else if (verdict && verdict !== "UNCLEAR") {
      update.correctAnswer = verdict;
      reason.push(`correctAnswer -> ${verdict}`);
      if (RECOVERED_CONTENT.has(docId)) {
        update.question = row.question;
        update.explanation = row.explanation;
        reason.push("question + explanation updated with recovered excerpt");
      }
    } else {
      skipped++;
      continue; // UNCLEAR with no action_needed — nothing to do yet
    }

    console.log(`${docId}: ${reason.join(" | ")}`);

    if (apply) {
      try {
        await db.collection(collectionName).doc(docId).update(update);
        if (update.correctAnswer) answerFixes++;
        if (update.question) contentFixes++;
        if (update.isValid === false) pulled++;
      } catch (e) {
        console.error(`  ERROR writing ${docId}: ${e.message}`);
        errors++;
      }
    } else {
      if (update.correctAnswer) answerFixes++;
      if (update.question) contentFixes++;
      if (update.isValid === false) pulled++;
    }
  }

  console.log("");
  console.log("─".repeat(60));
  console.log(`${apply ? "Applied" : "Would apply"}:`);
  console.log(`  ${answerFixes} correctAnswer fixes`);
  console.log(`  ${contentFixes} question/explanation content recoveries`);
  console.log(`  ${pulled} questions pulled from rotation (isValid:false)`);
  console.log(`  ${skipped} rows skipped (still UNCLEAR, no action)`);
  if (errors) console.log(`  ${errors} ERRORS — see above`);
  if (!apply) console.log("\nRun again with --apply to actually write these to Firestore.");
}

main().catch(e => { console.error(e); process.exit(1); });
