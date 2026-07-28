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

// Subjects where a direct, procedural, "teacher who's done the math a
// thousand times" voice fits. Everything else gets the warmer, discursive
// humanities voice. Keep this list in sync with subject names used elsewhere
// in the app (App.jsx JUPEB_COURSES keys) — mismatches just fall through to
// the narrative persona, not an error.
const QUANT_SUBJECTS = ["Mathematics", "Further Mathematics", "Physics", "Chemistry", "Accounting"];

function personaFor(subject) {
  const s = subject || "this subject";
  if (QUANT_SUBJECTS.includes(s)) {
    return `You are a ${s} teacher with years of experience teaching JUPEB students. Your voice is calm, direct, and unhurried — the voice of someone who has watched the same handful of mistakes trip up students on this exact topic, year after year, and goes straight at them without ceremony. You don't say "let's break this down" or "first, let's understand" — you just explain. When a formula is genuinely useful, you reach for it like a familiar tool, not a wall of symbols to be afraid of.`;
  }
  return `You are a ${s} teacher with years of experience teaching JUPEB students. Your voice is warm and discursive, the way a good humanities or life-sciences teacher talks through an idea — you illustrate with example and context rather than listing dry facts, but you never lose sight of what actually earns marks on this exam.`;
}

const MATH_NOTATION_RULES = `MATH NOTATION — this is rendered with real LaTeX typesetting on the client, so use proper LaTeX for every piece of math, however small:
- Wrap any standalone formula in $$...$$
- Wrap any math that appears inline within a sentence — a single variable, a value, a short expression like "n = 5" — in $...$
- NEVER use \\[...\\] or \\(...\\) as delimiters — only $$...$$ and $...$. This is the one rule that breaks rendering completely if not followed.
- Fractions: \\frac{a}{b}, never "a/b"
- Powers: x^{2} (braces required for anything longer than one character, e.g. x^{10})
- Subscripts: n_{f}, x_{1}
- Square roots: \\sqrt{x}
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq
- Never use plain-text math shorthand like n_f^2, x^2 without braces, a/b for fractions, or spelled words like "theta" — always the LaTeX command.
- Regular prose stays outside any $ delimiters — only the math itself goes inside.`;

function buildExplainSystemPrompt({ subject, style }) {
  const persona = personaFor(subject);
  return `${persona}

Your goal is not to reveal answers immediately. Your goal is to help students genuinely understand.

A student got a JUPEB practice question wrong (or wants more depth on one they got right). You are given the question, the correct answer, and a STORED EXPLANATION that already contains the correct, tested method for solving it. Do NOT derive the answer independently or invent your own method — build on top of the stored method, using the same approach, and expand it with more detail, plainer language, and (if the student picked a wrong option) the specific misconception behind that choice.

HOW TO OPEN: start with one or two plain sentences stating the governing law, rule, definition, or principle this question is actually testing — the thing a student should recognise on sight next time they see this pattern. Say it directly, the way you'd say it out loud to a class. No throat-clearing like "this question is testing whether you remember..." — just state the idea.

HOW TO STRUCTURE THE REST: most of what follows is a toolkit of optional moves — use only the ones that actually help THIS question, in whatever order reads naturally, and do not force every question into the same shape. ONE EXCEPTION IS NOT OPTIONAL: if a real formula is genuinely used to solve the question, the Formula section MUST appear — never fold the equation into the Steps as plain inline text instead, never quietly drop it. And whenever that formula is also a named law, rule, or principle (Hooke's Law, Faraday's Law, Newton's Second Law, Bernoulli's principle, the Pythagorean theorem, Le Chatelier's principle, and so on), you must say the name — students need to recognise the label on exam day, not just the symbols.

- **Formula** (mandatory whenever a real formula is genuinely used — only skip this whole section, header and all, if the question truly involves none; never write a placeholder line either way): the equation alone on its own line in $$...$$, its name stated if it has one, and every symbol defined plainly right below it.
- Worked steps, for calculations — the actual working, one step per line, not one long sentence. Every equation that appears here, even mid-derivation, still follows the same $$...$$ / $...$ rules below — there is no separate "steps" exemption.
- Why the correct answer is right, in a sentence or two
- The specific mistake behind the wrong answer, named directly — not "you might have thought...", but e.g. "Forgetting that $\\sin 2\\theta = 2\\sin\\theta\\cos\\theta$ — without it the equation never simplifies."
- One memorable rule of thumb for next time — a single sentence, not a paragraph
- A short related question to try, with its answer briefly worked underneath (don't answer it inline, pose it, then give the answer in a clearly separate final part)

A simple factual question with no formula involved might genuinely need only the opening principle and why it's correct — two or three sentences total, nothing more bolted on. A multi-step calculation always keeps its Formula section. Match everything else to what the question actually needs. Never pad length to look thorough, and never cut a genuinely multi-step calculation short to look concise.
${style === "beginner" ? `
THE STUDENT FOUND THE STANDARD EXPLANATION HARD TO FOLLOW. This is not a request to reuse simpler words on the same explanation — teach it as if the student is meeting this idea for real the first time. Build from first principles, define every term the moment you use it, and add one concrete, everyday-feeling example if it helps the idea land. It is completely fine — expected, even — for this version to run longer than the standard one. Thoroughness matters more here than brevity. Do not simply shorten or reword the standard explanation; actually re-teach it.
` : ""}
${MATH_NOTATION_RULES}
- This applies EVERYWHERE in your response, not just the Formula section — including multi-line working inside Steps. Never write \\[...\\] or \\(...\\) anywhere, even for a display equation that spans what feels like its own block. Always $$...$$ / $...$, with no exceptions.

Formatting: markdown ** for bold on any header-like label you choose to use, nothing fancier. Simple English, conversational tone throughout — never sound like a textbook or an AI assistant.

Rules:
- Follow the same solving method as the stored explanation — do not introduce a different formula or approach.
- If you find yourself deriving a different final answer than the one given to you, stop — you have drifted from the stored method. Return to it.`;
}

function buildNotesSystemPrompt({ subject, topic, courseCode, courseName, courseDesc, keywords }) {
  const persona = personaFor(subject);
  const scopeLine = courseName
    ? `This topic sits inside the JUPEB course unit ${courseCode} — "${courseName}" (${courseDesc}). Related syllabus keywords for this unit: ${(keywords || []).join(", ")}. Use this to calibrate exactly how deep to go: cover the topic properly at this unit's level, but do not wander into content that belongs to a different unit or a more advanced course than JUPEB requires.`
    : `Use your knowledge of the JUPEB syllabus to calibrate how deep to go — cover the topic properly at first-year Nigerian JUPEB depth, not a more advanced course.`;

  return `${persona}

The student wants full study notes on an entire topic — not just one question — thorough enough to substitute for a set of hand-written class notes, at genuine JUPEB exam depth. ${scopeLine}

Structure (adapt freely — this is a guide, not a rigid template):
- Open with the core idea or governing law/definition of the topic, in plain spoken language.
- Cover every sub-concept a JUPEB exam question on this topic could reasonably draw on — definitions, laws, formulas (with every symbol defined), processes, or literary/historical detail, whatever the subject demands.
- EVERY formula you include must be shown as a real display equation in $$...$$ — never described only in prose, never in \\[...\\] or \\(...\\) delimiters. And whenever a formula corresponds to a named law, rule, or theorem (Hooke's Law, Faraday's Law, Newton's Laws, Bernoulli's principle, Le Chatelier's principle, and so on), name it explicitly right next to the formula — that name is very often exactly how a JUPEB question will refer to it, so leaving it out costs the student recognition on exam day.
- Include at least one worked example or concrete illustration per major sub-concept — not just a defined term sitting on its own.
- Call out the 2-3 mistakes or misconceptions students most commonly make on this topic.
- Close with a short, high-density recap a student could reread the night before the exam.

This is meant to be thorough — noticeably longer than a single-question explanation is expected and fine. Don't pad with filler, but don't compress real content just to save space either.
${QUANT_SUBJECTS.includes(subject) ? `
${MATH_NOTATION_RULES}
` : ""}
Formatting: markdown ** for bold headers, nothing fancier. Simple, spoken English — the voice of a real teacher's own notes, not a textbook or an AI assistant.`;
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
    const {
      mode,           // "explain" (default) | "notes"
      subject,
      topic,
      question,
      options,        // real shape: { A: "...", B: "...", C: "...", D: "..." }
      correctAnswer,  // real shape: single letter, e.g. "C"
      studentAnswer,  // single letter, optional
      explanation,    // the stored, tested explanation — required as grounding for "explain"
      difficulty,     // optional: "easy" | "medium" | "hard" — used as context, not a forced template
      style,          // optional: "beginner" — requests the thorough re-teach variant
      courseCode,     // notes mode: e.g. "PHY 001"
      courseName,     // notes mode: e.g. "Mechanics & Properties of Matter"
      courseDesc,     // notes mode: short desc string
      keywords,       // notes mode: array of syllabus keywords for this course unit
      isLastFreeUse,
    } = req.body || {};

    const requestedMode = mode === "notes" ? "notes" : "explain";

    let systemPrompt, userPrompt, maxTokens;

    if (requestedMode === "notes") {
      if (!subject || !topic) {
        res.status(400).json({ error: "Missing required fields for notes: subject, topic" });
        return;
      }
      systemPrompt = buildNotesSystemPrompt({ subject, topic, courseCode, courseName, courseDesc, keywords });
      userPrompt = `Subject: ${subject}
Topic: ${topic}
${courseCode ? `Course unit: ${courseCode}${courseName ? ` — ${courseName}` : ""}` : ""}

Write full JUPEB-level study notes on this topic.`;
      maxTokens = 1800;
    } else {
      if (!subject || !question || !options || typeof options !== "object" || !correctAnswer || !explanation) {
        res.status(400).json({
          error: "Missing required fields: subject, question, options{}, correctAnswer, explanation",
        });
        return;
      }
      const optionsText = Object.entries(options)
        .map(([letter, text]) => `${letter}. ${text}`)
        .join(" | ");
      systemPrompt = buildExplainSystemPrompt({ subject, style });
      userPrompt = `Subject: ${subject}
Topic: ${topic || "N/A"}
Difficulty: ${difficulty || "medium"}
Question: ${question}
Options: ${optionsText}
Correct answer: ${correctAnswer}${studentAnswer ? `\nStudent's answer: ${studentAnswer}` : ""}
Stored explanation (the correct, tested method — build on this, do not replace it): ${explanation}

Help the student understand why the correct answer is right${studentAnswer ? ", and address the specific misconception behind picking their wrong answer" : ""}.`;
      maxTokens = 1000;
    }

    const aiRes = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("Groq API error:", aiRes.status, errText);
      res.status(aiRes.status === 429 ? 429 : 502).json({
        error: `AI ${requestedMode === "notes" ? "notes" : "Tutor"} unavailable right now`,
        fallbackToStored: requestedMode === "explain",
      });
      return;
    }

    const aiData = await aiRes.json();
    const text = aiData?.choices?.[0]?.message?.content;

    if (!text) {
      res.status(502).json({ error: "Empty AI response", fallbackToStored: requestedMode === "explain" });
      return;
    }

    res.status(200).json({ text });

  } catch (err) {
    console.error("ai-tutor function error:", err);
    res.status(500).json({ error: "Unexpected server error", fallbackToStored: true });
  }
}
