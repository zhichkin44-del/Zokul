import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentCard, { handoffToPrompt } from '../src/components/chat/AgentCard';
import { Message } from '../src/types';

const question = (answer: string | null): Message => ({
  id: 'q1',
  chatId: 'c1',
  senderId: 'agent',
  text: 'Deploy?',
  createdAt: new Date().toISOString(),
  kind: 'question',
  payload: { question: 'Deploy?', options: ['Yes', 'No'], answer },
});

describe('AgentCard', () => {
  it('answers a question once with an option button', () => {
    const onAnswer = vi.fn();
    render(<AgentCard message={question(null)} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText('Yes'));

    expect(onAnswer).toHaveBeenCalledWith('q1', 'Yes');
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.queryByText('No')).toBeNull();
  });

  it('shows the stored answer and no buttons for an answered question', () => {
    render(<AgentCard message={question('No')} onAnswer={vi.fn()} />);
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
  });

  it('turns a handoff into a prompt another agent can follow', () => {
    const prompt = handoffToPrompt({
      title: 'Push on iPhone',
      summary: 'Service worker restored.',
      done: ['sw.pwa.ts'],
      next: ['test over HTTPS'],
      files: ['client/sw.pwa.ts'],
      claimedBy: null,
    });
    expect(prompt).toContain('Handoff: Push on iPhone');
    expect(prompt).toContain('Next steps:\n- test over HTTPS');
    expect(prompt).toContain('Relevant files:\n- client/sw.pwa.ts');
  });
});
