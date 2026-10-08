// The wire contract is also imported as types by the frontend; no backend code is bundled.
export type VisualSummaryBlock =
  | { type: 'cards'; title: string; items: { title: string; text: string }[] }
  | { type: 'comparison'; title: string; columns: string[]; rows: string[][] }
  | { type: 'steps'; title: string; items: string[] }
  | { type: 'qa'; title: string; items: { question: string; answer: string }[] }

export interface VisualSummary {
  blocks: VisualSummaryBlock[]
}

export class InvalidVisualSummaryError extends Error {
  constructor() {
    super('Invalid visual summary')
    this.name = 'InvalidVisualSummaryError'
  }
}

// Use only the JSON Schema subset supported by the existing GenAI SDK. String lengths are
// enforced locally (the SDK's supported subset does not include minLength/maxLength).
const shortText = { type: 'string', description: 'Non-empty plain text, at most 120 characters.' }
const longText = { type: 'string', description: 'Non-empty plain text, at most 1200 characters.' }
const cellText = { type: 'string', description: 'Non-empty plain text, at most 400 characters.' }
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const array = (items: unknown, maxItems: number, minItems = 1) => ({
  type: 'array',
  items,
  minItems,
  maxItems,
})
const block = (type: string, properties: Record<string, unknown>) =>
  object({ type: { type: 'string', enum: [type] }, title: shortText, ...properties })

export const VISUAL_SUMMARY_SCHEMA = object({
  blocks: array(
    {
      anyOf: [
        block('cards', { items: array(object({ title: shortText, text: longText }), 6) }),
        block('comparison', {
          columns: array(shortText, 5, 2),
          rows: array(array(cellText, 5, 2), 8, 2),
        }),
        block('steps', { items: array(longText, 10) }),
        block('qa', {
          items: array(
            object({
              question: {
                ...shortText,
                description: 'Non-empty question, at most 200 characters.',
              },
              answer: longText,
            }),
            6
          ),
        }),
      ],
    },
    6
  ),
})

function invalid(): never {
  throw new InvalidVisualSummaryError()
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const result = value as Record<string, unknown>
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
  )
    return invalid()
  return result
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid()
  return value
}
function list<T>(value: unknown, min: number, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return invalid()
  return value.map(parse)
}

export function parseVisualSummary(value: unknown): VisualSummary {
  const root = record(value, ['blocks'])
  return {
    blocks: list(root.blocks, 1, 6, (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
      const type = (value as Record<string, unknown>).type
      const b = record(
        value,
        type === 'comparison' ? ['type', 'title', 'columns', 'rows'] : ['type', 'title', 'items']
      )
      const title = text(b.title, 120)
      switch (type) {
        case 'cards':
          return {
            type,
            title,
            items: list(b.items, 1, 6, (value) => {
              const item = record(value, ['title', 'text'])
              return { title: text(item.title, 120), text: text(item.text, 1200) }
            }),
          }
        case 'comparison': {
          const columns = list(b.columns, 2, 5, (value) => text(value, 120))
          const rows = list(b.rows, 2, 8, (value) =>
            list(value, columns.length, columns.length, (value) => text(value, 400))
          )
          return { type, title, columns, rows }
        }
        case 'steps':
          return { type, title, items: list(b.items, 1, 10, (value) => text(value, 1200)) }
        case 'qa':
          return {
            type,
            title,
            items: list(b.items, 1, 6, (value) => {
              const item = record(value, ['question', 'answer'])
              return { question: text(item.question, 200), answer: text(item.answer, 1200) }
            }),
          }
        default:
          return invalid()
      }
    }),
  }
}
