// api/verify-payment.js
// SIMPLIFIED — no firebase-admin needed.
// This just verifies the payment with Paystack server-side (secret key stays safe).
// The client then does the Firestore write itself using its existing Firebase connection.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { reference } = req.body;
  if (!reference) return res.status(400).json({ success: false, error: "No reference" });

  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await paystackRes.json();

    if (data.status && data.data?.status === "success" && data.data?.amount >= 10000) {
      return res.status(200).json({
        success: true,
        amount: data.data.amount / 100,
        email: data.data.customer?.email,
      });
    }

    return res.status(400).json({
      success: false,
      status: data.data?.status || "failed",
    });

  } catch (error) {
    console.error("verify-payment error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
