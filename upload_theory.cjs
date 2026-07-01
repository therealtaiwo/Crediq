const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const FILES = [
  "jupeb2019_theory.json",
  "jupeb2020_theory-2.json",
  "jupeb_2021_theory-1.json",
  "jupeb_2022_theory-3.json",
  "jupeb_theory_questions.json",
  "JUPEB_2025_Theory_Questions.json",
];

// Paper names by subject + number
const PAPER_NAMES = {
  PHY: { 1:"Mechanics & Properties of Matter", 2:"Heat, Waves & Optics", 3:"Electricity & Magnetism", 4:"Modern Physics" },
  CHM: { 1:"General Chemistry", 2:"Physical Chemistry", 3:"Inorganic Chemistry", 4:"Organic Chemistry" },
  BIO: { 1:"General Biology", 2:"Basic Botany", 3:"Microbiology", 4:"Introductory Zoology" },
  MAT: { 1:"Advanced Pure Mathematics", 2:"Calculus", 3:"Applied Mathematics", 4:"Statistics" },
  MFS: { 1:"Advanced Pure Mathematics", 2:"Calculus", 3:"Applied Mathematics", 4:"Statistics" },
  MFB: { 1:"Business Mathematics I", 2:"Business Mathematics II", 3:"Statistics", 4:"Quantitative Methods" },
  ECO: { 1:"Microeconomics", 2:"Macroeconomics", 3:"Development Economics", 4:"Applied Economics" },
  ACC: { 1:"Basic Financial Accounting", 2:"Financial Accounting II", 3:"Cost Accounting", 4:"Nigerian Taxation" },
  GOV: { 1:"Nigerian Government", 2:"Comparative Politics", 3:"International Relations", 4:"Public Administration" },
  GRY: { 1:"Physical Geography", 2:"Human & Economic Geography", 3:"Map Reading & GIS", 4:"Regional Geography" },
  AGR: { 1:"Soil Science", 2:"Crop Science", 3:"Animal Science", 4:"Agricultural Economics" },
  BST: { 1:"Business Environment", 2:"Business Organisation", 3:"Business Finance", 4:"Marketing" },
  LIT: { 1:"Oral Literature", 2:"Poetry", 3:"Prose Fiction", 4:"Drama" },
  CRS: { 1:"Old Testament", 2:"New Testament", 3:"Church History", 4:"Christian Ethics" },
  ISS: { 1:"Quran Studies", 2:"Hadith", 3:"Islamic History", 4:"Islamic Jurisprudence" },
  HIS: { 1:"Pre-Colonial Africa", 2:"Colonial Africa", 3:"Post-Colonial Africa", 4:"World History" },
  MUS: { 1:"Theory of Music", 2:"African Music", 3:"Western Music", 4:"Music Appreciation" },
  FRE: { 1:"Oral French", 2:"Grammar", 3:"Composition", 4:"Literature" },
  IGB: { 1:"Oral Igbo", 2:"Grammar", 3:"Composition", 4:"Literature" },
  YOR: { 1:"Oral Yoruba", 2:"Grammar", 3:"Composition", 4:"Literature" },
  VAR: { 1:"Drawing", 2:"Painting", 3:"Sculpture", 4:"Design" },
};

function getPaperName(subjectCode, paperNumber) {
  const code = subjectCode?.toUpperCase();
  const map = PAPER_NAMES[code];
  if (map && paperNumber && map[paperNumber]) return map[paperNumber];
  return `Paper ${String(paperNumber).padStart(3,"0")}`;
}

function cleanQuestion(q) {
  const paper = q.paperNumber || 1;
  const code = (q.subjectCode || "").toUpperCase();
  return {
    id: q.id,
    subject: q.subject || "",
    subjectCode: code,
    year: q.year || 0,
    examType: "THEORY",
    paper: String(paper).padStart(3,"0"),
    paperNumber: paper,
    paperName: getPaperName(code, paper),
    question: q.question || "",
    subQuestions: (q.subQuestions || []).map(sq => ({
      part: sq.part || "",
      text: sq.text || "",
      marks: sq.marks || 0,
      answer: sq.answer || "",
    })),
    totalMarks: q.totalMarks || (q.subQuestions || []).reduce((s,sq)=>s+(sq.marks||0),0) || 0,
    topic: q.topic || "",
    tags: q.tags || [],
    has_diagram: q.has_diagram || false,
    diagramUrl: q.diagramUrl || null,
    diagramUrls: q.diagramUrls || null,
    diagramUploaded: q.diagramUploaded || false,
    status: "active",
    source: q.source || "",
  };
}

async function uploadBatch(questions) {
  const BATCH_SIZE = 400; // Firestore limit is 500
  let uploaded = 0;

  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const chunk = questions.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(q => {
      const ref = db.collection("theoryQuestions").doc(q.id);
      batch.set(ref, q, { merge: true });
    });
    await batch.commit();
    uploaded += chunk.length;
    console.log(`  Uploaded ${uploaded}/${questions.length}...`);
  }
}

async function main() {
  console.log("\n📚 CrediQ Theory Questions Upload\n");

  // Load and deduplicate
  const dataDir = process.env.HOME + "/storage/downloads";
  const seen = {};
  const questions = [];

  for (const fname of FILES) {
    const fpath = path.join(dataDir, fname);
    if (!fs.existsSync(fpath)) {
      console.warn(`⚠️  Not found: ${fpath} — skipping`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(fpath, "utf8"));
    let added = 0;
    for (const q of data) {
      if (!seen[q.id]) {
        seen[q.id] = true;
        questions.push(cleanQuestion(q));
        added++;
      }
    }
    console.log(`✅ ${fname}: ${added} questions loaded`);
  }

  console.log(`\nTotal unique questions: ${questions.length}`);
  console.log("Uploading to Firestore theoryQuestions collection...\n");

  await uploadBatch(questions);

  console.log(`\n✅ Done! ${questions.length} theory questions uploaded.`);
  console.log("Collection: theoryQuestions");
  process.exit(0);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
