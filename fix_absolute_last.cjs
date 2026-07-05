const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccount.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log("Applying final two confirmed fixes...\n");

  await db.collection("theoryQuestions").doc("PHY-2019-T004").update({
    topic: "Waves",
    tags: ["physics", "2019", "jupeb", "theory", "waves", "huygens", "violin", "transmission-line"],
    subQuestions: [
      {
        part: "a",
        text: "(i) State the principle of superposition of waves. (ii) Briefly describe Huygens principle with the aid of appropriate diagram.",
        marks: 3,
      },
      {
        part: "b",
        text: "The manufacturer's manual of a violin shows that the heaviest and lightest strings have linear densities of 6.0 and 0.58 kg/m respectively. Assuming that strings are of the same material, determine the ratio of their radii.",
        marks: 3,
      },
      {
        part: "c",
        text: "The voltage from an electromagnetic wave travelling on a transmission line is given by V(x,t) = 10e^(-αx) sin(4π×10⁹t − 30πx) V, where x is the distance in meters from the transmitter. (i) Find the frequency, wavelength and phase velocity of the wave. (ii) Find the voltage at x = 2.1×10⁻² cm and t = 0.32s. (iii) If the amplitude of the wave is measured to be 2V, find α.",
        marks: 4,
      },
    ],
    totalMarks: 10,
    has_diagram: true,
    needsReview: FieldValue.delete(),
  });
  console.log("✅ Fixed PHY-2019-T004 — equation confirmed, marks corrected to 3/3/4");

  await db.collection("theoryQuestions").doc("MAT-2019-T003").update({
    subQuestions: [
      {
        part: "a",
        text: "A vehicle starts from rest and its velocity is measured every second for 8 seconds as follows: Time t(s): 0,1,2,3,4,5,6,7,8 — Velocity v(ms⁻¹): 0, 0.4, 1.0, 1.7, 2.9, 4.1, 6.2, 8.0, 9.4. The distance travelled in 8 seconds is given by ∫(0 to 8) v dt. Estimate this distance using Simpson's rule.",
        marks: 6,
      },
      { part: "b", text: "Evaluate ∫ (x+1)/(x²−3x+2) dx", marks: 6 },
      { part: "c", text: "Find the differential coefficient of y = 3x²sin(2x)", marks: 3 },
    ],
    totalMarks: 15,
  });
  console.log("✅ Fixed MAT-2019-T003 — data table confirmed");

  console.log("\n🎉 All done. Every flagged question from the original audit is resolved.");
}

main().catch(e => { console.error("💥", e); process.exit(1); });
