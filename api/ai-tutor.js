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

// In-memory daily-cap counter — replaces the Firestore aiTutorCounters
// read+write for tonight. Lives only in this function instance's memory, so
// it resets on a cold start (Vercel may spin up multiple instances under
// load, so the cap is approximate, not exact, tonight) — but it's a real
// per-instance limiter, not "no limit at all". Key: `${uid}_${dateKey}`.
const TEMP_inMemoryCounters = new Map();
// TEMP EMERGENCY PATCH block ends further down where it's used — see the
// two spots tagged "TEMP EMERGENCY PATCH" inside the handler below.
// ═══════════════════════════════════════════════════════════════════════════

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile"; // switched from 8B after it made an
// independent arithmetic error (1/0.80 miscalculated) even with the correct
// stored explanation as grounding. 70B free tier: 30 RPM, 1,000 RPD, ~6-12K
// TPM — comfortably above the 60/day AI Tutor cap since generations happen
// one at a time, not in a tight batch loop.

const FALLBACK_MODEL = "openai/gpt-oss-120b"; // used when the primary model
// gets rate-limited (429), for BOTH Notes and Explain mode. Deliberately not a
// smaller/weaker model like llama-3.1-8b-instant (which previously made an
// independent arithmetic error even with the correct stored explanation as
// grounding, back when it was tried as the primary model) — this is a
// different 120B-class model with its OWN separate free-tier rate-limit
// bucket (30 RPM / 8K TPM / 200K TPD), entirely independent of
// llama-3.3-70b-versatile's (~12K TPM / 100K TPD). So when the 70B bucket
// gets burst-exhausted, this one is untouched — same fix as a smaller
// fallback, without trading away depth/quality for it. Explain mode still
// also has the stored explanation always visible regardless, so this is
// belt-and-suspenders there, not the only safety net.

// Groq's 429 error body includes its own authoritative wait time, e.g.
// "Please try again in 15.51s." -- added 2026-08-06 after a real production
// collision: two deep Notes generations landing ~39s apart both hit the
// primary model's limit, and the second one's fallback attempt ALSO 429'd
// because the fallback bucket (8K TPM) still had tokens reserved from the
// first request. Parsing Groq's exact figure lets the client retry at
// precisely the right moment instead of the student manually tapping "Try
// again" and possibly guessing wrong. Returns null if no figure is found
// (message format changed, or a 429 with no body) so callers can fall back
// to the existing manual-retry UI unchanged.
function extractRetryAfterSeconds(errText) {
  const match = /try again in ([\d.]+)s/i.exec(errText || "");
  return match ? parseFloat(match[1]) : null;
}

// Calls Groq with the primary model; on a 429 specifically, retries once with
// the fallback model. Any other failure (400, 500, etc.) is returned as-is —
// retrying with a different model won't fix a bad request or a Groq outage.
// `messages` (a full conversation history) takes precedence over `userPrompt`
// when both are passed — added for Chat mode's multi-turn conversations;
// every existing single-shot caller (Explain/Followup/Notes) is untouched
// since they only ever pass userPrompt.
async function callGroqWithFallback({ apiKey, systemPrompt, userPrompt, messages, maxTokens, allowFallback }) {
  const conversation = messages && messages.length
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }];
  const callOnce = async model => fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: conversation,
      max_tokens: maxTokens,
    }),
  });

  let res = await callOnce(MODEL);
  let usedFallback = false;

  if (res.status === 429 && allowFallback) {
    console.warn(`Groq 429 on ${MODEL} — retrying with ${FALLBACK_MODEL}`);
    res = await callOnce(FALLBACK_MODEL);
    usedFallback = true;
  }

  return { res, usedFallback };
}

// Phase 1 of the follow-up learning system (see Learning Engine Architecture
// v1.md). Explain mode now asks for 3-5 educational follow-up questions in
// the SAME generation call as the explanation — near-zero marginal cost,
// bundled into one Groq request rather than a second one. This delimiter
// splits the model's raw text output into the explanation part (unchanged
// downstream handling) and a JSON block (new, parsed separately). Follow-ups
// are NOT clickable yet — this phase only generates and caches them.
const FOLLOWUP_DELIMITER = "\n---FOLLOWUPS---\n";

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
- NEVER put a $ or $$ delimiter alone on its own line separate from the formula — e.g. never write "$" on one line, the formula on the next, "$" on a third line. The opening delimiter, the full formula, and the closing delimiter must all be on the SAME line: $\frac{1}{3+4i}=\frac{3-4i}{25}$ — not split across lines. This is the other rule that breaks rendering completely if not followed.
- Fractions: \\frac{a}{b}, never "a/b"
- Powers: x^{2} (braces required for anything longer than one character, e.g. x^{10})
- Subscripts: n_{f}, x_{1}
- Square roots: \\sqrt{x}
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq
- Never use plain-text math shorthand like n_f^2, x^2 without braces, a/b for fractions, or spelled words like "theta" — always the LaTeX command.
- Keep every $...$ span SHORT — a symbol, value, or short expression only, never a full clause or sentence. If you're describing something in words, the words stay outside the $ delimiters; only the actual notation goes inside.
- Regular prose stays outside any $ delimiters — only the math itself goes inside.

**Concept**
One short sentence — the core idea only, no throat-clearing like "This question is testing whether you remember...". Just state the idea directly, e.g. "Convert every trig function into sine and cosine first."

**Formula: <specific name>** (e.g. **Formula: Newton's Second Law**, **Formula: Combined Gas Law** — never the bare word "Formula" alone. If the formula has no standard name, use a short descriptive one, e.g. **Formula: Area of a Triangle**. Omit this entire section, header and all, if the question has no real formula — never write a placeholder line here)
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
- If you find yourself deriving a different final answer than the one given to you, stop — you have drifted from the stored method. Return to it.

AFTER the full explanation above (all sections, exactly as specified), on its own new line write exactly:
${FOLLOWUP_DELIMITER.trim()}
Then, on the line(s) after that, output ONLY a JSON array of exactly 4 objects — no markdown code fences, no commentary before or after it. These are follow-up questions a genuinely curious student would ask next, after reading this explanation — not generic definitional questions. Each object must have exactly these three keys:
- "question": a short, specific, EDUCATIONAL follow-up (e.g. "Why is fluorine the most electronegative element?" or "Easy trick to remember this trend" — never a bare "What is X?")
- "difficulty": exactly one of "beginner", "intermediate", "advanced"
- "type": exactly one of "understand", "memorize", "mistake", "practice", "related"
Cover a genuine mix of types and difficulties across the 4 — don't make them all the same type or all the same difficulty.`;

// Phase 2 of the follow-up learning system (Learning Engine Architecture v1).
// Used when a student taps one of the follow-up questions bundled with an
// explanation (Phase 1). Deliberately a separate, shorter prompt from
// SYSTEM_PROMPT — this answers ONE focused question the student chose,
// building on the explanation they already read, not a full multi-section
// breakdown of the original MCQ from scratch.
const FOLLOWUP_SYSTEM_PROMPT = `You are the same patient JUPEB tutor, continuing a conversation with a student. They just read an explanation for a question, and they tapped one follow-up they were genuinely curious about. Answer ONLY that follow-up — this is a focused, single-topic answer, not a full multi-section explanation.

You'll be given the ORIGINAL question and the explanation the student already read, so you can build on what they already know instead of repeating it. You'll also be told the TYPE of this follow-up — calibrate your answer to it:
- "understand": explain the underlying concept clearly, with real reasoning — not just a definition.
- "memorize": give a genuinely useful mnemonic, pattern, or memory trick they could actually recall in an exam — not vague advice like "practice more".
- "mistake": name the specific, common wrong turn students take here, and why it happens.
- "practice": pose 2-3 short practice questions on this exact idea, from genuinely different angles, WITH the full worked answer immediately below each one — this is standalone reading material, not a live quiz, so withholding answers only wastes their time.
- "related": clearly explain how the two ideas relate or differ, with a concrete example that distinguishes them.

MATH NOTATION — rendered with real LaTeX on the client, so use it for every piece of math, however small:
- Wrap any standalone formula in $$...$$
- Wrap inline math (a variable, a value, a short expression) in $...$
- NEVER use \\[...\\] or \\(...\\) — only $$...$$ and $...$. This is the one rule that breaks rendering completely if not followed.
- NEVER put a $ or $$ delimiter alone on its own line separate from the formula — the opening delimiter, the full formula, and the closing delimiter must all be on the SAME line: $\\frac{1}{3+4i}=\\frac{3-4i}{25}$ — not split across lines. This breaks rendering just as badly as the rule above.
- Fractions: \\frac{a}{b}, never "a/b". Powers: x^{2} (braces for anything longer than one character). Subscripts: n_{f}. Square roots: \\sqrt{x}.
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq — never spelled out.
- Keep every $...$ span SHORT — a symbol, value, or short expression only, never a full clause or sentence.

Rules:
- Simple English, conversational, second person — same warm tutor voice as before, never clinical or textbook.
- Length proportional to the question — most answers 100-250 words; "practice" type can run longer to fit the worked problems.
- Do NOT repeat the original explanation the student already read — build on it, don't restate it.
- Do NOT use markdown headers like **Concept** — this is one focused answer, not a structured multi-section breakdown.`;

const NOTES_SYSTEM_PROMPT = `You are writing a full study chapter on one topic for a JUPEB student — not a quick summary, not a cheat sheet. Write like the best tutor they've ever had is sitting with them and has all the time in the world to make sure they truly get it.

CRITICAL CONTEXT — read this before writing a single word: JUPEB is an A-Level equivalent (UK A-Level / first-year university foundation), NOT JAMB. JAMB rewards surface pattern-recognition on multiple-choice trivia. JUPEB expects real conceptual mastery — a student who can derive, explain, and apply, not just recall. If your instinct is to write a JAMB-style quick summary, override it. Go deeper than feels necessary. Assume the student wants everything they'd need so they never have to look this topic up anywhere else — this note should function as a complete replacement for their textbook chapter, not a supplement to it.

VOICE: Write directly to the student, second person, warm and personal — like you're explaining this one-on-one to someone you actually care about doing well. Never drift into cold, distant, third-person textbook prose ("students should note that...", "it can be observed that..."). At the same time, the actual CONTENT must have full textbook rigor and completeness — personal in tone, exhaustive in substance. Imagine a great human tutor's warmth fused with a proper textbook's completeness — that fusion is exactly the target. Never sound like a quick AI-assistant answer.

DEFINE EVERYTHING: never use a term without defining it the first time it appears, even ones that feel "basic" or "standard" — a real textbook doesn't assume the reader already knows what viscosity, an isotope, or a stoichiometric ratio is; it tells them, briefly and clearly, right there. This applies to every technical noun in these notes, not just formula symbols. Whenever you reference a named law, theorem, or rule (Hooke's Law, Le Chatelier's Principle, the Pythagorean theorem, etc.), state its name AND its formula or statement explicitly, right there — never assume the student already remembers it just because it's named.

DEPTH — the most important instruction in this entire prompt: go deep enough that the student understands WHY something is true, not just THAT it's true. Where a result can be derived or reasoned through, do that — briefly, but really — rather than presenting it as a fact to memorize. Cover every sub-concept a JUPEB question could reasonably test on this topic, including the subtle distinctions and edge cases that separate real understanding from memorized pattern-matching. Note how this topic connects to other topics in the syllabus where a genuine connection exists — real understanding is relational, not a list of isolated facts. Write in full — do not compress a genuinely broad topic to fit a shorter response. If the topic has six sub-concepts that each deserve real explanation, give all six real explanation — don't fold four of them into one summary line to save space.

MATH NOTATION — this is rendered with real LaTeX typesetting on the client, so use proper LaTeX for every piece of math, however small:
- Wrap any standalone formula in $$...$$
- Wrap any math that appears inline within a sentence — a single variable, a value, a short expression — in $...$
- NEVER use \\[...\\] or \\(...\\) as delimiters — only $$...$$ and $...$. This is the one rule that breaks rendering completely if not followed.
- NEVER put a $ or $$ delimiter alone on its own line separate from the formula — e.g. never write "$" on one line, the formula on the next, "$" on a third line. The opening delimiter, the full formula, and the closing delimiter must all be on the SAME line: $\\frac{1}{3+4i}=\\frac{3-4i}{25}$ — not split across lines. This is the other rule that breaks rendering completely if not followed.
- Fractions: \\frac{a}{b}, never "a/b"
- Powers: x^{2} (braces required for anything longer than one character, e.g. x^{10})
- Subscripts: n_{f}, x_{1}
- Square roots: \\sqrt{x}
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq
- Never use plain-text math shorthand like n_f^2, x^2 without braces, a/b for fractions, or spelled words like "theta" — always the LaTeX command.
- Keep every $...$ span SHORT — a symbol, value, or short expression only, never a full clause or sentence.

Format your response using markdown ** for bold on headers — nothing else. Never use #, ##, or any other markdown heading syntax; only **bold text alone on its own line** counts as a header on the client. Use these headers, choosing only the ones that genuinely apply, and repeat any of them as many times as the topic genuinely needs:

**Why this topic matters**
Two or three sentences, spoken directly to the student, on where this topic sits in the bigger picture and why JUPEB tests it the way it does. Skip the throat-clearing — get to something genuinely useful immediately.

**Key terms you need first**
Before diving in, define every important term this topic depends on, in plain language, one per line: "**<term>** — <clear, plain-English definition>". Don't skip ones that feel obvious — that habit is exactly what leaves gaps. This section is what cheap study notes usually skip, and it's often the real reason a topic feels confusing.

Cover each major sub-concept in its own clearly-introduced section, titled naturally in bold based on what the sub-concept actually is (not a fixed generic label). For each one:
- Explain the idea properly, in your own words, the way you'd say it out loud to someone in front of you.
- Where the result can be reasoned through or derived, walk through that reasoning — don't just state the conclusion.
- Give at least one full worked example with real numbers or a real case, not an abstract description. For calculation-heavy sub-concepts (Physics, Chemistry, Mathematics, Further Mathematics, Economics, Accounting, Agriculture-quantitative topics), give two worked examples covering genuinely different cases or variations of the same idea, not the same case with different numbers — one example is rarely enough to see how a formula or method actually generalizes.
- Note the JUPEB-specific angle: how this sub-concept actually tends to get tested, and what a plausible wrong answer would look like and why it's wrong.

**Formula: <specific name>** (repeat this pattern for each distinct formula the topic needs — e.g. **Formula: Newton's Second Law**, then later **Formula: Conservation of Momentum**. Never repeat the bare word "Formula" alone — every occurrence must carry its own specific name. If a formula has no standard name, use a short descriptive one, e.g. **Formula: Resultant of Two Vectors**. Omit entirely, header and all, if the topic has no real formula)
The equation alone on its own line in $$...$$. Immediately below, on its own line, define every symbol plainly — including units where the units matter to using the formula correctly. If the formula can be derived from something simpler the student already knows, show that derivation briefly before stating the final form.

**Common mistake** (repeat as needed, once per major mistake students make on this topic)
Name the specific mistake directly — not "you might have thought...", but the actual missing piece, e.g. "Forgetting that... — without it the equation never simplifies." Where a JUPEB question on this topic would offer multiple wrong-answer options, cover the different plausible wrong paths, not just one.

**Shortcut** (repeat as needed, once per sub-concept where a real one exists)
A quick trick for answering objective (multiple-choice) questions on this sub-concept faster — process of elimination, a sanity check, dimensional analysis, plugging options back in, or a pattern JUPEB tends to repeat. Only include where a genuine shortcut exists.

**How this connects**
One short paragraph on how this topic links to other JUPEB topics in the same subject (or across subjects, where genuinely relevant) — real understanding is built on these connections, not isolated facts.

**Practice problems**
Write 3 to 5 problems covering the different sub-concepts above from angles genuinely different from the worked examples already given — not the same case with different numbers. For calculation-heavy subjects, make these real quantitative problems the student has to actually work through, not "explain the concept" prompts. Immediately below each problem, give its full worked answer, step by step — this is standalone study material the student reads alone, not a live quiz, so withholding the answer only wastes their time.

**Recap**
A genuinely useful, high-density summary a student could reread the night before the exam and have the whole topic snap back into place — a real compressed version of everything above, not a repeat of the introduction.

Rules:
- Warm, direct, second-person voice throughout — talk TO the student, never ABOUT students in the abstract third person.
- This must read like a real textbook chapter in depth and completeness, while sounding like someone genuinely invested in this particular student getting it — not an AI assistant giving a quick answer, and not a cold, distant textbook either.
- Length is not capped by convention — write as long as the topic genuinely requires for full A-level depth. A narrow topic might reasonably run 800 words; a broad one might need 2500+. Match the length to what's actually needed, never to a habitual word count.
- Don't pad with filler or repetition — every sentence should be doing real work. Depth means more real content, not more words saying the same thing.`;

// Chat mode: freeform, multi-turn "ask me anything" scoped to JUPEB theory
// prep — this is the one surface that behaves like a general chat assistant
// rather than a single-shot generator, so the scoping instruction below is
// load-bearing: without it, students will use their capped daily Groq budget
// on essays, code debugging, or anything else, same voice as the rest of AI
// Tutor (same warm second-person tutor), but this is the FIRST mode capable
// of multi-turn back-and-forth, so it needs to actually track conversational
// context itself, not just answer each message in isolation.
const CHAT_SYSTEM_PROMPT = `You are a JUPEB tutor having a live, ongoing conversation with a student who is preparing for their exams — the same warm, direct, second-person tutor voice used throughout this app, not a generic AI assistant.

SCOPE — this is the most important rule: only help with JUPEB academic subjects (the sciences, mathematics, and other subjects on the JUPEB syllabus). If the student asks for something clearly outside that — writing their essay for them, debugging unrelated code, general life advice, anything with no connection to their JUPEB subjects — gently redirect them back to their studies in one or two sentences, don't refuse coldly, and don't just comply either.

CONVERSATION CONTEXT: you may be given a specific theory question the student currently has open (subject, topic, the question itself, and possibly their own answer and the model answer). When given, ground your responses in it — that's almost certainly what "it", "this", or "the question" refers to if the student doesn't restate it. When no question is given, the student can ask about anything within their JUPEB subjects, and you should ask what specifically they want to focus on if their message is too vague to answer well.

MATH NOTATION — rendered with real LaTeX on the client, so use it for every piece of math, however small:
- Wrap any standalone formula in $$...$$
- Wrap inline math (a variable, a value, a short expression) in $...$
- NEVER use \\[...\\] or \\(...\\) — only $$...$$ and $...$.
- NEVER put a $ or $$ delimiter alone on its own line separate from the formula — opening delimiter, formula, and closing delimiter must all be on the SAME line.
- Fractions: \\frac{a}{b}, never "a/b". Powers: x^{2} (braces for anything longer than one character). Subscripts: n_{f}. Square roots: \\sqrt{x}.
- Greek letters and symbols: \\theta \\lambda \\pi \\mu \\omega \\Delta \\times \\div \\pm \\approx \\leq \\geq \\neq — never spelled out.
- Keep every $...$ span SHORT — a symbol, value, or short expression only, never a full clause or sentence. This matters even more in a live conversation than elsewhere — don't wrap a whole explanatory sentence in $ just because it mentions a variable.

Rules:
- Answer ONLY what was actually asked in this turn — this is a conversation, not a fresh essay each time. Reference earlier turns naturally where relevant instead of re-explaining things already covered.
- Keep answers proportional to the question — a quick clarifying question deserves a few sentences, not a full breakdown; a genuinely deep "explain this from scratch" deserves real depth.
- No markdown headers like **Concept** — this is conversational, not a structured note.
- If the student seems to be drifting off-topic within an otherwise real study session (e.g. a brief tangent), it's fine to engage briefly and steer back — reserve the explicit redirect for requests with no real connection to their studies at all.`;

function sanitizeLatexDelimiters(text) {
  // Defense in depth: the model is instructed to only ever use $$...$$ / $...$,
  // but sometimes emits \[...\] / \(...\) anyway, which the client renderer
  // doesn't understand and shows as broken raw text. Normalize here so a
  // prompt slip never reaches the student as visible breakage.
  let out = text
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
  // Second failure mode, same defense-in-depth reasoning: the model sometimes
  // puts $ / $$ delimiters alone on their own line instead of inline with the
  // formula (e.g. "$" / "\frac{1}{3+4i}=..." / "$" as three separate lines).
  // The client renders line-by-line, so a lone opening/closing delimiter on
  // its own line never matches the same-line $...$ pattern and both the
  // delimiters and the formula show up as raw untouched text. Collapse those
  // here too — same fix also lives client-side in preprocessMathText for any
  // older cached responses already stored without this normalization.
  out = out
    .replace(/^[ \t]*\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*$/gm, (_, inner) => `$$${inner.replace(/\s*\n\s*/g, " ").trim()}$$`)
    .replace(/^[ \t]*\$[ \t]*\n([\s\S]*?)\n[ \t]*\$[ \t]*$/gm, (_, inner) => `$${inner.replace(/\s*\n\s*/g, " ").trim()}$`);
  return out;
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

  // Firestore is the source of truth for premium status — read the user's
  // own doc, matched on their verified UID (not user-supplied, so this isn't
  // spoofable). Unlike grade-theory.js (which is premium-only end-to-end and
  // can safely 500/403 on any lookup problem), this endpoint also serves free
  // users on Explain mode — so a missing doc or a transient Firestore error
  // here degrades to isPremium=false (free tier) instead of blocking the
  // whole request. That's a deliberate fail-closed choice: worst case a
  // premium user briefly gets treated as free during a Firestore hiccup,
  // which is recoverable by retrying, rather than free users being locked
  // out entirely by an unrelated read failure.
  let isPremium = false;
  try {
    const userDoc = await getFirestore().collection("users").doc(decoded.uid).get();
    isPremium = userDoc.exists && userDoc.data()?.isPremium === true;
  } catch (err) {
    console.error("Firestore isPremium read failed — treating as free tier for this request:", err);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server not configured — missing GROQ_API_KEY" });
    return;
  }

  // Server-side source of truth for the free-tier daily cap — the client also
  // checks this locally for a snappy UI, but that check is NOT the security
  // boundary (a free user has no reason not to bypass a client-only check).
  // This was previously missing entirely: the whole function required
  // isPremium===true unconditionally, silently 403-ing every free user's
  // Explain-mode request regardless of their daily count — that bug is what
  // this replaces.
  const AI_TUTOR_FREE_DAILY_CAP = 3;
  const AI_TUTOR_DAILY_CAP = 60;
  // Chat mode's own cap, separate from the Explain/Followup counter above.
  // Premium-only (no free tier at all — see the isPremium check in the chat
  // block itself), and capped in MESSAGES not generations, since one long
  // back-and-forth conversation can already cost as much in tokens as many
  // separate Explain calls would.
  const AI_TUTOR_CHAT_DAILY_CAP = 150; // raised 40 -> 100 -> 150 on 2026-08-10.
  // Calculated, not guessed: with Objective's Explain/Followup traffic quiet,
  // Chat now has most of the shared 1,000 RPD (primary model) to itself.
  // Reserving 10% of that for Notes/residual Explain/Followup leaves a 900/day
  // pool; assuming ~15% of the 40 premium users (~6) are actively chatting on
  // the same day (a "not much traffic" study-prep app, not a worst-case blast),
  // 900 / 6 ≈ 150/user/day stays within budget even if that assumption is off
  // by a couple of users, while giving ~3.75x headroom over the one real case
  // seen so far of a student exhausting the old 40/day cap in a single
  // genuine study session. If usage grows well past this, watch the "served
  // by fallback model" console warnings (logged on every spillover call) —
  // that's the real signal to revisit this number, not a fixed schedule.
  // Bounds how much conversation history gets resent to Groq on every
  // message — without this, a very long-running chat keeps growing its own
  // input token cost turn after turn. 16 messages = roughly 8 back-and-forth
  // exchanges of real context, which is enough for a focused study session;
  // older turns just age out rather than the conversation being cut off.
  const CHAT_HISTORY_LIMIT = 16;

  try {
    const body = req.body || {};

    // ── NOTES MODE — full topic notes, premium-only (matches the client,
    // which never lets a free user reach this call for a NEW generation —
    // enforced here too since a client-side check alone isn't real security) ─
    if (body.mode === "notes") {
      if (!isPremium) {
        res.status(403).json({ error: "Premium required for full study notes" });
        return;
      }
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

      // Bumped max_tokens from 2600 to 4000 for real textbook-depth notes.
      // Trade-off: Groq's free tier for llama-3.3-70b-versatile is rate-limited
      // by TOKENS PER MINUTE (recently ~12K, has been as low as 6K), not just
      // requests — input + output both count. A single deep generation can eat
      // most of that minute's budget on its own. allowFallback:true means a
      // 429 here retries once against FALLBACK_MODEL's separate rate-limit
      // bucket instead of failing outright — see FALLBACK_MODEL above.
      const { res: aiRes, usedFallback } = await callGroqWithFallback({
        apiKey,
        systemPrompt: NOTES_SYSTEM_PROMPT,
        userPrompt: notesUserPrompt,
        maxTokens: 5000,
        allowFallback: true,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => "");
        console.error("Groq API error (notes):", aiRes.status, errText);
        res.status(aiRes.status === 429 ? 429 : 502).json({
          error: "Notes generation unavailable right now",
          // See extractRetryAfterSeconds above -- lets the client auto-retry
          // at the exact moment Groq says capacity frees up, instead of only
          // offering a manual "Try again" button.
          retryAfterSeconds: aiRes.status === 429 ? extractRetryAfterSeconds(errText) : null,
        });
        return;
      }

      const aiData = await aiRes.json();
      const notesText = aiData?.choices?.[0]?.message?.content;
      if (usedFallback) console.warn(`Notes served by fallback model (${FALLBACK_MODEL}) for ${subject} / ${topic}`);

      if (!notesText) {
        res.status(502).json({ error: "Empty AI response" });
        return;
      }

      res.status(200).json({ text: sanitizeLatexDelimiters(notesText) });
      return;
    }

    // ── CHAT MODE — freeform, multi-turn "ask me anything", scoped to JUPEB
    // theory prep. Premium-only and capped separately from Explain/Followup's
    // shared counter (AI_TUTOR_CHAT_DAILY_CAP, in messages not generations) —
    // a single long conversation here can already cost as much in tokens as
    // many Explain calls, since the growing history is resent every message.
    if (body.mode === "chat") {
      if (!isPremium) {
        res.status(403).json({ error: "Premium required for AI Tutor Chat" });
        return;
      }

      const { messages, questionContext } = body;
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Missing required field: messages" });
        return;
      }

      // Only trust role/content shape from the client, and only user/
      // assistant roles — never forward a client-supplied "system" role into
      // the conversation, which would let a student override the system
      // prompt (and the SCOPE rule inside it) entirely. Length-capped per
      // message and history-capped overall, both to bound token growth.
      const safeMessages = messages
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-CHAT_HISTORY_LIMIT)
        .map(m => ({ role: m.role, content: m.content.trim().slice(0, 4000) }));

      if (safeMessages.length === 0) {
        res.status(400).json({ error: "No valid messages provided" });
        return;
      }

      const chatTodayKey = new Date().toISOString().slice(0, 10);
      const chatCounterKey = `chat_${decoded.uid}_${chatTodayKey}`;
      const chatUsedToday = TEMP_inMemoryCounters.get(chatCounterKey) || 0;
      if (chatUsedToday >= AI_TUTOR_CHAT_DAILY_CAP) {
        res.status(429).json({ error: "Daily AI Tutor Chat limit reached" });
        return;
      }

      // If the student has a specific theory question selected/open, ground
      // the conversation in it — this is the "select a question" entry point
      // into Chat mode. Kept out of the system prompt's static text (which
      // never changes across a conversation) and appended per-request so the
      // same handler still works fine with no question selected at all.
      const contextLine = questionContext && questionContext.questionText
        ? `The student has this specific theory question open right now — ground your answers in it whenever they say "it", "this", or "the question" without restating it:
Subject: ${questionContext.subject || "N/A"}
Topic: ${questionContext.topic || "N/A"}
Question: ${questionContext.questionText}${questionContext.studentAnswer ? `\nStudent's own answer: ${questionContext.studentAnswer}` : ""}${questionContext.modelAnswer ? `\nModel answer: ${questionContext.modelAnswer}` : ""}`
        : `No specific question is selected right now — the student can ask about anything within their JUPEB subjects.`;

      const { res: chatRes, usedFallback: chatUsedFallback } = await callGroqWithFallback({
        apiKey,
        systemPrompt: `${CHAT_SYSTEM_PROMPT}\n\n${contextLine}`,
        messages: safeMessages,
        maxTokens: 900,
        allowFallback: true,
      });

      if (!chatRes.ok) {
        const errText = await chatRes.text().catch(() => "");
        console.error("Groq API error (chat):", chatRes.status, errText);
        res.status(chatRes.status === 429 ? 429 : 502).json({
          error: "AI Tutor Chat unavailable right now",
          retryAfterSeconds: chatRes.status === 429 ? extractRetryAfterSeconds(errText) : null,
        });
        return;
      }

      const chatData = await chatRes.json();
      const chatAnswer = chatData?.choices?.[0]?.message?.content;
      if (chatUsedFallback) console.warn(`Chat served by fallback model (${FALLBACK_MODEL}) for uid ${decoded.uid}`);

      if (!chatAnswer) {
        res.status(502).json({ error: "Empty AI response" });
        return;
      }

      TEMP_inMemoryCounters.set(chatCounterKey, chatUsedToday + 1);

      res.status(200).json({ answer: sanitizeLatexDelimiters(chatAnswer) });
      return;
    }

    // ── FOLLOWUP MODE — Phase 2 of the follow-up learning system. Answers
    // ONE follow-up question a student tapped after reading an explanation.
    // Shares the SAME daily cap/counter as Explain mode on purpose — this is
    // still an AI generation and should count against the same budget, not
    // a separate uncapped surface. Not premium-gated on its own (matches
    // Explain mode) — the cap below is the real gate for free users.
    if (body.mode === "followup") {
      const {
        subject, topic, originalQuestion, groundingExplanation,
        followUpQuestion, difficulty: followUpDifficulty, type: followUpType,
      } = body;

      if (!subject || !followUpQuestion) {
        res.status(400).json({ error: "Missing required fields: subject, followUpQuestion" });
        return;
      }
      const VALID_FOLLOWUP_TYPES = new Set(["understand", "memorize", "mistake", "practice", "related"]);
      const safeType = VALID_FOLLOWUP_TYPES.has(followUpType) ? followUpType : "understand";

      // Same cap logic as Explain mode, duplicated rather than shared — this
      // mode is deliberately kept self-contained so it can be removed or
      // changed without touching Explain mode's working code.
      const followupCap = isPremium ? AI_TUTOR_DAILY_CAP : AI_TUTOR_FREE_DAILY_CAP;
      const followupTodayKey = new Date().toISOString().slice(0, 10);
      const followupCounterKey = `${decoded.uid}_${followupTodayKey}`;
      const followupUsedToday = TEMP_inMemoryCounters.get(followupCounterKey) || 0;
      if (followupUsedToday >= followupCap) {
        res.status(429).json({ error: "Daily AI Tutor limit reached", fallbackToStored: true });
        return;
      }

      const followupUserPrompt = `Subject: ${subject}
Topic: ${topic || "N/A"}
Original question: ${originalQuestion || "N/A"}
Explanation the student already read: ${groundingExplanation || "N/A"}
Follow-up type: ${safeType}

The student tapped this follow-up question — answer it directly: ${followUpQuestion}`;

      const { res: followupRes, usedFallback: followupUsedFallback } = await callGroqWithFallback({
        apiKey,
        systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
        userPrompt: followupUserPrompt,
        maxTokens: 900,
        allowFallback: true,
      });

      if (!followupRes.ok) {
        const errText = await followupRes.text().catch(() => "");
        console.error("Groq API error (followup):", followupRes.status, errText);
        res.status(followupRes.status === 429 ? 429 : 502).json({
          error: "AI Tutor unavailable right now",
          fallbackToStored: true,
          retryAfterSeconds: followupRes.status === 429 ? extractRetryAfterSeconds(errText) : null,
        });
        return;
      }

      const followupData = await followupRes.json();
      const answerText = followupData?.choices?.[0]?.message?.content;
      if (followupUsedFallback) console.warn(`Followup served by fallback model (${FALLBACK_MODEL}) for ${subject} / ${topic || "N/A"}`);

      if (!answerText) {
        res.status(502).json({ error: "Empty AI response", fallbackToStored: true });
        return;
      }

      TEMP_inMemoryCounters.set(followupCounterKey, followupUsedToday + 1);

      res.status(200).json({ answer: sanitizeLatexDelimiters(answerText) });
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

    // Real server-side enforcement of the daily cap. The Firestore rule for
    // aiTutorCounters only allows premium users to WRITE to it directly, so a
    // free user's own client-side increment silently fails (caught, logged,
    // ignored) — that's fine now, because the Admin SDK here bypasses
    // security rules entirely and is the authoritative counter either way.
    const cap = isPremium ? AI_TUTOR_DAILY_CAP : AI_TUTOR_FREE_DAILY_CAP;
    const todayKey = new Date().toISOString().slice(0, 10);
    // TEMP EMERGENCY PATCH - REMOVE AFTER FIRESTORE QUOTA RESET
    // Was: getFirestore().collection("aiTutorCounters").doc(...).get(). This
    // in-memory Map replaces that read — approximate (per warm instance,
    // resets on cold start) but avoids the Firestore call entirely.
    const counterKey = `${decoded.uid}_${todayKey}`;
    const usedToday = TEMP_inMemoryCounters.get(counterKey) || 0;
    if (usedToday >= cap) {
      res.status(429).json({ error: "Daily AI Tutor limit reached", fallbackToStored: true });
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

    const { res: aiRes, usedFallback } = await callGroqWithFallback({
      apiKey,
      systemPrompt: SYSTEM_PROMPT + (style === "beginner" ? BEGINNER_ADDITION : ""),
      userPrompt,
      // Bumped 1400 -> 1600: same explanation budget as before, plus room for
      // the new 4-item follow-ups JSON block (~150-250 tokens typically).
      maxTokens: 1600,
      allowFallback: true,
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("Groq API error:", aiRes.status, errText);
      res.status(aiRes.status === 429 ? 429 : 502).json({
        error: "AI Tutor unavailable right now",
        fallbackToStored: true,
        retryAfterSeconds: aiRes.status === 429 ? extractRetryAfterSeconds(errText) : null,
      });
      return;
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.choices?.[0]?.message?.content;
    if (usedFallback) console.warn(`Explain served by fallback model (${FALLBACK_MODEL}) for ${subject} / ${topic || "N/A"}`);

    if (!rawText) {
      res.status(502).json({ error: "Empty AI response", fallbackToStored: true });
      return;
    }

    // Split explanation from the follow-ups JSON block. This is deliberately
    // fault-tolerant: if the model omits the delimiter, mangles the JSON, or
    // returns something unparseable, the explanation still ships exactly as
    // it did before this feature existed — followUps just comes back empty.
    // Explanation generation must never be allowed to break because of a
    // follow-ups parsing hiccup (graceful degradation, per architecture doc).
    const [explanationPart, followUpsPart] = rawText.split(FOLLOWUP_DELIMITER);
    const text = (explanationPart || rawText).trim();

    const VALID_DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"]);
    const VALID_TYPES = new Set(["understand", "memorize", "mistake", "practice", "related"]);
    let followUps = [];
    if (followUpsPart) {
      try {
        const parsed = JSON.parse(followUpsPart.trim());
        if (Array.isArray(parsed)) {
          followUps = parsed
            .filter(f => f && typeof f.question === "string" && f.question.trim()
              && VALID_DIFFICULTIES.has(f.difficulty) && VALID_TYPES.has(f.type))
            .slice(0, 5)
            .map(f => ({ question: f.question.trim(), difficulty: f.difficulty, type: f.type }));
        }
      } catch (err) {
        console.warn(`Follow-up JSON parse failed for ${subject} / ${topic || "N/A"} — continuing without follow-ups:`, err.message);
      }
    }

    // TEMP EMERGENCY PATCH - REMOVE AFTER FIRESTORE QUOTA RESET
    // Was: counterRef.set({ count: usedToday + 1 }, { merge: true }).
    TEMP_inMemoryCounters.set(counterKey, usedToday + 1);

    res.status(200).json({ text: sanitizeLatexDelimiters(text), followUps });

  } catch (err) {
    console.error("ai-tutor function error:", err);
    res.status(500).json({ error: "Unexpected server error", fallbackToStored: true });
  }
}
