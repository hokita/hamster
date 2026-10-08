import type { VisualSummary, VisualSummaryBlock } from '../../../backend/src/visualSummary'

type Block<T extends VisualSummaryBlock['type']> = Extract<VisualSummaryBlock, { type: T }>

function PointCards({ block }: { block: Block<'cards'> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {block.items.map((item, index) => (
        <div key={index} className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <h4 className="font-semibold text-gray-900">{item.title}</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{item.text}</p>
        </div>
      ))}
    </div>
  )
}

function ComparisonTable({ block }: { block: Block<'comparison'> }) {
  return (
    <div
      role="region"
      aria-label={block.title}
      tabIndex={0}
      className="overflow-x-auto rounded-md border border-gray-200 focus-visible:outline-amber-700"
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{block.title}</caption>
        <thead>
          <tr>
            {block.columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className="min-w-28 border-b border-gray-300 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-900"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) =>
                column === 0 ? (
                  <th
                    key={column}
                    scope="row"
                    className="border-b border-gray-200 px-3 py-2 text-left align-top font-medium text-gray-900"
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    key={column}
                    className="border-b border-gray-200 px-3 py-2 align-top text-gray-700"
                  >
                    {cell}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepChecklist({ block }: { block: Block<'steps'> }) {
  return (
    <ol className="space-y-2">
      {block.items.map((item, index) => (
        <li key={index}>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 text-sm text-gray-700 has-[:checked]:bg-amber-50">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-amber-700" />
            <span>
              <span className="font-medium">{index + 1}. </span>
              {item}
            </span>
          </label>
        </li>
      ))}
    </ol>
  )
}

function QuestionAnswers({ block }: { block: Block<'qa'> }) {
  return (
    <div className="space-y-2">
      {block.items.map((item, index) => (
        <details
          key={index}
          className="rounded-md border border-gray-200 p-3 text-sm text-gray-700"
        >
          <summary className="cursor-pointer font-medium text-gray-900 focus-visible:outline-amber-700">
            {item.question}
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{item.answer}</p>
        </details>
      ))}
    </div>
  )
}

// An explicit allowlist. Generated strings are React text nodes, never HTML or executable code.
function RenderBlock({ block }: { block: VisualSummaryBlock }) {
  switch (block.type) {
    case 'cards':
      return <PointCards block={block} />
    case 'comparison':
      return <ComparisonTable block={block} />
    case 'steps':
      return <StepChecklist block={block} />
    case 'qa':
      return <QuestionAnswers block={block} />
    default:
      return null
  }
}

export default function VisualSummaryView({ value }: { value: VisualSummary }) {
  return (
    <div className="w-full space-y-5 break-words [overflow-wrap:anywhere]">
      {value.blocks.map((block, index) => (
        <section key={index}>
          <h3 className="mb-2 font-semibold text-gray-900">{block.title}</h3>
          <RenderBlock block={block} />
        </section>
      ))}
    </div>
  )
}
