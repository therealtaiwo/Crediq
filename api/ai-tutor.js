// ─── CREDIQ AI TUTOR FUNCTION (auth-protected, matches real question schema) ─
// Runs on Vercel as a serverless function.
//
// Env vars required in Vercel project settings (no VITE_ prefix on either):
//   GROQ_API_KEY        — Groq API key
//   FIREBASE_ADMIN_KEY  — full service account JSON, as a single-line string

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
  });
}

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant"; // confirmed reliable on Accounting, Physics,
// Chemistry, most Biology, Maths, Government, Economics — NOT reliable on
// Genetics cross/probability questions. Client excludes topic === "Genetics"
// entirely before ever calling this function.

const SYSTEM_PROMPT = `You are a patient JUPEB tutor. Your goal is not to reveal answers immediately. Your goal is to help students genuinely understand.

Rules:
- Use simple English.
- Teach before concluding.
- Explain the concept.
- Explain why the correct option is correct.
- Explain the misconception behind the student's wrong answer.
- Use examples where helpful.
- End with one memorable takeaway.
- Keep the whole explanation under 300 words.
- If your derived answer doesn't match the correct option given to you, stop and recheck your formula or reasoning rather than forcing a match to the given answer.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  let userDoc;
  try {
    userDoc = await getFirestore().collection("users").doc(decoded.uid).get();
  } catch (err) {
    console.error("Firestore read error:", err);
    res.status(500).json({ error: "Could not verify premium status" });
    return;
  }

  if (!userDoc.exists || userDoc.data()?.isPremium !== true) {
    res.status(403).json({ error: "Premium required" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server not configured — missing GROQ_API_KEY" });
    return;
  }

  try {
    const {
      subject,
      topic,
      question,
      options,        // real shape: { A: "...", B: "...", C: "...", D: "..." }
      correctAnswer,  // real shape: single letter, e.g. "C"
      studentAnswer,  // single letter, optional
    } = req.body || {};

    if (!subject || !question || !options || typeof options !== "object" || !correctAnswer) {
      res.status(400).json({
        error: "Missing required fields: subject, question, options{}, correctAnswer",
      });
      return;
    }

    const optionsText = Object.entries(options)
      .map(([letter, text]) => `${letter}. ${text}`)
      .join(" | ");

    const userPrompt = `Subject: ${subject}
Topic: ${topic || "N/A"}
Question: ${question}
Options: ${optionsText}
Correct answer: ${correctAnswer}${studentAnswer ? `\nStudent's answer: ${studentAnswer}` : ""}

Help the student understand why the correct answer is right${studentAnswer ? ", and address the specific misconception behind picking their wrong answer" : ""}.`;

    const aiRes = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 800,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("Groq API error:", aiRes.status, errText);
      res.status(aiRes.status === 429 ? 429 : 502).json({
        error: "AI Tutor unavailable right now",
        fallbackToStored: true,
      });
      return;
    }

    const aiData = await aiRes.json();
    const text = aiData?.choices?.[0]?.message?.content;

    if (!text) {
      res.status(502).json({ error: "Empty AI response", fallbackToStored: true });
      return;
    }

    res.status(200).json({ text });

  } catch (err) {
    console.error("ai-tutor function error:", err);
    res.status(500).json({ error: "Unexpected server error", fallbackToStored: true });
  }
}
