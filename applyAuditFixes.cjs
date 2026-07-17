// applyAuditFixes.cjs
//
// Reads the CSV exported from Founder Dashboard → Audit tab → EXPORT CSV,
// and applies correctAnswer fixes to Firestore for every row you've marked
// "approved" = yes.
//
// SAFE BY DEFAULT: runs as a DRY RUN unless you pass --apply. Dry run prints
// exactly what it WOULD change without touching Firestore — always run
// without --apply first and read the output before applying anything.
//
// Usage:
//   node applyAuditFixes.cjs reviewed.csv                → dry run (safe, no writes)
//   node applyAuditFixes.cjs reviewed.csv --apply         → actually writes to Firestore
//
// Requires:
//   npm install firebase-admin
//   A Firebase service account key JSON file (Firebase Console → Project
//   Settings → Service Accounts → Generate new private key). Keep this file
//   OUTSIDE your git repo — never commit it.
//
// Set the path to your service account key here, or via env var:
//   SERVICE_ACCOUNT_PATH=/path/to/key.json node applyAuditFixes.cjs reviewed.csv --apply

const fs = require("fs");
const path = require("path");
// firebase-admin is only required in --apply mode — dry runs need zero deps

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith("--"));
const isApply = args.includes("--apply");

if (!csvPath) {
  console.error("Usage: node applyAuditFixes.cjs <reviewed.csv> [--apply]");
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

// ── Minimal CSV parser — handles quoted fields with embedded commas/quotes ──
// (matches the quoting style the app's exportCSV uses: "field","field with ""quotes""")
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field.length || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
        if (c === "\r" && next === "\n") i++;
      } else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(csvPath, "utf8");
const parsed = parseCSV(raw);
const headers = parsed[0];
const dataRows = parsed.slice(1).filter(r => r.length === headers.length && r.some(c => c.trim().length));

const rows = dataRows.map(r => {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = r[i]; });
  return obj;
});

const toApply = rows.filter(r => {
  const a = (r.approved || "").trim().toLowerCase();
  return a === "yes" || a === "y" || a === "true";
});

console.log(`\nRead ${rows.length} rows from ${csvPath}`);
console.log(`${toApply.length} rows marked approved and ready to apply.\n`);

if (!toApply.length) {
  console.log("Nothing to do — mark rows with 'yes' in the approved column first.");
  process.exit(0);
}

if (!isApply) {
  console.log("── DRY RUN — no changes will be made. Add --apply to actually write to Firestore. ──\n");
  toApply.forEach((r, i) => {
    console.log(`${i + 1}. [${r.type}] ${r.collection}/${r.docId} (${r.subject}${r.topic ? " · " + r.topic : ""})`);
    console.log(`   Question: ${r.question}`);
    console.log(`   ${r.currentCorrect} ("${r.currentCorrectText}") → ${r.suggestedCorrect} ("${r.suggestedCorrectText}")`);
    console.log(`   Evidence: ${r.evidence}\n`);
  });
  console.log(`Dry run complete. ${toApply.length} question(s) would be updated.`);
  console.log(`Re-run with --apply once you've verified this list looks right.`);
  process.exit(0);
}

// ── APPLY MODE — actually writes to Firestore ──
let admin;
try {
  admin = require("firebase-admin");
} catch {
  console.error(`\nMissing dependency: firebase-admin`);
  console.error(`Run this first: npm install firebase-admin`);
  console.error(`(Run it from your crediq project folder, where node_modules already lives.)`);
  process.exit(1);
}
const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || path.join(__dirname, "serviceAccount.json");
if (!fs.existsSync(serviceAccountPath)) {
  console.error(`\nService account key not found at: ${serviceAccountPath}`);
  console.error(`Set SERVICE_ACCOUNT_PATH env var to point to your key file, e.g.:`);
  console.error(`  SERVICE_ACCOUNT_PATH=~/keys/crediq-key.json node applyAuditFixes.cjs ${csvPath} --apply`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.cert(require(serviceAccountPath)),
});
const db = require('firebase-admin/firestore').getFirestore();

(async () => {
  console.log(`── APPLYING ${toApply.length} fix(es) to Firestore ──\n`);
  let success = 0, failed = 0;
  for (const r of toApply) {
    try {
      await db.collection(r.collection).doc(r.docId).update({
        correctAnswer: r.suggestedCorrect,
        auditFixedAt: require('firebase-admin/firestore').FieldValue.serverTimestamp(),
        auditFixedFrom: r.currentCorrect,
      });
      console.log(`✓ ${r.collection}/${r.docId} → correctAnswer set to ${r.suggestedCorrect}`);
      success++;
    } catch (e) {
      console.error(`✗ ${r.collection}/${r.docId} — FAILED: ${e.message}`);
      failed++;
    }
  }
  console.log(`\nDone. ${success} updated, ${failed} failed.`);
  process.exit(0);
})();
