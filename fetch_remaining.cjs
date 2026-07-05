const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const IDS = [
  "MAT-2024-T010", "AGR-2020-T007", "AGR-2020-T008", "AGR-2020-T006",
  "CHE-2019-T005", "CHE-2021-T004", "LIT-2025-T007", "MAT-2019-T003", "MAT-2020-T006"
];

async function main() {
  for (const id of IDS) {
    const doc = await db.collection("theoryQuestions").doc(id).get();
    if (!doc.exists) { console.log(`❌ ${id} not found\n`); continue; }
    const q = doc.data();
    console.log(`══════ ${id} ══════`);
    if (q.question) console.log(`[question] ${q.question}\n`);
    (q.subQuestions || []).forEach(sq => {
      console.log(`[${sq.part}] ${sq.text}`);
      if (sq.answer) console.log(`  [answer] ${sq.answer}`);
    });
    console.log("");
  }
}
main().catch(e => { console.error("💥", e); process.exit(1); });
