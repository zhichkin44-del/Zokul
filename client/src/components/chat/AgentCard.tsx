import { useState } from 'react';
import { HandoffPayload, Message, QuestionPayload, StatusPayload } from '../../types';

interface AgentCardProps {
  message: Message;
  onAnswer: (messageId: string, answer: string) => void;
}

// Rich rendering for messages posted by AI agents (status / question / handoff).
export default function AgentCard({ message, onAnswer }: AgentCardProps) {
  if (message.kind === 'status') return <StatusCard text={message.text} payload={message.payload as StatusPayload} />;
  if (message.kind === 'question') return <QuestionCard message={message} onAnswer={onAnswer} />;
  if (message.kind === 'handoff') return <HandoffCard payload={message.payload as HandoffPayload} />;
  return null;
}

const STATE_STYLE: Record<StatusPayload['state'], { label: string; dot: string }> = {
  working: { label: 'Working', dot: 'bg-amber-400 animate-pulse' },
  done: { label: 'Done', dot: 'bg-green-500' },
  failed: { label: 'Failed', dot: 'bg-red-500' },
  info: { label: 'Update', dot: 'bg-primary' },
};

function StatusCard({ text, payload }: { text?: string; payload: StatusPayload }) {
  const style = STATE_STYLE[payload?.state] ?? STATE_STYLE.info;
  return (
    <div className="px-3 py-2 rounded-2xl bg-white/70 dark:bg-gray-800/70 border border-[#D5DEE9] dark:border-gray-700 text-sm">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{style.label}</span>
      </div>
      {text && <p className="mt-1 whitespace-pre-wrap break-words">{text}</p>}
    </div>
  );
}

function QuestionCard({ message, onAnswer }: AgentCardProps) {
  const payload = message.payload as QuestionPayload;
  const [custom, setCustom] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const answered = payload.answer ?? sent;

  const submit = (answer: string) => {
    const value = answer.trim();
    if (!value || answered) return;
    setSent(value);
    onAnswer(message.id, value);
  };

  return (
    <div className="rounded-2xl border border-primary/40 bg-white dark:bg-gray-800 overflow-hidden text-sm shadow-sm">
      <div className="px-3 pt-2.5 pb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-1">
          {answered ? 'Answered' : 'Needs your answer'}
        </div>
        <p className="whitespace-pre-wrap break-words font-medium">{payload.question}</p>
      </div>
      {answered ? (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300">
          <span className="text-gray-400">Answer: </span>
          <span className="font-medium">{answered}</span>
        </div>
      ) : (
        <div className="px-3 pb-3 space-y-2">
          {payload.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {payload.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => submit(option)}
                  className="px-3 py-1.5 rounded-full bg-primary text-white text-sm font-medium hover:bg-primary-dark active:scale-[0.97] transition"
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); submit(custom); }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={payload.options.length ? 'Or type an answer…' : 'Type an answer…'}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!custom.trim()}
              className="px-3 py-1.5 rounded-full text-primary font-medium disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// Plain-text version another agent (or a person pasting into any AI) can use.
export function handoffToPrompt(h: HandoffPayload): string {
  const list = (title: string, items: string[]) => (items.length ? `\n${title}:\n${items.map((i) => `- ${i}`).join('\n')}\n` : '');
  return [
    `Continue this work. Handoff: ${h.title}`,
    h.summary ? `\n${h.summary}\n` : '',
    list('Done', h.done),
    list('Next steps', h.next),
    list('Relevant files', h.files),
    h.notes ? `\nNotes:\n${h.notes}\n` : '',
  ].join('').trim();
}

function HandoffCard({ payload }: { payload: HandoffPayload }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handoffToPrompt(payload));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable (insecure context)
    }
  };

  return (
    <div className="rounded-2xl border border-[#C9D6E4] dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden text-sm shadow-sm">
      <div className="px-3 pt-2.5 pb-2 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Handoff</span>
          <span className={`text-[11px] font-medium ${payload.claimedBy ? 'text-green-600' : 'text-amber-600'}`}>
            {payload.claimedBy ? `Picked up by ${payload.claimedBy}` : 'Open'}
          </span>
        </div>
        <p className="font-semibold mt-0.5 break-words">{payload.title}</p>
        {payload.summary && <p className="text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap break-words">{payload.summary}</p>}
      </div>
      <div className="px-3 py-2 space-y-2">
        <HandoffList title="Done" items={payload.done} marker="✓" />
        <HandoffList title="Next" items={payload.next} marker="→" />
        {payload.files.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Files</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {payload.files.map((f) => (
                <code key={f} className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-[12px] break-all">{f}</code>
              ))}
            </div>
          </div>
        )}
        {payload.notes && (
          <details className="text-gray-600 dark:text-gray-300">
            <summary className="cursor-pointer text-[12px] text-gray-400">Notes</summary>
            <p className="mt-1 whitespace-pre-wrap break-words">{payload.notes}</p>
          </details>
        )}
      </div>
      <button
        type="button"
        onClick={copy}
        className="w-full px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-primary font-medium text-sm hover:bg-primary/5"
      >
        {copied ? 'Copied ✓' : 'Copy as prompt'}
      </button>
    </div>
  );
}

function HandoffList({ title, items, marker }: { title: string; items: string[]; marker: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-1.5 break-words">
            <span className="text-gray-400 shrink-0">{marker}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
