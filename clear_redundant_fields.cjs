const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// These all have accurate subQuestions content (verified against source PDF text layer) —
// the math-unicode flag was a false positive on legitimate italic math styling (𝒗, 𝒊, 𝑇, etc).
// Only the redundant duplicate top-level "question" field needs clearing.
const ids = ["PHY-2024-T008", "PHY-2024-T001", "PHY-2024-T007"];

async function main() {
  for (const id of ids) {
    await db.collection("theoryQuestions").doc(id).update({ question: "" });
    console.log(`✅ Cleared redundant question field: ${id}`);
  }
  console.log("\nDone.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
