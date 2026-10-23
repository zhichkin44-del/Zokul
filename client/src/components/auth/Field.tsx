import { InputHTMLAttributes } from 'react';

// Labelled input for the sign-in screens: a visible label (not just a
// placeholder that disappears) and one focus ring, no double outline.
export function Field({ label, id, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <label htmlFor={id} className="block">
      <span className="block mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <input
        id={id}
        {...input}
        className={`w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 ${input.className ?? ''}`}
      />
    </label>
  );
}

export const primaryButton = 'w-full py-3 rounded-xl bg-primary text-on-primary font-semibold hover:bg-primary-dark disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400 transition-colors';

export function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;
}
