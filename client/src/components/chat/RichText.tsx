import { Fragment, ReactNode } from 'react';

// Minimal, safe Markdown for chat messages (agents write it a lot):
// ```code blocks```, `inline code`, **bold**, and "- " bullet lines.
// Builds React elements only; never injects HTML.

function inline(text: string, mine: boolean): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('`')) {
      parts.push(
        <code key={m.index} className={`px-1 py-0.5 rounded text-[0.92em] font-mono ${mine ? 'bg-on-primary/15' : 'bg-gray-900/[0.06] dark:bg-white/10'}`}>
          {token.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<strong key={m.index} className="font-semibold">{token.slice(2, -2)}</strong>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function RichText({ text, mine = false }: { text: string; mine?: boolean }) {
  const blocks = text.split(/```(?:[\w-]*\n)?/);
  return (
    <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          <pre key={i} className={`my-1.5 p-2.5 rounded-lg overflow-x-auto text-[12.5px] leading-relaxed font-mono whitespace-pre ${mine ? 'bg-on-primary/15' : 'bg-gray-900/[0.06] dark:bg-white/10'}`}>
            {block.replace(/\n$/, '')}
          </pre>
        ) : (
          <Fragment key={i}>
            {block.split('\n').map((line, j, lines) => {
              const bullet = /^\s*[-*•] (.*)$/.exec(line);
              const content = bullet ? (
                <span className="flex gap-2"><span aria-hidden="true">•</span><span>{inline(bullet[1], mine)}</span></span>
              ) : inline(line, mine);
              return <Fragment key={j}>{content}{!bullet && j < lines.length - 1 ? '\n' : null}</Fragment>;
            })}
          </Fragment>
        )
      )}
    </div>
  );
}
