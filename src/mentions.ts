import { assistantIcon } from './logos';
import { providers, type ProviderId } from './ai';
type MentionRange = { from: number; to: number; matches: ProviderId[] };

export function mentionMenu(
  input: HTMLTextAreaElement,
  container: HTMLElement,
  preferred: ProviderId = 'chatgpt',
): void {
  const doc = input.ownerDocument;
  const choices: ProviderId[] =
    preferred === 'claude' ? ['claude', 'chatgpt'] : ['chatgpt', 'claude'];
  const menu = doc.createElement('div');
  menu.className = 'annotate-mention-menu';
  menu.id = `annotate-mentions-${crypto.randomUUID()}`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'AI assistants');
  menu.hidden = true;
  const options = choices.map((provider) => {
    const option = doc.createElement('button');
    option.type = 'button';
    option.className = 'annotate-mention-option';
    option.id = `${menu.id}-${provider}`;
    option.tabIndex = -1;
    option.setAttribute('role', 'option');
    const name = doc.createElement('strong');
    name.textContent = providers[provider].name;
    const token = doc.createElement('span');
    token.textContent = `@${provider}`;
    option.append(assistantIcon(doc, provider), name, token);
    menu.append(option);
    return { provider, option };
  });
  container.append(menu);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', menu.id);
  input.setAttribute('aria-expanded', 'false');
  let range: MentionRange | null = null;
  let selected = -1;
  let composing = false;
  const paint = () => {
    const active = range?.matches[Math.max(0, selected)];
    for (const { provider, option } of options) {
      option.hidden = !range?.matches.includes(provider);
      option.setAttribute('aria-selected', String(provider === active));
      if (provider === active) input.setAttribute('aria-activedescendant', option.id);
    }
  };
  const hide = () => {
    range = null;
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const update = () => {
    const caret = input.selectionStart;
    const match = /(^|\s)@([a-z]*)$/i.exec(input.value.slice(0, caret));
    const query = match?.[2]?.toLowerCase();
    const matches =
      query === undefined ? [] : choices.filter((p) => p !== query && p.startsWith(query));
    if (
      composing ||
      caret !== input.selectionEnd ||
      /\w/.test(input.value.charAt(caret)) ||
      !matches.length ||
      query === undefined
    ) {
      hide();
      return;
    }
    range = { from: caret - query.length - 1, to: caret, matches };
    selected = -1;
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    paint();
  };
  const choose = (provider: ProviderId | undefined) => {
    const current = range;
    if (!current || !provider || !current.matches.includes(provider)) return;
    const suffix = input.value.slice(current.to);
    const completion = `@${provider}${/^\s/.test(suffix) ? '' : ' '}`;
    input.setRangeText(completion, current.from, current.to, 'end');
    const caret = current.from + completion.length + (/^\s/.test(suffix) ? 1 : 0);
    input.setSelectionRange(caret, caret);
    hide();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus({ preventScroll: true });
  };
  input.addEventListener('input', update);
  input.addEventListener('click', update);
  input.addEventListener('select', update);
  input.addEventListener('keyup', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update();
  });
  input.addEventListener('compositionstart', () => {
    composing = true;
    hide();
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    update();
  });
  input.addEventListener('blur', hide);
  input.addEventListener('keydown', (event) => {
    if (
      !range ||
      composing ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Enter' || event.key === 'Tab') choose(range.matches[Math.max(0, selected)]);
    else if (event.key === 'Escape') hide();
    else {
      selected =
        selected < 0
          ? event.key === 'ArrowDown'
            ? 0
            : range.matches.length - 1
          : (selected + (event.key === 'ArrowDown' ? 1 : -1) + range.matches.length) %
            range.matches.length;
      paint();
    }
  });
  for (const { provider, option } of options) {
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => choose(provider));
  }
}
