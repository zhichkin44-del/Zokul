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
  it('answers a question once with an option button', async () => {
    const onAnswer = vi.fn().mockResolvedValue(null);
    render(<AgentCard message={question(null)} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText('Yes'));

    expect(onAnswer).toHaveBeenCalledWith('q1', 'Yes');
    expect(await screen.findByText('Answered')).toBeTruthy();
    expect(screen.queryByText('No')).toBeNull();
  });

  it('goes back to asking when the server rejects the answer', async () => {
    const onAnswer = vi.fn().mockResolvedValue('This question is already answered or was withdrawn');
    render(<AgentCard message={question(null)} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText('Yes'));

    expect(await screen.findByText(/already answered or was withdrawn/)).toBeTruthy();
    expect(screen.getByText('Needs your answer')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('shows the stored answer and no buttons for an answered question', () => {
    render(<AgentCard message={question('No')} onAnswer={vi.fn()} />);
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
  });

  it('shows a withdrawn question without answer controls', () => {
    const msg = question(null);
    msg.payload = { ...(msg.payload as object), cancelled: true } as Message['payload'];
    render(<AgentCard message={msg} onAnswer={vi.fn()} />);
    expect(screen.getByText('Withdrawn by agent')).toBeTruthy();
    expect(screen.queryByText('Yes')).toBeNull();
    expect(screen.queryByPlaceholderText(/answer/i)).toBeNull();
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
