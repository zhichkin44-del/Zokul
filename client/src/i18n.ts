import { useEffect, useState } from 'react';

// Interface language. English strings are the keys; Russian is a dictionary.
// `t` is a plain function so any component or helper can use it; switching
// the language re-mounts the app (see App.tsx), so no per-component hook.

export type Lang = 'ru' | 'en';
const STORAGE_KEY = 'zokul-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn(lang));
}

export function useLang(): Lang {
  const [lang, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    document.documentElement.lang = current;
    return () => { listeners.delete(set); };
  }, []);
  return lang;
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current === 'ru' ? RU[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

// Russian plural: 1 участник, 2 участника, 5 участников.
export function plural(n: number, one: string, few: string, many: string): string {
  if (current !== 'ru') return n === 1 ? one : few;
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const RU: Record<string, string> = {
  // auth
  'Sign in': 'Вход',
  'Sign in to your workspace': 'Войдите в своё пространство',
  'Signing in…': 'Входим…',
  'Create account': 'Регистрация',
  'Creating account…': 'Создаём аккаунт…',
  'Email': 'Email',
  'Password': 'Пароль',
  'Your name': 'Ваше имя',
  'At least 8 characters': 'Не меньше 8 символов',
  'Invite code': 'Код приглашения',
  'No account?': 'Нет аккаунта?',
  'Join with an invite': 'Войти по приглашению',
  'Already have an account?': 'Уже есть аккаунт?',
  'Zokul is invite-only. Use the link you were sent, or paste its code.': 'Zokul работает по приглашениям. Откройте присланную ссылку или вставьте код.',
  'People and AI agents, one workspace': 'Люди и ИИ-агенты в одном пространстве',
  'Password must be at least 8 characters': 'Пароль должен быть не короче 8 символов',
  'Login failed': 'Не удалось войти',
  'Registration failed': 'Не удалось зарегистрироваться',
  'Invalid credentials': 'Неверный email или пароль',
  'This account is blocked': 'Этот аккаунт заблокирован',
  'A valid invite is required to join this server': 'Чтобы присоединиться, нужно приглашение',
  'This invite is invalid, used up or expired': 'Приглашение недействительно, уже использовано или истекло',
  'Email already registered': 'Этот email уже зарегистрирован',
  'Enter a valid email': 'Введите корректный email',
  'Too many login attempts, please try again later': 'Слишком много попыток входа, попробуйте позже',
  'Too many registration attempts, please try again later': 'Слишком много попыток регистрации, попробуйте позже',
  // sidebar and list
  'Online': 'В сети',
  'Offline': 'Не в сети',
  'Agents': 'Агенты',
  'Rooms and people': 'Комнаты и люди',
  'New chat': 'Новый чат',
  'Personal chat': 'Личный чат',
  'Group chat': 'Группа',
  'AI agents': 'ИИ-агенты',
  'Admin panel': 'Панель администратора',
  'Light mode': 'Светлая тема',
  'Dark mode': 'Тёмная тема',
  'Log out': 'Выйти',
  'Edit profile': 'Профиль',
  'Notifications off': 'Уведомления выключены',
  'Get notified about new messages': 'Уведомления о новых сообщениях',
  'Turn on': 'Включить',
  'Not now': 'Не сейчас',
  'To get notifications on iPhone: Share → Add to Home Screen, then open Zokul from the icon': 'Уведомления на iPhone: «Поделиться» → «На экран Домой», затем откройте Zokul с иконки',
  'No chats yet': 'Чатов пока нет',
  'Tap the pencil to start a conversation': 'Нажмите на карандаш, чтобы начать разговор',
  'Yesterday': 'Вчера',
  'Photo': 'Фото',
  'Voice message': 'Голосовое',
  'Group': 'Группа',
  'Unknown': 'Неизвестно',
  'AI agent': 'ИИ-агент',
  // empty state
  'Pick a chat to start': 'Выберите чат',
  'Your chats with people and AI agents live on the left.': 'Слева ваши чаты с людьми и ИИ-агентами.',
  'Connect an agent': 'Подключить агента',
  // chat header and view
  'Search in chat': 'Поиск по чату',
  'Search in this chat…': 'Поиск по этому чату…',
  'Close search': 'Закрыть поиск',
  'Searching…': 'Ищем…',
  'Nothing found': 'Ничего не найдено',
  'Chat actions': 'Действия с чатом',
  'Profile': 'Профиль',
  'Group info': 'О группе',
  'Mute notifications': 'Выключить уведомления',
  'Turn notifications on': 'Включить уведомления',
  'Delete chat': 'Удалить чат',
  'Delete chat?': 'Удалить чат?',
  'This cannot be undone.': 'Это нельзя отменить.',
  'Cancel': 'Отмена',
  'Delete': 'Удалить',
  'Back': 'Назад',
  'No messages yet': 'Сообщений пока нет',
  'Send a message to start': 'Напишите первое сообщение',
  'Loading messages…': 'Загружаем сообщения…',
  'Loading…': 'Загрузка…',
  'Read': 'Прочитано',
  'Read by {n}': 'Прочитали: {n}',
  'Delivered': 'Доставлено',
  'edited': 'изменено',
  'Download': 'Скачать',
  'Today': 'Сегодня',
  // composer
  'Message…': 'Сообщение…',
  'Edit message…': 'Изменить сообщение…',
  'Reply…': 'Ответ…',
  'Add a caption…': 'Добавьте подпись…',
  'Send message': 'Отправить',
  'Attach file': 'Прикрепить файл',
  'Record voice message': 'Записать голосовое',
  'Emoji': 'Эмодзи',
  'Uploading…': 'Загружаем…',
  'Failed to upload file': 'Не удалось загрузить файл',
  'Failed to upload images': 'Не удалось загрузить фото',
  'Maximum 4 images': 'Не больше 4 фото',
  'This file type is not allowed. Allowed: pdf, txt, log, md, csv, json, zip, docx, xlsx, pptx': 'Такой тип файла нельзя. Можно: pdf, txt, log, md, csv, json, zip, docx, xlsx, pptx',
  'File too large': 'Файл слишком большой',
  // message actions
  'Reply': 'Ответить',
  'Edit': 'Изменить',
  'Copy': 'Копировать',
  'Copied ✓': 'Скопировано ✓',
  // agent cards
  'Working': 'Работает',
  'Done': 'Готово',
  'Failed': 'Ошибка',
  'Update': 'Новости',
  'Needs your answer': 'Нужен ваш ответ',
  'Answered': 'Отвечено',
  'Withdrawn by agent': 'Агент снял вопрос',
  'Answer': 'Ответ',
  'Or type an answer…': 'Или напишите ответ…',
  'Type an answer…': 'Напишите ответ…',
  'Send': 'Отправить',
  'Handoff': 'Передача работы',
  'Open': 'Открыта',
  'Picked up by {name}': 'Взял {name}',
  'Next': 'Дальше',
  'Files': 'Файлы',
  'Notes': 'Заметки',
  'Copy as prompt': 'Скопировать как промпт',
  'This question is already answered or was withdrawn': 'На этот вопрос уже ответили, или агент его снял',
  // search users / create
  'Search people…': 'Найти людей…',
  'Type a name to find people': 'Введите имя, чтобы найти людей',
  'No one found': 'Никого не найдено',
  'New group': 'Новая группа',
  'Group name': 'Название группы',
  'Create group': 'Создать группу',
  'Create': 'Создать',
  'Add people to the group': 'Добавьте участников',
  // info modal
  'Notifications': 'Уведомления',
  'Rename': 'Переименовать',
  'Remove': 'Убрать',
  'Leave group': 'Выйти из группы',
  'Add people by name…': 'Добавить людей по имени…',
  'Add': 'Добавить',
  'your agent': 'ваш агент',
  'you': 'вы',
  'creator': 'создатель',
  'member': 'участник',
  'members': 'участника',
  'members_many': 'участников',
  // agents modal
  'Agents post status, ask you questions and leave handoffs here.': 'Агенты пишут сюда статусы, задают вопросы и оставляют карточки передачи.',
  'Agent name, e.g. Claude Code': 'Имя агента, например Claude Code',
  'No agents yet. Add one, then connect Claude Code, Codex, Cursor or any CLI agent with its token.': 'Агентов пока нет. Добавьте агента и подключите Claude Code, Codex, Cursor или любой консольный агент по ключу.',
  'Chat': 'Чат',
  'New token': 'Новый ключ',
  'never connected': 'ещё не подключался',
  'active just now': 'активен только что',
  'active {n} min ago': 'активен {n} мин назад',
  'active {n} h ago': 'активен {n} ч назад',
  'active {date}': 'активен {date}',
  // profile
  'Name': 'Имя',
  'Save': 'Сохранить',
  'Saving…': 'Сохраняем…',
  'Language': 'Язык',
  // last seen
  'Last seen just now': 'Был(а) только что',
  'Last seen {n} min ago': 'Был(а) {n} мин назад',
  'Last seen today at {time}': 'Был(а) сегодня в {time}',
  'Last seen yesterday at {time}': 'Был(а) вчера в {time}',
  'Last seen {date}': 'Был(а) {date}',
  // misc
  'Something went wrong': 'Что-то пошло не так',
  'Reload': 'Перезагрузить',
  'Close': 'Закрыть',
  'Overview': 'Обзор',
  'Invites': 'Приглашения',
  'People': 'Люди',
  'Activity log': 'Журнал действий',
  'Back to chats': 'Назад к чатам',
  'admin': 'админ',
  'Admin sections': 'Разделы админки',
  'Good night': 'Доброй ночи',
  'Good morning': 'Доброе утро',
  'Good afternoon': 'Добрый день',
  'Good evening': 'Добрый вечер',
  'All quiet': 'Всё спокойно',
  'Needs attention': 'Нужно внимание',
  'Invite someone': 'Пригласить человека',
  '{n} online': 'в сети: {n}',
  '{n} waiting': 'ждут ответа: {n}',
  'Messages today': 'Сообщений сегодня',
  '{n} from agents': 'от агентов: {n}',
  '{n} active invites': 'активных приглашений: {n}',
  'Recent activity': 'Последние события',
  'Database': 'База',
  'Nothing yet.': 'Пока ничего.',
  'Someone': 'Кто-то',
  'signed in': 'вошёл(а)',
  'failed sign-in': 'неудачный вход',
  'blocked account tried to sign in': 'заблокированный аккаунт пытался войти',
  'joined': 'присоединился(-ась)',
  'changed password': 'сменил(а) пароль',
  'created an invite': 'создал(а) приглашение',
  'revoked an invite': 'отозвал(а) приглашение',
  'blocked a person': 'заблокировал(а) человека',
  'unblocked a person': 'разблокировал(а) человека',
  'added an agent': 'добавил(а) агента',
  'issued a new agent token': 'выпустил(а) новый ключ агента',
  'deleted an agent': 'удалил(а) агента',
  'Only people with an invite can join this server': 'Присоединиться к серверу можно только по приглашению',
  'For whom': 'Для кого',
  'Bob, or the Site team': 'Боб или команда «Сайт»',
  'Uses': 'Входов',
  'Days': 'Дней',
  'Create invite': 'Создать приглашение',
  'Could not create the invite': 'Не удалось создать приглашение',
  'Send this link to the person. It is shown only once.': 'Отправьте эту ссылку человеку. Она показывается только один раз.',
  'No invites yet.': 'Приглашений пока нет.',
  '{used} of {max} used': 'использовано {used} из {max}',
  'until {date}': 'до {date}',
  'active': 'действует',
  'used': 'использовано',
  'expired': 'истекло',
  'revoked': 'отозвано',
  'Revoke': 'Отозвать',
  'Block {name}? They are signed out everywhere right away.': 'Заблокировать {name}? Человек сразу выйдет на всех устройствах.',
  'blocked': 'заблокирован(а)',
  'Unblock': 'Разблокировать',
  'Block': 'Заблокировать',
  'AI agents connected to this server, and who owns them': 'ИИ-агенты на этом сервере и их владельцы',
  'No agents yet.': 'Агентов пока нет.',
  'owner': 'владелец',
  'Sign-ins, invites, blocks and agent keys': 'Входы, приглашения, блокировки и ключи агентов',
  'Give the invite a name, e.g. who it is for': 'Дайте приглашению название, например для кого оно',
  'Uses must be between 1 and 50': 'Входов — от 1 до 50',
  'Expiry must be 1-30 days': 'Срок — от 1 до 30 дней',
  'You cannot block yourself': 'Нельзя заблокировать самого себя',
  'Delete this message?': 'Удалить сообщение?',
  'Microphone access denied': 'Нет доступа к микрофону',
  'Failed to start recording': 'Не удалось начать запись',
  'Upload failed': 'Не удалось загрузить',
  'Stop and send voice message': 'Остановить и отправить голосовое',
  'Start voice message recording': 'Начать запись голосового',
  'Stop and send': 'Остановить и отправить',
  'Start recording': 'Начать запись',
  'Failed to create group': 'Не удалось создать группу',
  'Creating…': 'Создаём…',
  'Failed to upload avatar': 'Не удалось загрузить фото профиля',
  'Name is required': 'Укажите имя',
  'Failed to update profile': 'Не удалось сохранить профиль',
  'Audio recording not supported in this browser': 'Этот браузер не умеет записывать звук',
  'Release to cancel': 'Отпустите, чтобы отменить',
  'Slide to cancel': 'Смахните, чтобы отменить',
  'Stop recording': 'Остановить запись',
  'Tap mic to send': 'Нажмите на микрофон, чтобы отправить',
  'Reload page': 'Перезагрузить страницу',
  'Create group ({n})': 'Создать группу ({n})',
};
