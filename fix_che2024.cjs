const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const fixes = [
  {
    id: "CHE-2024-T001",
    subQuestions: [
      { part: "a", text: "Define the following terms and state their units in each case: (i) Molality (ii) Molarity", marks: 2 },
      { part: "b", text: "What is the frequency and wavelength of a photon emitted during transition of a hydrogen atom from the ni = 5 state to the nf = 2 state? [RH = 2.18 × 10⁻¹⁸J, h = 6.63 × 10⁻³⁴Js, c = 3.00 × 10⁸ m/s]", marks: 3 },
      { part: "c", text: "State whether a reaction will occur or not among the following pairs and write the molecular, total ionic, and net ionic equations where applicable: (i) Sodium sulphate (Na2SO4) solution + strontium nitrate (Sr(NO3)2) solution (ii) Ammonium perchlorate (NH4ClO4) solution and sodium bromide (NaBr) solution", marks: 3 },
      { part: "d", text: "Determine the oxidation number of Zinc in the following compounds: (i) Zn(NH3)4SO4 (ii) [Zn(NH3)5Cl]2-", marks: 2 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2024-T003",
    subQuestions: [
      { part: "a", text: "(i) What is meant by the term half-life of a radioactive element? (ii) State any THREE parameters that can be used to determine the stability of nuclides.", marks: 2.5 },
      { part: "b", text: "Given that the half-life of cobalt-60 is 6.0 years, calculate the (i) decay constant in per seconds (ii) activity of a 1.0 mg sample of cobalt-60.", marks: 4.5 },
      { part: "c", text: "Define the following thermodynamic terms: (i) Entropy (ii) Gibb's free energy (iii) Enthalpy", marks: 3 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2024-T005",
    subQuestions: [
      { part: "a", text: "Give a reason each for the following: (i) Electronegativity increases from left to right in the periodic table. (ii) Ionisation enthalpy decreases down a group. (iii) Helium has electronic configuration of 1s² but it is placed in the p-block in group 18.", marks: 3 },
      { part: "b", text: "Account for why: (i) the second ionization energy of alkali metals is higher than that of alkaline earth metals; (ii) the solution of alkali metals in liquid ammonia is conducting in nature; (iii) HF is the weakest acid among haloacids despite F being the most electronegative.", marks: 3 },
      { part: "c", text: "Using appropriate chemical equations, show what happens when Calcium is treated with: (i) Nitrogen (ii) dilute tetraoxosulphate (VI) acid.", marks: 2 },
      { part: "d", text: "What is the oxidation state of Co in the complex [Co(NH3)2(NO2)Cl][Au(CN)2]?", marks: 2 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2024-T006",
    subQuestions: [
      { part: "a", text: "Write the correct formula for the following compounds: (i) CrCl3·6H2O (violet, with three chloride ions/unit formula) (ii) CrCl3·6H2O (light green, with two chloride ions/unit formula) (iii) CrCl3·6H2O (dark green, with one chloride ion/unit formula)", marks: 3 },
      { part: "b", text: "Arrange the following complexes in order of increasing electrical conductivity: [Co(NH3)3Cl3]; [Co(NH3)5Cl]Cl2; [Co(NH3)6]Cl3; [Co(NH3)4Cl2]Cl.", marks: 2 },
      { part: "c", text: "Hydrogen forms compounds with elements W, X, Y and Z having atomic numbers 9, 11, 12 and 17 respectively. (i) Write a balanced chemical equation for the formation of each of the compounds above. (ii) What type of hydride is each of the compounds in (i) above?", marks: 3 },
      { part: "d", text: "Write the formula of the complexes formed by Fe2+ with the following ligands: (i) one hydroxyl ion, two ammonia molecules and three chloride ions. (ii) three cyanide ions and three ammonia molecules.", marks: 2 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2024-T007",
    subQuestions: [
      { part: "a", text: "Differentiate between the following sets of terms: (i) Thermoplastics and Thermosets (ii) Natural and Synthetic polymers (iii) Addition and condensation polymers", marks: 3 },
      { part: "b", text: "(i) List the characteristic reactions Alkyl Halides undergo. (ii) Give ONE equation each for the reactions listed in (i) above. (iii) Write the equation to show the reaction of methyl iodide with aqueous potassium hydroxide.", marks: 3.5 },
      { part: "c", text: "Give the IUPAC nomenclature of the following compounds: (i) CH3CH2CHICONH2 (ii) Cl(C6H5)COOH (iii) CH3CH2COOCH2CH3", marks: 1.5 },
      { part: "d", text: "Give reasons for the following observations: (i) Alkynes generally have higher boiling points than corresponding alkenes. (ii) Benzenes readily undergo substitution reactions instead of addition reactions.", marks: 2 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2024-T008",
    subQuestions: [
      { part: "a", text: "Sodium hydroxide solution was mixed in three different vessels A, B, C containing haloalkanes. The mixture was acidified with dilute nitric acid, followed by silver nitrate solution. The precipitates obtained in vessels A, B and C were yellow, white and pale yellow respectively. (i) Identify the halide ions present in each vessel. (ii) Arrange the halide ions in their order of increasing reactivity.", marks: 2 },
      { part: "b", text: "Consider the reaction: CH3CH2CHClCH3 + KOH (alcohol) → A + B. (i) Draw the structure and give the names of A and B. (ii) What product will be formed if the reaction proceeds without the alcohol?", marks: 3 },
      { part: "c", text: "Calculate the specific activity of a 600 g sample of organic compound per litre of solution placed in a cell of 0.2 dm path length with observed rotation of +1.2° at sodium D-line.", marks: 2 },
      { part: "d", text: "Give the major products of the following reactions: (i) C6H5COCl reacted with LiAlH4 (ii) C2H5CONH2 + NaOH (iii) CH3COCH3 + CH3COCH3", marks: 3 },
    ],
    totalMarks: 10,
  },
];

async function main() {
  console.log(`Applying ${fixes.length} Chemistry 2024 fixes...\n`);
  for (const fix of fixes) {
    await db.collection("theoryQuestions").doc(fix.id).update({
      subQuestions: fix.subQuestions,
      totalMarks: fix.totalMarks,
      question: "",
      needsReview: FieldValue.delete(),
    });
    console.log(`✅ Fixed ${fix.id}`);
  }
  console.log("\nDone.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
