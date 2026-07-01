const cloudinary = require("cloudinary").v2;
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

cloudinary.config({
  cloud_name: "dpnwo465m",
  api_key: "827222213279732",
  api_secret: "GeNNKMfVS_6G1UNrkqxVCc59dkk"
});

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const HOME = process.env.HOME || "/data/data/com.termux/files/home";
const DIAGRAMS_DIR = path.join(HOME, "diagrams");

const SINGLE = [
  { id: "MAT-2019-T001", folder: "2019_MAT", page: 11 },
  { id: "PHY-2021-T006", folder: "2021_PHY", page: 15 },
  { id: "GEO-2022-T005", folder: "2022_GEO", page: 14 },
  { id: "GEO-2022-T006", folder: "2022_GEO", page: 15 },
  { id: "BIO-2024-T001", folder: "2024_BIO", page: 10 },
  { id: "GEO-2024-T002", folder: "2024_GEO", page: 13 },
  { id: "GEO-2024-T005", folder: "2024_GEO", page: 14 },
  { id: "PHY-2025-T002", folder: "2025_PHY", page: 17 },
];

const MULTI = [
  { id: "PHY-2020-T005", folder: "2020_PHY", pages: [14, 16, 18] },
];

function pagePath(folder, page) {
  return path.join(DIAGRAMS_DIR, folder, "page-" + String(page).padStart(2,"0") + ".jpg");
}

async function uploadSingle({ id, folder, page }) {
  const local = pagePath(folder, page);
  if (!fs.existsSync(local)) { console.error("❌ [" + id + "] Not found: " + local); return false; }
  try {
    const res = await cloudinary.uploader.upload(local, { public_id: "crediq/diagrams/" + id, overwrite: true });
    await db.collection("theoryQuestions").doc(id).set(
      { diagramUrl: res.secure_url, diagramUploaded: true, has_diagram: true }, { merge: true }
    );
    console.log("✅ [" + id + "] " + res.secure_url);
    return true;
  } catch(e) { console.error("❌ [" + id + "] " + e.message); return false; }
}

async function uploadMulti({ id, folder, pages }) {
  const urls = [];
  for (const page of pages) {
    const local = pagePath(folder, page);
    if (!fs.existsSync(local)) { console.error("❌ [" + id + "] p" + page + " not found"); continue; }
    try {
      const res = await cloudinary.uploader.upload(local, { public_id: "crediq/diagrams/" + id + "_p" + page, overwrite: true });
      urls.push(res.secure_url);
      console.log("  ↑ [" + id + "] page " + page);
    } catch(e) { console.error("❌ [" + id + "] p" + page + ": " + e.message); }
  }
  if (!urls.length) return false;
  try {
    await db.collection("theoryQuestions").doc(id).set(
      { diagramUrl: urls[0], diagramUrls: urls, diagramUploaded: true, has_diagram: true }, { merge: true }
    );
    console.log("✅ [" + id + "] " + urls.length + " pages");
    return true;
  } catch(e) { console.error("❌ [" + id + "] " + e.message); return false; }
}

async function main() {
  console.log("\n📤 CrediQ Diagram Upload via Cloudinary\n");
  let ok = 0, fail = 0;
  for (const d of SINGLE) { (await uploadSingle(d)) ? ok++ : fail++; await new Promise(r=>setTimeout(r,500)); }
  for (const d of MULTI)  { (await uploadMulti(d))  ? ok++ : fail++; await new Promise(r=>setTimeout(r,500)); }
  console.log("\n✅ " + ok + " done  ❌ " + fail + " failed");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
