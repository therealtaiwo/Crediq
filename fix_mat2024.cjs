const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const fixes = [
  {
    id: "MAT-2024-T002",
    subQuestions: [
      { part: "a", text: "Find the equation of the circle with centre (-5,2) which passes through the point (3,5).", marks: 4 },
      { part: "b", text: "Let (x + 2) be a factor of the polynomial P(x) = 2x³ − 5x² + kx + 8. (i) Find k. (ii) Factorize the polynomial completely.", marks: 5 },
      { part: "c", text: "(i) Obtain the binomial expansion of (2x + 3t)⁵ (ii) Using the binomial expansion obtained in (i), evaluate (2.03)⁵", marks: 6 },
    ],
    totalMarks: 15,
  },
  {
    id: "MAT-2024-T003",
    subQuestions: [
      { part: "a", text: "Evaluate the following limits: (i) lim(x→0) (√(x+16)−4)/x [3 Marks] (ii) lim(x→∞) (√(3x²+6))/(5−5x) [2 Marks]", marks: 5 },
      { part: "b", text: "Given that (x²+4)/(3x³+4x²−4x) = A/x + B/(x+2) + C/(3x−2), determine the values of A, B and C. Hence, evaluate the definite integral of (x²+4)/(3x³+4x²−4x) dx from x=1 to x=2.", marks: 6 },
      { part: "c", text: "Differentiate 9x³ − 5 from first principle.", marks: 4 },
    ],
    totalMarks: 15,
  },
  {
    id: "MAT-2024-T005",
    subQuestions: [
      { part: "a", text: "The yields of rice from six plots are 1.0, 1.4, 0.8, 1.6, 2.0 and 2.2 tonnes per acre. Test at a level of significance of 0.05 whether this supports the contention that the true average yield for that kind of rice is 1.4 tonnes per acre.", marks: 7 },
      { part: "b", text: "Out of 2400 families with 5 children each, how many would you expect to have: (i) 5 girls (ii) either 2 or 3 boys — if the probabilities for boys and girls are equal.", marks: 5 },
      { part: "c", text: "If a normal distribution has mean 230 and standard deviation 20, what is the probability that an observation from this population lies between 220 and 250?", marks: 3 },
    ],
    totalMarks: 15,
  },
  {
    id: "MAT-2024-T006",
    subQuestions: [
      { part: "a", text: "The discrete random variable X has probability function: P(X=x) = bx/(x+1)² for x = 2,3; P(X=x) = bx/(x−1)² for x = 4,5; and 0 otherwise. Show that the value of b is 6/7.", marks: 6 },
      { part: "b", text: "Find (i) the probability that X is less than 3 or greater than 4; (ii) Var(X).", marks: 3 },
      { part: "c", text: "The following data shows the number of times two groups of students X and Y attended JUPEB classes in a semester: X: 4,5,3,5,8 — Y: 15,16,20,16,22. (i) Compute the Pearson's correlation coefficient between X and Y. (ii) Interpret your result.", marks: 6 },
    ],
    totalMarks: 15,
  },
  {
    id: "MAT-2024-T007",
    subQuestions: [
      { part: "a", text: "A particle of mass 4kg rests on an inclined plane at an angle 30° to the horizontal surface, and the coefficient of friction is 0.5. (i) Find the acceleration of the particle if it moves up the plane with a force of 80N. (ii) Find the velocity attained after 3s if it moves with an initial velocity of 12m/s. [Take g = 10m/s²]", marks: 5 },
      { part: "b", text: "If A⃗ = 2i − j + 3k, B⃗ = 3i + 2j + k and C⃗ = i + qj + 4k are coplanar, find the value of q.", marks: 4 },
      { part: "c", text: "Calculate the moment of inertia and radius of gyration of a thin uniform rod of length 12cm and mass 4kg through its centre perpendicular to its length.", marks: 6 },
    ],
    totalMarks: 15,
  },
  {
    id: "MAT-2024-T008",
    subQuestions: [
      { part: "a", text: "(i) Find the value of m when 2i − 3j + 5k and 3i − mj + 2k are perpendicular. (ii) Find the Cartesian equation of the plane through the point (2,5,3) with normal 3i + 2j − 7k.", marks: 6 },
      { part: "b", text: "(i) If A⃗ = 2i − 3j + 5k and B⃗ = 3i + mj − 2k are equal in magnitude, find the smallest value of m. (ii) If W = 3ti − t²j and Z = 3t²i − 3j, verify the result d(W·Z)/dt = W·(dZ/dt) + (dW/dt)·Z.", marks: 6 },
      { part: "c", text: "Given a quadrilateral ABCD in which vector AB = (4,7), vector BC = (6,2) and vector CD = (−7,−8), find: (i) vector AD; (ii) the lengths of the sides of the quadrilateral.", marks: 3 },
    ],
    totalMarks: 15,
  },
  {
    id: "MAT-2024-T009",
    subQuestions: [
      { part: "a", text: "₦500,000 was invested in a clothing business for 2 years at 4% compounded semi-annually. (i) Find the compound amount. (ii) Find the compound interest.", marks: 5 },
      { part: "b", text: "Find the equilibrium price and quantity given the market below: Qs = −14 + 2P; Qd = 130 − 6P.", marks: 4 },
      { part: "c", text: "The demand and cost functions for a scientific calculator are p = 4000 − 2q² and C = 25 + 1400q respectively, where p is the price in Naira and q is the quantity produced and C the total cost of producing the calculator in Naira. Determine the price and quantity for maximum profit, and the maximum profit.", marks: 6 },
    ],
    totalMarks: 15,
  },
];

async function main() {
  console.log(`Applying ${fixes.length} Math 2024 fixes...\n`);
  for (const fix of fixes) {
    await db.collection("theoryQuestions").doc(fix.id).update({
      subQuestions: fix.subQuestions,
      totalMarks: fix.totalMarks,
      question: "",
    });
    console.log(`✅ Fixed ${fix.id}`);
  }
  console.log("\nDone.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
