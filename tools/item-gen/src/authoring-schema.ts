/**
 * JSON Schema for `codex exec --output-schema`, enforcing the authoring
 * call's output shape server-side (OpenAI's structured-outputs feature)
 * instead of only requesting it in prose. Two constraints confirmed by
 * real failing calls before settling on this shape:
 *
 * 1. The schema root must be `type: "object"` — a bare top-level array is
 *    rejected with a real 400. The item array is wrapped as
 *    `{"items": [...]}`, matching `parseAuthoringResponse`'s updated
 *    top-level expectation.
 * 2. Every key listed in `properties` must also appear in `required` —
 *    also a real 400 otherwise. A field that's genuinely optional in
 *    content (the correct option's own `distractor_rationale` entry) is
 *    expressed as `type: ["string", "null"]` and required-but-nullable,
 *    not omitted — confirmed to work by a real call, and tolerated as-is
 *    by `tryParseDraft`'s existing `typeof rationale === 'string' ? ... : null`.
 *
 * Only lists the fields `tryParseDraft` actually reads — the old prompt's
 * `id`/`subject`/`topic`/`subtopic`/`objective`/`status` keys were always
 * descriptive filler the parser never looked at; defining this schema is
 * what surfaced that, and it doesn't resurrect them.
 */
export const AUTHORING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stem: { type: 'string' },
          options: {
            type: 'object',
            properties: {
              A: { type: 'string' },
              B: { type: 'string' },
              C: { type: 'string' },
              D: { type: 'string' },
            },
            required: ['A', 'B', 'C', 'D'],
            additionalProperties: false,
          },
          correct_option: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          distractor_rationale: {
            type: 'object',
            properties: {
              A: { type: ['string', 'null'] },
              B: { type: ['string', 'null'] },
              C: { type: ['string', 'null'] },
              D: { type: ['string', 'null'] },
            },
            required: ['A', 'B', 'C', 'D'],
            additionalProperties: false,
          },
          explanation: { type: 'string' },
          method_steps: { type: 'array', items: { type: 'string' } },
          cognitive_level: {
            type: 'string',
            enum: ['recall', 'comprehension', 'application', 'analysis'],
          },
          author_difficulty: { type: 'number' },
          expected_time_seconds: { type: 'integer' },
          contains_calculation: { type: 'boolean' },
        },
        required: [
          'stem',
          'options',
          'correct_option',
          'distractor_rationale',
          'explanation',
          'method_steps',
          'cognitive_level',
          'author_difficulty',
          'expected_time_seconds',
          'contains_calculation',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;
