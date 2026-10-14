import { assistantIcon } from './logos';
import { providers, type ProviderId } from './ai';
import type { CodexSkill } from './codex';
type Choice = { kind: 'assistant'; provider: ProviderId } | { kind: 'skill'; skill: CodexSkill };
export function mentionMenu(
  input: HTMLTextAreaElement,
  container: HTMLElement,
  preferred: ProviderId = 'chatgpt',
  loadSkills: () => Promise<CodexSkill[]> = async () => [],
): void {
  const doc = input.ownerDocument;
  const providersInOrder: ProviderId[] =
    preferred === 'claude' ? ['claude', 'chatgpt'] : ['chatgpt', 'claude'];
  const menu = doc.createElement('div');
  menu.className = 'annotate-mention-menu';
  menu.id = `annotate-mentions-${crypto.randomUUID()}`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'AI assistants');
  menu.hidden = true;
  container.append(menu);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', menu.id);
  input.setAttribute('aria-expanded', 'false');
  let range: { from: number; to: number; matches: Choice[] } | null = null;
  let selected = -1,
    revision = 0;
  let composing = false;
  const hide = () => {
    revision++;
    range = null;
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const choose = (choice: Choice | undefined) => {
    const current = range;
    if (!current || !choice) return;
    const suffix = input.value.slice(current.to);
    const token = choice.kind === 'assistant' ? `@${choice.provider}` : `/${choice.skill.name}`;
    const completion = token + (/^\s/.test(suffix) ? '' : ' ');
    input.setRangeText(completion, current.from, current.to, 'end');
    const caret = current.from + completion.length + (/^\s/.test(suffix) ? 1 : 0);
    input.setSelectionRange(caret, caret);
    hide();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus({ preventScroll: true });
  };
  const paint = () => {
    if (!range) return;
    for (const [i, option] of [...menu.children].entries()) {
      option.setAttribute('aria-selected', String(i === Math.max(0, selected)));
      if (i === Math.max(0, selected)) {
        input.setAttribute('aria-activedescendant', option.id);
        if (selected >= 0) option.scrollIntoView?.({ block: 'nearest' });
      }
    }
  };
  const show = (from: number, to: number, matches: Choice[], skills: boolean) => {
    if (!matches.length) {
      hide();
      return;
    }
    range = { from, to, matches };
    selected = -1;
    menu.replaceChildren();
    menu.setAttribute('aria-label', skills ? 'Codex skills' : 'AI assistants');
    matches.forEach((choice, i) => {
      const option = doc.createElement('button');
      option.type = 'button';
      option.tabIndex = -1;
      option.className = 'annotate-mention-option' + (skills ? ' annotate-skill-option' : '');
      option.id = `${menu.id}-${i}`;
      option.setAttribute('role', 'option');
      const name = doc.createElement('strong'),
        detail = doc.createElement('span');
      if (choice.kind === 'assistant') {
        name.textContent = providers[choice.provider].name;
        detail.textContent = `@${choice.provider}`;
        option.append(assistantIcon(doc, choice.provider));
      } else {
        name.textContent = `/${choice.skill.name}`;
        detail.textContent = choice.skill.description;
        option.title = choice.skill.description;
      }
      option.append(name, detail);
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => choose(choice));
      menu.append(option);
    });
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    paint();
  };
  const update = () => {
    const caret = input.selectionStart;
    if (composing || caret !== input.selectionEnd || /\w/.test(input.value.charAt(caret))) {
      hide();
      return;
    }
    const prefix = input.value.slice(0, caret);
    const assistant = /(^|\s)@([a-z]*)$/i.exec(prefix);
    if (assistant) {
      revision++;
      const query = assistant[2]?.toLowerCase() ?? '';
      show(
        caret - query.length - 1,
        caret,
        providersInOrder
          .filter((p) => p !== query && p.startsWith(query))
          .map((provider) => ({ kind: 'assistant', provider })),
        false,
      );
      return;
    }
    const slash = /^@(chatgpt|claude)\s+\/([\w:.-]*)$/i.exec(prefix);
    if (!slash) {
      hide();
      return;
    }
    hide();
    const query = slash[2]?.toLowerCase() ?? '';
    const ticket = ++revision;
    void loadSkills()
      .then((skills) => {
        if (ticket !== revision || !input.isConnected) return;
        show(
          caret - query.length - 1,
          caret,
          skills
            .filter((s) => s.name.toLowerCase().includes(query))
            .slice(0, 50)
            .map((skill) => ({ kind: 'skill', skill })),
          true,
        );
      })
      .catch(() => {
        if (ticket === revision) hide();
      });
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
}
