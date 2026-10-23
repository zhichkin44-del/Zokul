import { useState } from 'react';
import RichText from './RichText';
import { HandoffPayload, Message, QuestionPayload, StatusPayload } from '../../types';
import { t } from '../../i18n';

interface AgentCardProps {
  message: Message;
  // Resolves with an error message, or null when the answer was accepted.
  onAnswer: (messageId: string, answer: string) => Promise<string | null>;
  onClaim?: (messageId: string) => Promise<string | null>;
}

// Rich rendering for messages posted by AI agents (status / question / handoff).
export default function AgentCard({ message, onAnswer, onClaim }: AgentCardProps) {
  if (message.kind === 'status') return <StatusCard text={message.text} payload={message.payload as StatusPayload} />;
  if (message.kind === 'question') return <QuestionCard message={message} onAnswer={onAnswer} />;
  if (message.kind === 'handoff') return <HandoffCard payload={message.payload as HandoffPayload} onTake={onClaim ? () => onClaim(message.id) : undefined} />;
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
    <div className="px-3.5 py-2.5 rounded-2xl bg-surface/70 border border-gray-200 dark:border-gray-700 text-sm">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-600 dark:text-gray-400">{t(style.label)}</span>
      </div>
      {text && <div className="mt-1"><RichText text={text} /></div>}
    </div>
  );
}

function QuestionCard({ message, onAnswer }: AgentCardProps) {
  const payload = message.payload as QuestionPayload;
  const [custom, setCustom] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const answered = payload.answer ?? sent;
  const withdrawn = !payload.answer && payload.cancelled;

  const submit = async (answer: string) => {
    const value = answer.trim();
    if (!value || answered) return;
    setSent(value);
    setError('');
    const failure = await onAnswer(message.id, value);
    if (failure) {
      setSent(null);
      setError(failure);
    }
  };

  return (
    <div className={`rounded-2xl border bg-surface overflow-hidden text-sm shadow-sm ${answered || withdrawn ? 'border-gray-200 dark:border-gray-700' : 'border-primary/40 '} dark:shadow-none`}>
      <div className="px-3 pt-2.5 pb-2">
        <div className={`text-[11px] font-semibold uppercase tracking-[0.05em] mb-1 ${withdrawn ? 'text-gray-400' : 'text-primary'}`}>
          {withdrawn ? t('Withdrawn by agent') : answered ? t('Answered') : t('Needs your answer')}
        </div>
        <p className="whitespace-pre-wrap break-words font-medium">{payload.question}</p>
      </div>
      {withdrawn ? null : answered ? (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300">
          <span className="text-gray-500">{t('Answer')}: </span>
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
                  className="px-3 py-1.5 rounded-full bg-primary text-on-primary text-sm font-medium hover:bg-primary-dark active:scale-[0.97] transition"
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); submit(custom); }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={payload.options.length ? t('Or type an answer…') : t('Type an answer…')}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="submit"
              disabled={!custom.trim()}
              className="px-3 py-1.5 rounded-full text-primary font-medium disabled:opacity-40"
            >{t('Send')}</button>
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

function HandoffCard({ payload, onTake }: { payload: HandoffPayload; onTake?: () => Promise<string | null> }) {
  const [copied, setCopied] = useState(false);
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState('');
  const take = async () => {
    if (!onTake) return;
    setTaking(true);
    setError('');
    const failure = await onTake();
    if (failure) setError(t(failure));
    setTaking(false);
  };
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
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-surface overflow-hidden text-sm shadow-sm dark:shadow-none">
      <div className="px-3 pt-2.5 pb-2 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-500">{t('Handoff')}</span>
          <span className={`text-[11px] font-medium ${payload.claimedBy ? 'text-green-600' : 'text-amber-600'}`}>
            {payload.claimedBy ? t('Picked up by {name}', { name: payload.claimedBy }) : t('Open')}
          </span>
        </div>
        <p className="font-semibold mt-0.5 break-words">{payload.title}</p>
        {payload.summary && <p className="text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap break-words">{payload.summary}</p>}
      </div>
      <div className="px-3 py-2 space-y-2">
        <HandoffList title={t('Done')} items={payload.done} marker="✓" />
        <HandoffList title={t('Next')} items={payload.next} marker="→" />
        {payload.files.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">{t('Files')}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {payload.files.map((f) => (
                <code key={f} className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-[12px] break-all">{f}</code>
              ))}
            </div>
          </div>
        )}
        {payload.notes && (
          <details className="text-gray-600 dark:text-gray-300">
            <summary className="cursor-pointer text-[12px] text-gray-400">{t('Notes')}</summary>
            <p className="mt-1 whitespace-pre-wrap break-words">{payload.notes}</p>
          </details>
        )}
      </div>
      {error && <p role="alert" className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex border-t border-gray-100 dark:border-gray-700">
        {!payload.claimedBy && onTake && (
          <button type="button" onClick={take} disabled={taking} className="flex-1 px-3 py-2 text-primary font-semibold text-sm hover:bg-primary/5 disabled:opacity-50 border-r border-gray-100 dark:border-gray-700">
            {t("I'll take it")}
          </button>
        )}
        <button type="button" onClick={copy} className="flex-1 px-3 py-2 text-primary font-medium text-sm hover:bg-primary/5">
          {copied ? t('Copied ✓') : t('Copy as prompt')}
        </button>
      </div>
    </div>
  );
}

function HandoffList({ title, items, marker }: { title: string; items: string[]; marker: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">{title}</div>
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
