# Item Generation Spec — JAMB UTME Bank

How to produce the question bank with AI authoring and human review, at scale.

---

## 1. The cost model

AI authoring does not remove content cost. It moves it from **authoring** to **reviewing**, which is where the saving is.

| Step | Human-only | AI-authored + human review |
|---|---|---|
| Write stem + 4 options | 6–10 min | 0 |
| Write worked explanation | 5–8 min | 0 |
| Tag to syllabus objective | 2 min | 0 |
| Subject review | 3 min | 3 min |
| Correction / rework | 2 min | 2–4 min (higher rework rate) |
| **Effective minutes per accepted item** | **~18–25** | **~5–7** |

Expect a **60–75% reduction** in cost per item, not 100%. Budget for review, not for zero.

Second-order saving: a reviewer working on drafts is a cheaper hire than an author who must originate items. You need subject accuracy, not writing skill.

---

## 2. Where AI authoring is safe and where it is not

**Low risk — generate freely, spot-check a sample:**
- Use of English: lexis, structure, concord, prepositions, idioms, collocation
- Definitions and recall items across all sciences
- Biology: physiology, ecology, classification, genetics ratios
- Government, Economics, CRS/IRS, Commerce: doctrine, definitions, principles

**High risk — review every single item:**
- **Any item with a calculation.** Maths, Physics, Chemistry quantitative. Arithmetic slips are the single most common failure and produce a wrong key that looks entirely plausible.
- **Diagram-dependent items.** Circuits, ray diagrams, apparatus, graphs. Do not generate these as text; commission them.
- **Literature and the recommended reading text.** The set text changes each cycle. AI will confidently invent plot details for a book it has not read. Author these with a human who has the actual text in front of them, always.
- **Anything touching current events**: recent policy, office holders, current statistics in Economics or Government.
- **Oral English stress and vowel-sound items.** Pronunciation judgements need a human ear.

**Never generate:**
- Reproductions of actual past JAMB papers. Original items only — this is both a copyright position and a quality one.

---

## 3. Automated pre-review gates

Run these before an item reaches a human. They catch most of the cheap failures and cut reviewer time significantly.

1. **Independent solve.** Send the stem and options to a *second, separate* model call with no sight of the proposed key, and ask it to solve. If the two answers disagree, flag for human review immediately. This one check catches the majority of calculation errors.
2. **Key distribution.** Across a batch, A/B/C/D should be roughly 25% each. Generated banks skew heavily toward C. Rebalance by permuting options — and permute the explanation's option references with them.
3. **Duplicate detection.** Embed each stem and reject any item within a similarity threshold of an existing one. Generated batches repeat themselves more than you would expect.
4. **Schema validation.** Exactly four options, exactly one key, key present in the options, explanation non-empty, valid objective ID, no option that is a substring duplicate of another.
5. **Distractor sanity.** Reject items where any distractor is obviously absurd, where "all of the above" or "none of the above" appears, or where option lengths differ markedly — length is a giveaway that test-wise candidates exploit.
6. **Numeric plausibility.** For calculation items, require that each distractor corresponds to a *named* likely error (wrong formula, unit slip, sign error). This is specified in the prompt below and is checkable.

---

## 4. The authoring prompt

Use one call per objective, requesting 8–12 items. Small batches per objective produce better tagging and less repetition than large undifferentiated batches.

```
You are an experienced Nigerian secondary school teacher authoring practice
items for the JAMB UTME.

SUBJECT: {subject}
TOPIC: {topic}
SUBTOPIC: {subtopic}
SYLLABUS OBJECTIVE: {objective_text}
DIFFICULTY TARGET: {easy | moderate | challenging}
COGNITIVE LEVEL: {recall | comprehension | application | analysis}
COUNT: {n}

Write {n} original multiple-choice items meeting ALL of the following:

STYLE
- Match the register, length and phrasing conventions of the JAMB UTME.
- Exactly four options, lettered A to D, exactly one unambiguously correct.
- Answerable in about 40 seconds by a well-prepared candidate.
- Use Nigerian contexts and naira amounts where a context is needed.
- SI units, standard chemical and mathematical notation.

DISTRACTORS
- Every distractor must be the result of a SPECIFIC, NAMED plausible error
  (wrong formula, unit not converted, sign error, common misconception).
- State that error in the "distractor_rationale" field for each option.
- No "all of the above", no "none of the above", no joke options.
- Keep all four options similar in length and grammatical form.

EXPLANATIONS
- Teach the method, not just the answer.
- Show every step of the working for calculations.
- Name the specific misconception the most attractive distractor represents.

CONSTRAINTS
- Do NOT reproduce or closely paraphrase any past examination question.
- Do NOT write items requiring a diagram, graph or image.
- Do NOT reference the JAMB recommended reading text.
- If you cannot write a defensible item for this objective, return fewer
  items rather than padding.

Return ONLY valid JSON, an array of objects with these keys:
id, subject, topic, subtopic, objective, cognitive_level,
author_difficulty (0-1), expected_time_seconds, stem, options {A,B,C,D},
correct_option, distractor_rationale {A,B,C,D}, explanation,
method_steps (array), status ("draft_ai"), needs_review (true)
```

---

## 5. Production workflow

```
syllabus objectives table
        │
        ▼
  generation queue  ──►  authoring call (n=10 per objective)
        │
        ▼
  automated gates (independent solve, dedupe, schema, key balance)
        │
        ├── fail ──► regenerate or route straight to human
        ▼
  human review queue, prioritised: calculations first, recall last
        │
        ▼
  approved → live bank, status "uncalibrated"
        │
        ▼
  served to candidates → response data → difficulty & discrimination
        │
        ▼
  calibrated  |  or auto-quarantined if discrimination is poor
```

The final stage matters more than any of the earlier ones. **Live response data is the real quality filter.** An item that strong and weak candidates answer identically is worthless regardless of who wrote it, and only usage reveals that. Ship, measure, retire.

---

## 6. Suggested sequencing

| Wave | Scope | Volume | Review intensity |
|---|---|---|---|
| 1 | Use of English, Biology — low-risk objectives | 2,000 | Sample 30% |
| 2 | Mathematics, Physics, Chemistry — calculations | 3,000 | 100%, calculation-focused |
| 3 | Government, Economics, CRS/IRS, Commerce, Geography | 3,000 | Sample 50% |
| 4 | Literature and reading text | 800 | Human-authored, not AI |
| 5 | Diagram-dependent items across sciences | 1,200 | Human-authored + illustrator |

Waves 4 and 5 are where the real content budget goes. Plan for them; they are the part AI cannot do well.

---

## 7. Honest limits

- **Errors will reach production.** Build the in-app "Report a problem" control and the automatic quarantine rule from day one. This is your safety net and it is not optional.
- **Style drift.** Generated items skew slightly more verbose and more "textbook" than real UTME items. Have your content lead read 50 items against 50 real past questions and write a style correction into the prompt.
- **Difficulty estimates are guesses** until calibrated. Do not trust `author_difficulty` for adaptive selection; use it only to seed the bank.
- **A bank nobody has reviewed is a liability, not an asset.** One viral screenshot of a wrong answer key costs more than the review budget you saved.
