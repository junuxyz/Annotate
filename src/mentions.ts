type MentionRange = { from: number; to: number };

function chatGPTMention(input: HTMLTextAreaElement): MentionRange | null {
  const caret = input.selectionStart;
  if (caret !== input.selectionEnd || /\w/.test(input.value.charAt(caret))) return null;
  const match = /(^|\s)@([a-z]*)$/i.exec(input.value.slice(0, caret));
  const query = match?.[2]?.toLowerCase();
  if (query === undefined || query === 'chatgpt' || !'chatgpt'.startsWith(query)) return null;
  return { from: caret - query.length - 1, to: caret };
}

export function mentionMenu(input: HTMLTextAreaElement, container: HTMLElement): void {
  const doc = input.ownerDocument;
  const menu = doc.createElement('div');
  menu.className = 'annotate-mention-menu';
  menu.id = `annotate-mentions-${crypto.randomUUID()}`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'AI assistants');
  menu.hidden = true;
  const option = doc.createElement('button');
  option.type = 'button';
  option.className = 'annotate-mention-option';
  option.id = `${menu.id}-chatgpt`;
  option.tabIndex = -1;
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', 'true');
  const name = doc.createElement('strong');
  name.textContent = 'ChatGPT';
  const token = doc.createElement('span');
  token.textContent = '@chatgpt';
  option.append(name, token);
  menu.append(option);
  container.append(menu);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', menu.id);
  input.setAttribute('aria-expanded', 'false');

  let range: MentionRange | null = null;
  let composing = false;
  const hide = () => {
    range = null;
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const update = () => {
    range = composing ? null : chatGPTMention(input);
    menu.hidden = range === null;
    input.setAttribute('aria-expanded', String(range !== null));
    if (range) input.setAttribute('aria-activedescendant', option.id);
    else input.removeAttribute('aria-activedescendant');
  };
  const choose = () => {
    const current = range;
    if (!current) return;
    const suffix = input.value.slice(current.to);
    const completion = `@chatgpt${/^\s/.test(suffix) ? '' : ' '}`;
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
    if (!range || composing || event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Enter') choose();
    else if (event.key === 'Escape') hide();
  });
  option.addEventListener('mousedown', (event) => event.preventDefault());
  option.addEventListener('click', choose);
}
