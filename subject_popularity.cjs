const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Only the subjects that actually have flagged theory-question issues
const AFFECTED_SUBJECTS = [
  "Agricultural Science", "Biology", "Chemistry",
  "Geography", "Literature in English", "Mathematics", "Physics"
];

async function main() {
  console.log("📥 Fetching users (capped at 500, same as dashboard)...");
  const snap = await db.collection("users").limit(500).get();
  console.log(`   Found ${snap.size} users\n`);

  const counts = {};
  AFFECTED_SUBJECTS.forEach(s => counts[s] = 0);
  let totalWithSubjects = 0;

  snap.docs.forEach(d => {
    const subs = d.data().subjects || [];
    if (subs.length > 0) totalWithSubjects++;
    subs.forEach(s => {
      if (counts.hasOwnProperty(s)) counts[s]++;
    });
  });

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  console.log("═══════════════════════════════════════");
  console.log(`Ranked by number of students who selected each subject:\n`);
  ranked.forEach(([subject, count], i) => {
    const pct = totalWithSubjects > 0 ? ((count / totalWithSubjects) * 100).toFixed(1) : 0;
    console.log(`  ${i + 1}. ${subject}: ${count} students (${pct}%)`);
  });
  console.log("═══════════════════════════════════════");
  console.log(`\nTotal users with subjects selected: ${totalWithSubjects}`);
}

main().catch(e => { console.error("💥", e); process.exit(1); });
