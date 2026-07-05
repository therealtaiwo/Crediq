const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log("Applying Biology, Math, Geography fixes...\n");

  // ── BIOLOGY 2019 — genuine 5-question merge, split into separate docs ──
  await db.collection("theoryQuestions").doc("BIO-2019-T010").update({
    question: "",
    topic: "Ferns & Selaginella (Botany)",
    subQuestions: [
      { part: "a", text: "Outline eight (8) general characteristics of ferns." },
      { part: "b", text: "With the aid of a diagram only, describe the life cycle of Selaginella." },
    ],
    has_diagram: true,
    needsReview: FieldValue.delete(),
  });
  console.log("✅ Fixed BIO-2019-T010 (Q4 — Ferns & Selaginella)");

  await db.collection("theoryQuestions").doc("BIO-2019-T010B").set({
    id: "BIO-2019-T010B", subject: "Biology", subjectCode: "BIO", year: 2019,
    examType: "THEORY", paperNumber: 2, source: "JUPEB", isValid: true, cleaned: true,
    topic: "Archaea & Microorganisms (Microbiology)",
    has_diagram: false,
    tags: ["biology", "2019", "jupeb", "theory", "microbiology", "archaea"],
    subQuestions: [
      { part: "a", text: "State the following characteristics of the Archaea: (i) Mesophiles (ii) Halophiles (iii) Acidophiles (iv) Alkaliphiles (v) Thermophiles." },
      { part: "b", text: "Highlight five (5) biotechnological or beneficial uses of microorganisms." },
    ],
  }, { merge: true });
  console.log("✅ Created BIO-2019-T010B (Q5 — Archaea & Microorganisms)");

  await db.collection("theoryQuestions").doc("BIO-2019-T010C").set({
    id: "BIO-2019-T010C", subject: "Biology", subjectCode: "BIO", year: 2019,
    examType: "THEORY", paperNumber: 2, source: "JUPEB", isValid: true, cleaned: true,
    topic: "Microbial Growth & Prokaryotes (Microbiology)",
    has_diagram: true,
    tags: ["biology", "2019", "jupeb", "theory", "microbiology", "prokaryotes"],
    subQuestions: [
      { part: "a", text: "List two (2) media that are used for the growth of microorganisms in the laboratory." },
      { part: "b", text: "Briefly write on the structures that prokaryotes use for attachment." },
      { part: "c", text: "With illustration, describe the events in each stage of a microbial growth curve of a batch culture." },
    ],
  }, { merge: true });
  console.log("✅ Created BIO-2019-T010C (Q6 — Microbial Growth & Prokaryotes)");

  await db.collection("theoryQuestions").doc("BIO-2019-T010D").set({
    id: "BIO-2019-T010D", subject: "Biology", subjectCode: "BIO", year: 2019,
    examType: "THEORY", paperNumber: 2, source: "JUPEB", isValid: true, cleaned: true,
    topic: "Plasmodium (Parasitology)",
    has_diagram: false,
    tags: ["biology", "2019", "jupeb", "theory", "zoology", "plasmodium"],
    subQuestions: [
      { part: "a", text: "Describe the life cycle of Plasmodium in man." },
      { part: "b", text: "Mention four (4) economic importance of Plasmodium." },
    ],
  }, { merge: true });
  console.log("✅ Created BIO-2019-T010D (Q7 — Plasmodium)");

  await db.collection("theoryQuestions").doc("BIO-2019-T010E").set({
    id: "BIO-2019-T010E", subject: "Biology", subjectCode: "BIO", year: 2019,
    examType: "THEORY", paperNumber: 2, source: "JUPEB", isValid: true, cleaned: true,
    topic: "Reptilia & Adaptations (Zoology)",
    has_diagram: false,
    tags: ["biology", "2019", "jupeb", "theory", "zoology", "reptilia"],
    subQuestions: [
      { part: "a", text: "List ten (10) characteristics of the Class Reptilia." },
      { part: "b", text: "Itemize five (5) adaptations of animals in transition from water to land." },
    ],
  }, { merge: true });
  console.log("✅ Created BIO-2019-T010E (Q8 — Reptilia & Adaptations)");

  // ── MATHEMATICS 2020 — flattening bug, not a real merge ──
  await db.collection("theoryQuestions").doc("MAT-2020-T005").update({
    question: "",
    subQuestions: [
      { part: "a", text: "Given p(t) = eᵗ; u(t) = sin(t)i + cos(t)j + 3k; v(t) = ti − 2k. Find: (i) u·v (ii) |u×v|" },
      { part: "b", text: "A load of mass 50kg is placed in a lift. Calculate the reaction between the floor of the lift and the load when the lift: (i) is moving at a constant speed; (ii) moves upwards with an acceleration of 3m/s²." },
      { part: "c", text: "A body of mass 8.2kg is supported by two light inextensible strings attached to it. The other ends of the strings are attached to two fixed points in a ceiling, 10m apart. One string is 6m long and the other is 8m long. Assuming the system is in equilibrium, calculate: (i) the angle made by each string to the horizontal; (ii) the tension in each string. (Take g=10m/s²)" },
    ],
    needsReview: FieldValue.delete(),
  });
  console.log("✅ Fixed MAT-2020-T005");

  // ── GEOGRAPHY 2024 — flattening bug, redundant duplicate question field ──
  await db.collection("theoryQuestions").doc("GEO-2024-T001").update({
    question: "",
    subQuestions: [
      { part: "a", text: "Mention the layers that make up the atmosphere.", marks: 2.5 },
      { part: "b", text: "Using suitable diagrams, describe the following: (i) Convergent boundary [3 Marks] (ii) Divergent boundary [3 Marks] (iii) Transform plate boundary [3 Marks]", marks: 9 },
      { part: "c", text: "Convert the following weather readings: (i) 25°C to Fahrenheit [1 Mark] (ii) 50°F to Celsius [1 Mark] (iii) 66.5°F to Celsius [1.5 Marks]", marks: 3.5 },
    ],
    totalMarks: 15,
    has_diagram: true,
    needsReview: FieldValue.delete(),
  });
  console.log("✅ Fixed GEO-2024-T001");

  console.log("\nDone. All remaining merges resolved.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
