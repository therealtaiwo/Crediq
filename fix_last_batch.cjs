const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log("Applying final batch of fixes...\n");

  await db.collection("theoryQuestions").doc("MAT-2024-T010").update({
    question: "",
    subQuestions: [
      { part: "a", text: "Two tailoring companies P and Q earn ₦300 and ₦400 respectively per day. P can stitch 4 pants and 6 shirts while Q can stitch 4 pants and 10 shirts per day. (i) Set up a linear programming problem to minimize the cost of producing at least 28 units by company P and 30 units by company Q. (ii) With the aid of a graph, compute the minimum cost.", marks: 6 },
      { part: "b", text: "UNIBEN group of company had a beginning inventory of ₦800,000. In May 2021, it purchased and received goods worth ₦500,000, and had net sales of ₦900,000. If it maintained a 30% markup on sales: (i) compute cost of goods sold; (ii) estimate the ending inventory; (iii) calculate the inventory turnover at cost, correct to 2 decimal places.", marks: 7 },
      { part: "c", text: "A recent study shows that the cost of living in a city has been increasing by 4% a year. Calculate a family's monthly expected payment for 5 years if the current payment is ₦200,000.", marks: 2 },
    ],
    totalMarks: 15,
    needsReview: FieldValue.delete(),
  });
  console.log("✅ Fixed MAT-2024-T010");

  await db.collection("theoryQuestions").doc("AGR-2020-T006").update({
    subQuestions: [
      { part: "a", text: "Explain four methods of harvesting fish." },
      { part: "b", text: "Define the term Fishery regulation.", marks: 2 },
      { part: "c", text: "Explain four fishery regulations in Nigeria." },
    ],
  });
  console.log("✅ Fixed AGR-2020-T006");

  await db.collection("theoryQuestions").doc("AGR-2020-T007").update({
    subQuestions: [
      { part: "a", text: "(i) Explain four (4) channels of marketing farm produce. (ii) State two (2) functions of agricultural marketing." },
      { part: "b", text: "Mention two (2) problems of agricultural marketing.", marks: 2 },
    ],
    needsReview: FieldValue.delete(),
  });
  console.log("✅ Fixed AGR-2020-T007");

  await db.collection("theoryQuestions").doc("AGR-2020-T008").update({
    subQuestions: [
      { part: "a", text: "(i) Define the term agricultural extension. (ii) Mention two (2) qualities of a good extension worker. (iii) State four (4) functions of agricultural extension.", marks: 2 },
      { part: "b", text: "(i) Explain the roles of mass media on agricultural development in Nigeria. (ii) What are the three (3) factors affecting the rate of adoption of innovation in agriculture?" },
    ],
    needsReview: FieldValue.delete(),
  });
  console.log("✅ Fixed AGR-2020-T008");

  await db.collection("theoryQuestions").doc("CHE-2019-T005").update({
    question: "",
    subQuestions: [
      { part: "a", text: "(i) Define the term allotropy. (ii) Name two allotropes each of carbon and tin. (iii) What is the difference between the type of allotropy exhibited by carbon and tin?" },
      { part: "b", text: "Give reason(s) for the following observations: (i) Fluorine exhibits only the -1 oxidation state while other members of the group exhibit -1 as well as other oxidation states. (ii) Hydrogen chloride is a stronger acid than hydrogen fluoride. (iii) Beryllium does not react with water, even on heating." },
      { part: "c", text: "Using suitable reaction equations, outline three methods of laboratory synthesis of H2 from suitable metals." },
      { part: "d", text: "State three properties of transition elements." },
    ],
  });
  console.log("✅ Fixed CHE-2019-T005");

  await db.collection("theoryQuestions").doc("MAT-2020-T006").update({
    subQuestions: [
      { part: "a", text: "A 4kg ball moving with a velocity of 10m/s collides with a 16kg ball moving with a velocity of 4m/s in the opposite direction. Calculate the: (i) velocity of the balls if they coalesce on impact; (ii) loss of energy resulting from the impact.", marks: 6 },
      { part: "b", text: "If A = 4i − 5j + 3k, B = 2i − 10j − 7k and C = 5i + 7j − 4k, deduce the values of: (i) (A×B)·C and A×(B×C); (ii) unit vectors perpendicular to A and lying in the plane of B and C." },
      { part: "c", text: "A particle of mass 1.5kg is placed on a smooth plane inclined at an angle 30° to the horizontal. Find: (i) the acceleration of the object as it moves down the plane; (ii) the velocity attained after 3 seconds if it moves with an initial velocity of 5m/s. [Take g=10m/s²]" },
    ],
  });
  console.log("✅ Fixed MAT-2020-T006");

  await db.collection("theoryQuestions").doc("LIT-2025-T007").update({
    subQuestions: [
      { part: "a", text: "Describe the point of view employed in the narration." },
      { part: "b", text: "Discuss the cause of conflict in the excerpt." },
      { part: "c", text: "Apply objective criticism in discussing the portrayal of events and emotions in the excerpt." },
    ],
  });
  console.log("✅ Fixed LIT-2025-T007 (relabeled parts for consistency)");

  console.log("\nDone. Only PHY-2019-T004 (equation pending) and MAT-2019-T003 (garbled data table, needs page check) remain.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
