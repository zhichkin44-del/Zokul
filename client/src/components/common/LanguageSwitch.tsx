import { getLang, setLang } from '../../i18n';

export function LanguageSwitch() {
  const lang = getLang();
  const option = (code: 'ru' | 'en', label: string) => (
    <button
      type="button"
      onClick={() => setLang(code)}
      aria-pressed={lang === code}
      className={`px-2.5 py-1 rounded-lg text-sm ${lang === code ? 'bg-gray-200 dark:bg-gray-800 font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}
    >
      {label}
    </button>
  );
  return <div className="flex gap-1" aria-label="Language">{option('ru', 'Русский')}{option('en', 'English')}</div>;
}
