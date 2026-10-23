import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import RichText from '../src/components/chat/RichText';
import { plural, setLang, t } from '../src/i18n';

describe('RichText', () => {
  it('renders code, bold, bullets and code blocks', () => {
    const { container } = render(<RichText text={'Use `npm test` and **ship**\n- one\n- two\n```\nconst a = 1;\n```'} />);
    expect(container.querySelector('code')?.textContent).toBe('npm test');
    expect(container.querySelector('strong')?.textContent).toBe('ship');
    expect(container.querySelector('pre')?.textContent).toBe('const a = 1;');
    expect(container.textContent).toContain('one');
  });

  it('never turns message text into HTML', () => {
    const { container } = render(<RichText text={'<img src=x onerror=alert(1)> **<b>hi</b>**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('translates and fills placeholders', () => {
    setLang('ru');
    expect(t('Online')).toBe('В сети');
    expect(t('Last seen {n} min ago', { n: 5 })).toBe('Был(а) 5 мин назад');
    expect(t('A string nobody translated')).toBe('A string nobody translated');
  });

  it('picks the right Russian plural form', () => {
    setLang('ru');
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, 'участник', 'участника', 'участников'))).toEqual(
      ['участник', 'участника', 'участников', 'участников', 'участник', 'участника']
    );
  });
});
