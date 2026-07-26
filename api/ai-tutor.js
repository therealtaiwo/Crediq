// ─── CREDIQ AI TUTOR FUNCTION (auth-protected, matches real question schema) ─
// Runs on Vercel as a serverless function.
//
// Env vars required in Vercel project settings (no VITE_ prefix on either):
//   GROQ_API_KEY        — Groq API key
//   FIREBASE_ADMIN_KEY  — full service account JSON, as a single-line string

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
  });
}

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Three-tier fallback chain (see routing decision, July 2026 — revised after
// a raw-output comparison test across Physics/Chemistry/Math/Biology):
// 1. Primary — stronger reasoner. Confirmed via testing: no chain-of-thought
//    leak into `content` (every response started cleanly with **Concept**).
//    BUT it runs ~15-25% more tokens per call than the old single-model setup
//    (more LaTeX markup, more verbose steps) — 200K TPD budget realistically
//    supports ~95-110 calls/day at its real average, not the ~130-150
//    originally estimated from the old model's token profile. Also needs a
//    larger max_tokens (see MODEL_CHAIN below) — it got cut off mid-response
//    in testing at the old 800-token cap on a formula-dense question.
// 2. Fallback — the previous single model. Already proven: 10/10 clean
//    results across Physics, Chemistry, Maths, Biology in testing. Kicks in
//    once the primary's daily RPD/TPD quota is exhausted, OR the primary's
//    response comes back truncated (finish_reason "length").
// 3. Emergency fallback — measurably weaker: a real arithmetic error and a
//    failed Genetics probability question in earlier testing, plus a self-
//    contradictory practice question and incoherent answer on a Chemistry
//    question in this round. Its 14,400 RPD headroom is real, but its 6,000
//    TPM (tokens-per-minute, not per-day) ceiling is tight enough that it
//    hit a 429 during this test's light, sequential 4-question run — so it
//    won't smoothly absorb a fast burst even though its daily total is huge.
//    Included purely as last-resort survival capacity, not normal-operation
//    traffic.
// Every other free Groq model (Llama 4 Scout, DeepSeek R1 Distill,
// Qwen3-32B, Mistral Saba) caps at the same ~1,000 RPD as tiers 1-2, so none
// of them add real extra capacity as a fourth tier — deliberately excluded.
const MODEL_CHAIN = [
  { model: "openai/gpt-oss-120b",       maxTokens: 1100 }, // raised from 800 — was truncating on formula-dense questions
  { model: "llama-3.3-70b-versatile",   maxTokens: 800  },
  { model: "llama-3.1-8b-instant",      maxTokens: 800  },
];

// The primary model is a reasoning model and could in principle prepend its
// chain-of-thought before the actual answer, though a raw-output test found
// no instance of this happening (every response started cleanly with
// **Concept**). Kept as cheap defensive insurance: anything before the FIRST
// section header, whatever form a leak might take, isn't part of our format
// and gets discarded. No-op in the normal case.
const KNOWN_HEADERS = ["Concept","Formula","Steps","Why this is correct","Common mistake","Remember","Try this yourself","Answer"];
function stripReasoningPreamble(text) {
  const pattern = new RegExp(`\\*\\*(${KNOWN_HEADERS.join("|")})\\*\\*`);
  const match = text.match(pattern);
  if (match && match.index > 0) return text.slice(match.index);
  return text;
}

const BEGINNER_ADDITION = `

The student has asked for the SIMPLER version of this explanation. Rewrite with these adjustments:
- Assume they're seeing this topic for the first time — define any term before using it.
- Shorter sentences. No jargon without an immediate plain-English definition right next to it.
- Same structure and headers as usual, just simpler language throughout.`;

const LAST_FREE_HINT_ADDITION = `

This is this student's last free explanation for today. After the Answer section, add ONE extra short line with no header — a natural, trailing-off aside hinting there's more to this topic worth seeing: a shortcut, a related exam trap, an easier way to remember it. Like a teacher who's mid-thought, not a marketer. Never mention payment, limits, upgrading, or that this is their last free one — just genuine warmth that there's more. Example tone: "There's actually a quicker way to spot this pattern in the exam — remind me to show you sometime." Keep it to one sentence.`;

const SYSTEM_PROMPT = `You are a patient JUPEB tutor. Your goal is not to reveal answers immediately. Your goal is to help students genuinely understand.

You will be given the question, the correct answer, and a short STORED EXPLANATION that already contains the correct, tested method for solving this question. Do NOT derive the answer independently or invent your own method — build your explanation on top of the stored method, using the same approach, and expand it with more detail, plainer language, and the misconception behind the student's wrong answer.

You will also be told the question's difficulty (easy, medium, or hard). Adjust how many sections you include accordingly — don't force every section onto a simple question:
- Easy: Concept, Steps, Remember only.
- Medium: Concept, Formula (if applicable), Steps, Common mistake, Remember, Try this yourself.
- Hard: all sections.

Format your response using these EXACT headers where included (use markdown ** for bold on headers, nothing fancier). Only include the Formula section if a real formula is genuinely used — if there is none, skip the whole section entirely, do not write a placeholder like "no formula needed" or "not applicable".

MATH NOTATION — this is rendered with real LaTeX typesetting on the client, so use proper LaTeX for every piece of math, however small. Keep it minimal and plain — no \bigl \bigr \Bigl \Bigr sizing commands, no \displaystyle, no unnecessary \, spacing commands, no double-spaced line breaks after formulas. Plain parentheses and standard spacing render fine and cost fewer tokens:
- Wrap any standalone formula (the Formula section's equation line) in $$...$$
- Wrap any math that appears inline within a sentence — a single variable, a value, a short expression like "n = 5" — in $...$
- Fractions: \\frac{a}{b}, never "a/b"
- Powers: x^{2} (braces required for anything longer than one character, e.g. x^{10})
- Subscripts: n_{f}, x_{1}
- Square roots: \\sqrt{x}
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq
- Never use plain-text math shorthand like n_f^2, x^2 without braces, a/b for fractions, or spelled words like "theta" — always the LaTeX command.
- Regular prose stays outside any $ delimiters — only the math itself goes inside.

**Concept**
One short sentence — the core idea only, no throat-clearing like "This question is testing whether you remember...". Just state the idea directly, e.g. "Convert every trig function into sine and cosine first." Where it genuinely fits, frame it around the exam itself rather than the textbook — e.g. "Here's why almost every JUPEB student loses marks on this exact step" — but only when true and natural, never forced onto a topic it doesn't fit.

**Formula** (omit this entire section, header and all, if the question has no real formula — never write a placeholder line here)
The formula alone, on its own line, wrapped in $$...$$, nothing else on that line. Immediately below it, on its own line, define every symbol used: "where $F$ = force, $m$ = mass, $a$ = acceleration" — plain words, no units unless the units themselves matter to the method. Skip this definition line only for symbols so standard they need no explanation (e.g. plain x, y in coordinate geometry).

**Steps**
Break into short, separate lines — one idea per line, not one long sentence. For example:
Step 1: Identify what's given
$u = ...$, $v = ...$
Step 2: Apply the rule
...
Step 3: Substitute and calculate
...

**Why this is correct**
Brief reasoning.

**Common mistake**
State the specific fact or identity the student likely forgot or misapplied — not "you might have thought...". Be direct: name the missing piece, e.g. "Forgetting that $\\sin 2\\theta = 2\\sin\\theta\\cos\\theta$ — without it the equation never simplifies."

**Remember**
ONE sentence only — a concrete rule of thumb the student can apply next time they see this pattern. If a genuine memory trick or mnemonic exists for this (a phrase, an acronym, a pattern), use that instead of a generic rule — but only a real one, never invent an awkward one just to have one. Not a paragraph either way.

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

  const userData = userDoc.exists ? userDoc.data() : null;
  if (!userData) {
    res.status(403).json({ error: "Account not found" });
    return;
  }
  const isPremium = userData.isPremium === true;

  // Daily cap — enforced HERE, server-side, not just in the client UI.
  // A free-tier check that only lived client-side would be trivial for a
  // free user to bypass by calling this endpoint directly, since they have
  // nothing at stake the way a paying premium user does. Premium: 60/day
  // per student. Free: 3/day per student, to let them genuinely try it
  // before hitting the paywall. Same per-user-per-day counter doc the
  // client already reads for its own fast pre-check UX.
  const DAILY_CAP = isPremium ? 60 : 3;
  const today = new Date().toISOString().slice(0, 10);
  const counterRef = getFirestore().collection("aiTutorCounters").doc(`${decoded.uid}_${today}`);
  const counterSnap = await counterRef.get();
  const usedToday = counterSnap.exists ? (counterSnap.data().count || 0) : 0;

  if (usedToday >= DAILY_CAP) {
    res.status(403).json({
      error: isPremium ? "Daily AI Tutor limit reached" : "Free daily limit reached — upgrade for more",
      dailyCapReached: true,
      isPremium,
    });
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
      isLastFreeUse,  // optional: true when this is a free user's 3rd (final) daily explanation
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

    const messages = [
      { role: "system", content: SYSTEM_PROMPT + (style === "beginner" ? BEGINNER_ADDITION : "") + (isLastFreeUse ? LAST_FREE_HINT_ADDITION : "") },
      { role: "user", content: userPrompt },
    ];

    let text = null;
    let modelUsed = null;
    let lastErr = null;

    for (const { model, maxTokens } of MODEL_CHAIN) {
      let aiRes;
      try {
        aiRes = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
          }),
        });
      } catch (networkErr) {
        console.error(`ai-tutor: network error calling ${model}:`, networkErr);
        lastErr = networkErr;
        continue; // try next tier
      }

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => "");
        console.error(`ai-tutor: ${model} returned ${aiRes.status}:`, errText);
        lastErr = { status: aiRes.status, errText };
        continue; // quota exhausted or model error — fall through to next tier
      }

      const aiData = await aiRes.json();
      const choice = aiData?.choices?.[0];
      const raw = choice?.message?.content;
      const finishReason = choice?.finish_reason;

      if (!raw) {
        console.error(`ai-tutor: ${model} returned empty content`);
        lastErr = { status: 502, errText: "empty content" };
        continue;
      }

      // A 200 response can still be broken: finish_reason "length" means
      // the model got cut off mid-response before it was done. That's worse
      // than an honest error — it looks fine until a student notices the
      // explanation just stops — so treat it as a failure and fall through
      // to the next tier rather than serving truncated content.
      if (finishReason === "length") {
        console.error(`ai-tutor: ${model} response truncated (finish_reason=length, max_tokens=${maxTokens})`);
        lastErr = { status: 502, errText: "response truncated" };
        continue;
      }

      text = stripReasoningPreamble(raw);
      modelUsed = model;
      console.log(`ai-tutor: served via ${model} (${aiData?.usage?.total_tokens || "?"} tokens, finish_reason=${finishReason})`);
      break; // success — stop trying further tiers
    }

    if (!text) {
      console.error("ai-tutor: all models in chain failed. Last error:", lastErr);
      res.status(lastErr?.status === 429 ? 429 : 502).json({
        error: "AI Tutor unavailable right now",
        fallbackToStored: true,
      });
      return;
    }

    try {
      await counterRef.set({ count: FieldValue.increment(1) }, { merge: true });
    } catch (err) {
      console.error("ai-tutor: failed to increment usage counter:", err);
      // Don't fail the request over a counter write — the student already
      // has their explanation. Worst case, this one call doesn't count
      // against their cap.
    }

    res.status(200).json({ text });

  } catch (err) {
    console.error("ai-tutor function error:", err);
    res.status(500).json({ error: "Unexpected server error", fallbackToStored: true });
  }
}
