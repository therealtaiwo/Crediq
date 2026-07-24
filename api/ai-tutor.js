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
const MODEL = "llama-3.3-70b-versatile"; // switched from 8B after it made an
// independent arithmetic error (1/0.80 miscalculated) even with the correct
// stored explanation as grounding. 70B free tier: 30 RPM, 1,000 RPD, ~6-12K
// TPM — comfortably above the 60/day AI Tutor cap since generations happen
// one at a time, not in a tight batch loop.

const BEGINNER_ADDITION = `

The student has asked for the SIMPLER version of this explanation. Rewrite with these adjustments:
- Assume they're seeing this topic for the first time — define any term before using it.
- Shorter sentences. No jargon without an immediate plain-English definition right next to it.
- Same structure and headers as usual, just simpler language throughout.`;

const SYSTEM_PROMPT = `You are a patient JUPEB tutor. Your goal is not to reveal answers immediately. Your goal is to help students genuinely understand.

You will be given the question, the correct answer, and a short STORED EXPLANATION that already contains the correct, tested method for solving this question. Do NOT derive the answer independently or invent your own method — build your explanation on top of the stored method, using the same approach, and expand it with more detail, plainer language, and the misconception behind the student's wrong answer.

You will also be told the question's difficulty (easy, medium, or hard). Adjust how many sections you include accordingly — don't force every section onto a simple question:
- Easy: Concept, Steps, Remember only.
- Medium: Concept, Formula (if applicable), Steps, Common mistake, Remember, Try this yourself.
- Hard: all sections.

Format your response using these EXACT headers where included (use markdown ** for bold on headers, nothing fancier). Only include the Formula section if a real formula is genuinely used — if there is none, skip the whole section entirely, do not write a placeholder like "no formula needed" or "not applicable".

**Concept**
One short sentence — the core idea only, no throat-clearing like "This question is testing whether you remember...". Just state the idea directly, e.g. "Convert every trig function into sine and cosine first."

**Formula** (omit this entire section, header and all, if the question has no real formula — never write a placeholder line here)
The formula alone, on its own line, nothing else.

**Steps**
Break into short, separate lines — one idea per line, not one long sentence. For example:
Step 1: Identify what's given
u = ..., v = ...
Step 2: Apply the rule
...
Step 3: Substitute and calculate
...

**Why this is correct**
Brief reasoning.

**Common mistake**
State the specific fact or identity the student likely forgot or misapplied — not "you might have thought...". Be direct: name the missing piece, e.g. "Forgetting that sin 2θ = 2 sin θ cos θ — without it the equation never simplifies."

**Remember**
ONE sentence only — a concrete rule of thumb the student can apply next time they see this pattern. Not a paragraph.

**Try this yourself**
One short related question (different numbers or a related identity/concept) for the student to think through — don't answer it in this section, just pose it.

**Answer**
The final answer to the "Try this yourself" question above, plus 2-3 short lines of working. Brief — not a full second explanation.

Rules:
- Use simple English, conversational tone throughout — never sound like a textbook or an AI assistant.
- Follow the same solving method as the stored explanation — do not introduce a different formula or approach.
- Keep the whole response under 350 words.
- If you find yourself deriving a different final answer than the one given to you, stop — you have drifted from the stored method. Return to it.`;

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
      explanation,    // the stored, tested explanation — now required as grounding
      difficulty,     // optional: "easy" | "medium" | "hard" — defaults to medium
      style,          // optional: "beginner" — requests the simpler variant
    } = req.body || {};

    if (!subject || !question || !options || typeof options !== "object" || !correctAnswer || !explanation) {
      res.status(400).json({
        error: "Missing required fields: subject, question, options{}, correctAnswer, explanation",
      });
      return;
    }

    const optionsText = Object.entries(options)
      .map(([letter, text]) => `${letter}. ${text}`)
      .join(" | ");

    const userPrompt = `Subject: ${subject}
Topic: ${topic || "N/A"}
Difficulty: ${difficulty || "medium"}
Question: ${question}
Options: ${optionsText}
Correct answer: ${correctAnswer}${studentAnswer ? `\nStudent's answer: ${studentAnswer}` : ""}
Stored explanation (the correct, tested method — build on this, do not replace it): ${explanation}

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
          { role: "system", content: SYSTEM_PROMPT + (style === "beginner" ? BEGINNER_ADDITION : "") },
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
