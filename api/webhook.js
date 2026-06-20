// api/webhook.js
// Layer 2: Paystack calls this webhook after payment.
// Acts as a backup to the client-side verify-payment call.
// Even if the client fails (bad network, user closes app), this fires.

import admin from "firebase-admin";
import crypto from "crypto";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export const config = {
  api: {
    bodyParser: false, // Need raw body for signature verification
  },
};

// Read raw body for Paystack signature verification
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await getRawBody(req);

  // Verify Paystack signature — critical security step
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    console.error("Webhook: Invalid Paystack signature");
    return res.status(400).json({ error: "Invalid signature" });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { event, data } = body;

  // We only care about successful charges
  if (event !== "charge.success") {
    return res.status(200).json({ received: true, ignored: true });
  }

  try {
    // Get uid from metadata (set when initiating payment in the app)
    const uid = data?.metadata?.uid;
    const reference = data?.reference;

    if (!uid) {
      console.error("Webhook: No uid in metadata for reference", reference);
      // Still return 200 so Paystack doesn't keep retrying
      return res.status(200).json({ received: true, error: "No uid in metadata" });
    }

    // Check if premium is already active (client-verify already ran)
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data()?.isPremium) {
      // Already activated — acknowledge and move on
      return res.status(200).json({ received: true, alreadyActive: true });
    }

    // Activate premium
    const examEndDate = new Date("2026-08-03").toISOString();
    await admin.firestore().collection("users").doc(uid).update({
      isPremium: true,
      premiumActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      premiumExpiresAt: examEndDate,
      paymentReference: reference,
      paymentAmount: data?.amount / 100,
    });

    // Log payment
    await admin.firestore().collection("payments").add({
      uid,
      reference,
      amount: data?.amount / 100,
      email: data?.customer?.email,
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "webhook",
    });

    console.log(`Webhook: Premium activated for uid ${uid} via ${reference}`);
    return res.status(200).json({ received: true, activated: true });

  } catch (error) {
    console.error("Webhook error:", error);
    // Return 200 anyway — if we return 500, Paystack retries for 24 hours
    return res.status(200).json({ received: true, error: error.message });
  }
}
