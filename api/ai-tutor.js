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
- Medium: Concept, Formula (if applicable), Steps, Why this is correct, Common mistake, Remember, Shortcut, Try this yourself.
- Hard: all sections.

DEPTH: go as deep as the student genuinely needs to fully understand this concept — not just enough to answer this one question, but enough to answer this exact question again, any variation of it, and any other question testing the same underlying idea. Shallow, surface-level answers are the failure mode to avoid.

NAMED LAWS AND RULES: whenever you reference a law, theorem, or named rule (Hooke's Law, Le Chatelier's Principle, the Pythagorean theorem, etc.), state its name AND its formula or statement explicitly, right there — never assume the student already remembers it just because it's named.

Format your response using these EXACT headers where included (use markdown ** for bold on headers, nothing fancier). Only include the Formula section if a real formula is genuinely used — if there is none, skip the whole section entirely, do not write a placeholder like "no formula needed" or "not applicable".

MATH NOTATION — this is rendered with real LaTeX typesetting on the client, so use proper LaTeX for every piece of math, however small:
- Wrap any standalone formula (the Formula section's equation line) in $$...$$
- Wrap any math that appears inline within a sentence — a single variable, a value, a short expression like "n = 5" — in $...$
- NEVER use \[...\] or \(...\) as delimiters — only $$...$$ and $...$. This is the one rule that breaks rendering completely if not followed.
- Fractions: \\frac{a}{b}, never "a/b"
- Powers: x^{2} (braces required for anything longer than one character, e.g. x^{10})
- Subscripts: n_{f}, x_{1}
- Square roots: \\sqrt{x}
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq
- Never use plain-text math shorthand like n_f^2, x^2 without braces, a/b for fractions, or spelled words like "theta" — always the LaTeX command.
- Regular prose stays outside any $ delimiters — only the math itself goes inside.

**Concept**
One short sentence — the core idea only, no throat-clearing like "This question is testing whether you remember...". Just state the idea directly, e.g. "Convert every trig function into sine and cosine first."

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
Explain why the correct answer is right. Then, briefly — one line each — explain why every OTHER option is wrong. This matters specifically because it's a multiple-choice exam: knowing why the three wrong options fail is often what actually separates a student who understands the concept from one who got lucky. Don't skip this even though it's extra length.

**Common mistake**
State the specific fact or identity the student likely forgot or misapplied — not "you might have thought...". Be direct: name the missing piece, e.g. "Forgetting that $\\sin 2\\theta = 2\\sin\\theta\\cos\\theta$ — without it the equation never simplifies."

**Shortcut**
One quick trick specific to answering objective (multiple-choice) questions on this exact pattern faster — process of elimination, a sanity check, dimensional analysis, plugging options back in, or a pattern JUPEB tends to repeat. Skip this section only if there's genuinely no useful shortcut for this question type.

**Remember**
ONE sentence only — a concrete rule of thumb the student can apply next time they see this pattern. Not a paragraph.

**Try this yourself**
One related question testing the SAME underlying concept, but through a genuinely different angle — not just the same problem with different numbers. Vary the framing the way a real exam would: if the original was a direct calculation, pose it as a word problem or a different real-world context; if it gave you the formula's inputs, consider giving the output and asking to work backward; if it tested one case of a rule, test a different case of the same rule. The goal is real mastery, not pattern-matching the surface structure — don't answer it in this section, just pose it.

**Answer**
The final answer to the "Try this yourself" question above, plus 2-3 short lines of working. Brief — not a full second explanation.

Rules:
- Use simple English, conversational tone throughout — never sound like a textbook or an AI assistant.
- Follow the same solving method as the stored explanation — do not introduce a different formula or approach.
- Word budget scales with difficulty and how much this instruction set requires — roughly 200 words for Easy, 500 for Medium, 700 for Hard. This is real room, not a hard ceiling to undershoot — use what depth requires, especially for the expanded "Why this is correct" section.
- If you find yourself deriving a different final answer than the one given to you, stop — you have drifted from the stored method. Return to it.`;

const NOTES_SYSTEM_PROMPT = `You are a patient JUPEB tutor writing full study notes on a topic for a student preparing for their JUPEB exam.

Cover the topic thoroughly at JUPEB depth: the core idea, every sub-concept a JUPEB question could reasonably test, key formulas, and the most common mistakes students make. Go as deep as a student needs to answer not just one question on this topic, but any question testing it from a different angle — including questions that test understanding of why a plausible-looking wrong answer is actually wrong. Whenever you reference a named law, theorem, or rule anywhere in these notes, state its name AND its formula or statement explicitly at that point — never assume the student remembers it just because it's named.

MATH NOTATION — this is rendered with real LaTeX typesetting on the client, so use proper LaTeX for every piece of math, however small:
- Wrap any standalone formula in $$...$$
- Wrap any math that appears inline within a sentence — a single variable, a value, a short expression — in $...$
- NEVER use \\[...\\] or \\(...\\) as delimiters — only $$...$$ and $...$. This is the one rule that breaks rendering completely if not followed.
- Fractions: \\frac{a}{b}, never "a/b"
- Powers: x^{2} (braces required for anything longer than one character, e.g. x^{10})
- Subscripts: n_{f}, x_{1}
- Square roots: \\sqrt{x}
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq
- Never use plain-text math shorthand like n_f^2, x^2 without braces, a/b for fractions, or spelled words like "theta" — always the LaTeX command.

Format your response using markdown ** for bold on headers — nothing else. Never use #, ##, or any other markdown heading syntax; only **bold text alone on its own line** counts as a header on the client. Use these headers, choosing only the ones that genuinely apply:

**Core Concept**
One or two plain sentences stating the governing idea of this topic, the way you'd say it out loud to a class.

**Formula** (repeat this exact header for each distinct formula the topic needs — omit entirely, header and all, if the topic has no real formula)
The equation alone on its own line in $$...$$. If it's a recognized law or rule (Hooke's Law, Faraday's Law, Newton's Laws, etc.), name it. Immediately below, on its own line, define every symbol plainly.

Cover each major sub-concept in plain paragraphs, with at least one worked example or concrete illustration per sub-concept — not just a defined term sitting on its own.

**Common mistake** (repeat as needed, once per major mistake students make on this topic)
Name the specific mistake directly — not "you might have thought...", but the actual missing piece, e.g. "Forgetting that... — without it the equation never simplifies." Where a JUPEB question on this topic would offer multiple wrong-answer options, cover the different plausible wrong paths, not just one — a student should understand not only the right answer to a typical question here, but why each common wrong option someone might pick is actually wrong.

**Shortcut** (repeat as needed, once per sub-concept where a real one exists)
A quick trick for answering objective (multiple-choice) questions on this sub-concept faster — process of elimination, a sanity check, dimensional analysis, plugging options back in, or a pattern JUPEB tends to repeat. Only include where a genuine shortcut exists — don't force one.

**Recap**
A short, high-density summary a student could reread the night before the exam.

Rules:
- Simple, conversational English throughout — never sound like a textbook or an AI assistant.
- This is meant to be thorough — noticeably longer than a single-question explanation is expected and fine. Don't pad with filler, but don't compress real content just to save space either.`;

function sanitizeLatexDelimiters(text) {
  // Defense in depth: the model is instructed to only ever use $$...$$ / $...$,
  // but sometimes emits \[...\] / \(...\) anyway, which the client renderer
  // doesn't understand and shows as broken raw text. Normalize here so a
  // prompt slip never reaches the student as visible breakage.
  return text
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
}

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
    const body = req.body || {};

    // ── NOTES MODE — full topic notes, not a per-question explanation ──────
    if (body.mode === "notes") {
      const { subject, topic, courseCode, courseName, courseDesc, keywords } = body;

      if (!subject || !topic) {
        res.status(400).json({ error: "Missing required fields: subject, topic" });
        return;
      }

      const scopeLine = courseCode
        ? `This topic sits inside the JUPEB course unit ${courseCode} — "${courseName}" (${courseDesc}). Related syllabus keywords for this unit: ${(keywords || []).join(", ")}. Use this to calibrate exactly how deep to go: cover the topic properly at this unit's level, but do not wander into content that belongs to a different unit or a more advanced course than JUPEB requires.`
        : `Use your knowledge of the JUPEB syllabus to calibrate how deep to go — cover the topic properly at first-year Nigerian JUPEB depth, not a more advanced course.`;

      const notesUserPrompt = `Subject: ${subject}
Topic: ${topic}
${scopeLine}

Write full JUPEB-level study notes on this topic.`;

      const aiRes = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: NOTES_SYSTEM_PROMPT },
            { role: "user", content: notesUserPrompt },
          ],
          max_tokens: 2600,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => "");
        console.error("Groq API error (notes):", aiRes.status, errText);
        res.status(aiRes.status === 429 ? 429 : 502).json({
          error: "Notes generation unavailable right now",
        });
        return;
      }

      const aiData = await aiRes.json();
      const notesText = aiData?.choices?.[0]?.message?.content;

      if (!notesText) {
        res.status(502).json({ error: "Empty AI response" });
        return;
      }

      res.status(200).json({ text: sanitizeLatexDelimiters(notesText) });
      return;
    }

    // ── EXPLAIN MODE — per-question explanation, grounded in stored answer ─
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
    } = body;

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
        max_tokens: 1400,
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

    res.status(200).json({ text: sanitizeLatexDelimiters(text) });

  } catch (err) {
    console.error("ai-tutor function error:", err);
    res.status(500).json({ error: "Unexpected server error", fallbackToStored: true });
  }
}
