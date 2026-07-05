const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const fixes = [
  {
    id: "CHE-2020-T001",
    subQuestions: [
      { part: "a", text: "The phase diagram above is for a one-component system, Z. (i) What is Tc? (ii) Under what condition will Z sublime? (iii) What phase does Z exist as at 298K and 10⁵Pa?", marks: 3 },
      { part: "b", text: "The atomic mass of a naturally occurring element Y is 55.8. The masses of the isotopes of the element are 54Y and 57Y. (i) Calculate the percentage abundance of each isotope. (ii) Deduce the isotopic mass ratio.", marks: 3 },
      { part: "c", text: "Balance the redox reaction below in alkaline medium and identify the oxidizing and reducing agents: I⁻ + MnO4⁻ → IO3⁻ + MnO2", marks: 4 },
    ],
    totalMarks: 10,
    has_diagram: true,
  },
  {
    id: "CHE-2020-T002",
    subQuestions: [
      { part: "a", text: "In an experiment, 15.0g of methanol and 10.0g of carbon (II) oxide were placed in a reaction vessel. [C=12, H=1, O=16] CH3OH(l) + CO(g) → HC2H3O2(l). (i) Determine which reactant is the limiting reactant. (ii) From (i) above, calculate the theoretical yield of acetic acid. (iii) If the actual yield is 19.1g, what is the percentage yield?", marks: 4 },
      { part: "b", text: "(i) Distinguish between a polar and non-polar molecule. (ii) State which of the following molecules is/are polar or non-polar: (a) CCl4 (b) HF (c) CO2 (d) CHCl3", marks: 3 },
      { part: "c", text: "(i) Define the term degeneracy as it applies to atomic orbitals. (ii) Give the values of the azimuthal and magnetic quantum numbers of the electrons in an atom when n=4.", marks: 3 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2020-T004",
    subQuestions: [
      { part: "a", text: "2 g of He, 3 g of N2 and 4 g of Ar were introduced into a 15 dm³ vessel at 100°C. (i) What are the mole fractions of He, N2 and Ar in the system? (ii) Calculate the total pressure of the system and hence the partial pressures of each of the gases in the vessel. [1atm=101325Nm⁻², He=4.0, N=14.0, Ar=39.9]", marks: 4 },
      { part: "b", text: "The dissociation constant for an acid is a measure of its strength. (i) Use the information below to arrange the following acids in order of increasing acidity: CH3CH2COOH (Ka=1.259×10⁻⁵), CH3CHClCOOH (Ka=1.585×10⁻³), CH3CCl2COOH (Ka=3.982×10⁻²), CH2ClCH2COOH (Ka=7.943×10⁻⁵). (ii) Suggest a reason for your arrangement.", marks: 2 },
      { part: "c", text: "(i) Differentiate between ideal and non-ideal solutions. (ii) How does the solution of a non-volatile solute affect the following properties: (a) Vapour pressure lowering (b) Freezing point depression?", marks: 4 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2020-T005",
    subQuestions: [
      { part: "a", text: "(i) Use balanced chemical equations to illustrate what happens when the following compounds are added to water: (a) NaCl (b) SO3 (c) Al2O3 (d) Na2O. (ii) Predict the pH of the solutions.", marks: 4 },
      { part: "b", text: "(i) Explain, giving reasons, the trend in the solubility of group 2 sulphates. (ii) Arrange the sulphates in order of increasing solubility.", marks: 3 },
      { part: "c", text: "(i) List four (4) greenhouse gases. (ii) State the source of environmental impact of any two of the gases listed in (i) above.", marks: 3 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2020-T006",
    subQuestions: [
      { part: "a", text: "(i) State two properties of water that are different from the hydrides of group 16. (ii) Why are the first ionization energies of the d-block metals greater than those of the s-block metals?", marks: 4 },
      { part: "b", text: "(i) List three types of hydrides and give an example of each. (ii) Give balanced chemical equations for the reaction of two types of hydrides with water.", marks: 5 },
      { part: "c", text: "Name the ore from which Aluminium can be extracted.", marks: 1 },
    ],
    totalMarks: 10,
  },
  {
    id: "CHE-2020-T008",
    subQuestions: [
      { part: "a", text: "An organic compound F, with the empirical formula C5H10O, has a vapour density of 43. (i) What is the molecular formula of F? (ii) If F does not react with Fehling's or Tollen's reagent but gives a yellow precipitate when reacted with aqueous iodine, draw the structure and give the IUPAC name of F. (iii) Write a reaction equation for the reduction of F with NaBH4.", marks: 3 },
      { part: "b", text: "Methylbenzene can react with chlorine in two ways. The products formed in each case depend on the reaction conditions, giving products A and B. (i) Draw the structures of A and B. (ii) Predict the products for the reaction of A and B with NaOH.", marks: 2 },
      { part: "c", text: "Predict the major products for the following reactions: (i) CH3CH2COCH2CH2CH3 reacts with LiAlH4 (ii) Benzene reacts with CH3Cl (iii) CH3CH2OH reacts with CH3CH2CH2COOH", marks: 2.5 },
      { part: "d", text: "Arrange the following carboxylic acids in order of increasing acidity, justifying your answer: 3-chloropentanoic acid; pentanoic acid; 2,2-dichloropentanoic acid; 3,3-dichloropentanoic acid; 2-chloropentanoic acid; 4-chloropentanoic acid.", marks: 2.5 },
    ],
    totalMarks: 10,
  },
];

async function main() {
  console.log(`Applying ${fixes.length} Chemistry 2020 fixes...\n`);
  for (const fix of fixes) {
    const update = {
      subQuestions: fix.subQuestions,
      totalMarks: fix.totalMarks,
      question: "",
      needsReview: FieldValue.delete(),
    };
    if (fix.has_diagram) update.has_diagram = true;
    await db.collection("theoryQuestions").doc(fix.id).update(update);
    console.log(`✅ Fixed ${fix.id}`);
  }
  console.log("\nDone. Chemistry 2020 complete.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
