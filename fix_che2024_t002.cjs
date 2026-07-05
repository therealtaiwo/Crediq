const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

db.collection("theoryQuestions").doc("CHE-2024-T002").update({ question: "" })
  .then(() => console.log("✅ Cleared CHE-2024-T002 redundant field"))
  .catch(e => console.error("💥", e));
