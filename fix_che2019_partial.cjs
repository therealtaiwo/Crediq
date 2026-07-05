const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const fixes = [
  {
    action: "update",
    id: "CHE-2019-T002",
    data: {
      subQuestions: [
        { part: "a", text: "(i) Define the term ionization energy. (ii) State two factors that affect ionization energy of an atom.", marks: 2 },
        {
          part: "b",
          text: "500 mg of iron (II) complex ferrous bisglycinate hydrochloride was dissolved in dilute H2SO4 and titrated with 0.0200 mol.dm⁻³ KMnO4. 18.10 cm³ of KMnO4 solution were required to reach the end point. The equation for the titration reaction is: 5Fe²⁺ + MnO4⁻ + 8H⁺ → 5Fe³⁺ + Mn²⁺ + 4H2O. Calculate the: (i) number of moles of Fe²⁺ in the capsule; (ii) mass of iron in the capsule; (iii) molar mass of the iron (II) complex, assuming 1 mole of the complex contains 1 mole of iron. (Fe = 55.9 g/mol).",
          marks: 3.5,
        },
        {
          part: "c",
          text: "Identify each of the following reactions as precipitation, neutralization, decomposition or combination: (i) Ba(OH)2(aq) + 2HI(aq) → BaI2(aq) + 2H2O(l) (ii) 2Al(s) + 3Cl2(g) → 2AlCl3(s) (iii) Pd(NO3)2(aq) + H2S(g) → PdS(s) + 2HNO3(aq) (iv) Cu(NO3)2(aq) → CuO(s) + NO2(g) + ½O2(g) (v) FeCl2(aq) + 2NaOH(aq) → Fe(OH)2(s) + 2NaCl(aq)",
          marks: 2.5,
        },
        {
          part: "d",
          text: "The following results were obtained from a replicate analysis of a blood sample for its lead content: 0.752, 0.756, 0.752, 0.769 ppm lead. Explain the precision of the results.",
          marks: 2,
        },
      ],
      totalMarks: 10,
      topic: "Ionization Energy & Redox Titration",
    },
  },
  {
    action: "update",
    id: "CHE-2019-T003",
    data: {
      subQuestions: [
        { part: "a", text: "(i) State the two factors that affect the solubility of a solid in a liquid. (ii) A saturated solution of AgCl was found to have a concentration of 1.3×10⁻⁵ mol/dm³. What is the solubility product of AgCl?", marks: 2.5 },
        { part: "b", text: "Define the term (i) entropy (ii) enthalpy.", marks: 2 },
        {
          part: "c",
          text: "The equation for the reaction between sulphur trioxide and CuO is: CuO(s) + SO3(g) → CuSO4(s). Given the following data — SO3: ΔH° = -157 kJ/mol, S° = 42.63 J/Kmol; CuO: ΔH° = -395.2 kJ/mol, S° = 256.2 J/Kmol; CuSO4: ΔH° = -771.36 kJ/mol, S° = 109 J/Kmol — (i) Calculate the standard free energy for this reaction at 37°C. (ii) Comment on the spontaneity of the reaction based on the value in (i).",
          marks: 3,
        },
        {
          part: "d",
          text: "If the same volume of NH3 and an unknown gas X effuse at a rate of 2.25 cm³s⁻¹ and 1.40 cm³s⁻¹ respectively under the same experimental conditions, what is the molecular mass (Mr) for X? Suggest a possible identity for X. [N=14, H=1.00]",
          marks: 2.5,
        },
      ],
      totalMarks: 10,
      topic: "Solubility, Thermodynamics & Gas Effusion",
      needsReview: FieldValue.delete(),
    },
  },
];

async function main() {
  console.log(`Applying ${fixes.length} confirmed Chemistry 2019 fixes...\n`);
  for (const fix of fixes) {
    await db.collection("theoryQuestions").doc(fix.id).update(fix.data);
    console.log(`✅ Updated ${fix.id}`);
  }
  console.log("\nDone. T003B (second merged question) and T005 still pending verification.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
