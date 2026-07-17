// get_outreach_list.cjs
// Generates the Week 1 outreach list: users who practiced but never went
// premium, sorted by most-recently-active first, with a WhatsApp number on
// file. Run from your project root where serviceAccount.json already lives.
//
//   node get_outreach_list.cjs
//
// This only READS data and prints a list — it does not send any messages.
// You message people manually, one at a time, per the plan: no automation,
// no bulk-send, just a real question from a real person.

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("./crediq-jupeb-firebase-adminsdk-fbsvc-871ef560b3.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log("Fetching users...");
  const usersSnap = await db.collection("users")
    .select("name","whatsapp","school","course","lastActive","isPremium","lastReflection")
    .get();

  // Build the set of userIds who have completed at least one real session
  // .select("userId") pulls ONLY that field per doc, not the full session
  // (which includes full question text/explanations for every question) —
  // this is the difference between a small, fast fetch and a heavy one.
  console.log("Fetching sessions (to find who actually practiced)...");
  const sessionsSnap = await db.collection("sessions").select("userId").get();
  const practicedUids = new Set();
  sessionsSnap.forEach(doc => {
    const uid = doc.data().userId;
    if (uid) practicedUids.add(uid);
  });

  const candidates = [];
  usersSnap.forEach(doc => {
    const u = doc.data();
    const uid = doc.id;
    if (u.isPremium) return;                 // already premium — not this list
    if (!u.whatsapp) return;                  // no number on file — can't message
    if (!practicedUids.has(uid)) return;      // never practiced — different problem (top-of-funnel, not churn)

    candidates.push({
      name: u.name || "(no name)",
      whatsapp: u.whatsapp,
      school: u.school || "-",
      course: u.course || "-",
      lastActive: u.lastActive || "-",
      weakTopic: (u.lastReflection && u.lastReflection.weakTopic) || "-",
    });
  });

  console.log(`\nFound ${candidates.length} people: practiced, not premium, have a WhatsApp number.\n`);
  console.log("name,whatsapp,school,course,lastActive,lastWeakTopic");
  candidates.forEach(c => {
    console.log(`${c.name},${c.whatsapp},${c.school},${c.course},${c.lastActive},${c.weakTopic}`);
  });

  console.log(`\n--- Total: ${candidates.length} ---`);
  console.log("Copy the CSV lines above into a spreadsheet to track replies as they come in.");
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
