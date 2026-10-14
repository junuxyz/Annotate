import { Component, MarkdownRenderer, type App } from 'obsidian';
import { mathParts } from './math';

type Render = { text: string; path: string; component: Component };

function highlightMentions(root: HTMLElement, text: string): void {
  const skill = /^@(?:chatgpt|claude)\s+(\/[\w:.-]+)(?=\s|$)/i.exec(text.trim())?.[1];
  let skillHighlighted = false;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest('code, pre')) continue;
    if (/@(?:chatgpt|claude)\b/i.test(node.data) || (skill && node.data.includes(skill)))
      nodes.push(node);
  }
  for (const node of nodes) {
    const fragment = doc.createDocumentFragment();
    const parts = node.data.split(/(@(?:chatgpt|claude)\b|\/[\w:.-]+)/gi);
    for (const part of parts) {
      const assistant = /^@(chatgpt|claude)$/i.exec(part)?.[1]?.toLowerCase();
      const isSkill = !skillHighlighted && part === skill;
      if (assistant || isSkill) {
        const mention = doc.createElement('span');
        mention.className = isSkill ? 'annotate-skill-mention' : `annotate-${assistant}-mention`;
        if (isSkill) skillHighlighted = true;
        mention.textContent = part;
        fragment.append(mention);
      } else fragment.append(doc.createTextNode(part));
    }
    node.replaceWith(fragment);
  }
}

export class CommentMarkdown {
  private renders = new Map<HTMLElement, Render>();

  paint(app: App, body: HTMLElement, text: string, path: string): void {
    const previous = this.renders.get(body);
    if (previous?.text === text && previous.path === path) return;
    this.remove(body);
    const render = { text, path, component: new Component() };
    this.renders.set(body, render);
    render.component.load();
    const content = body.ownerDocument.createElement('div');
    content.className = 'annotate-markdown-content';
    // Keep the LaTeX delimiters accepted by existing ChatGPT comments.
    const markdown = /\\[([]/.test(text)
      ? mathParts(text)
          .map((part) =>
            part.kind === 'math' && part.text.startsWith('\\')
              ? `${part.display ? '$$' : '$'}${part.display ? part.source.trim() : part.source}${part.display ? '$$' : '$'}`
              : part.text,
          )
          .join('')
      : text;
    if (!previous) body.textContent = text;
    void MarkdownRenderer.render(app, markdown, content, path, render.component)
      .then(() => {
        if (this.renders.get(body) !== render) {
          render.component.unload();
          return;
        }
        highlightMentions(content, text);
        body.replaceChildren(content);
      })
      .catch(() => {
        render.component.unload();
        if (this.renders.get(body) === render) {
          body.textContent = text;
          this.renders.delete(body);
        }
      });
  }

  remove(body: HTMLElement): void {
    this.renders.get(body)?.component.unload();
    this.renders.delete(body);
  }

  clear(): void {
    for (const body of this.renders.keys()) this.remove(body);
  }
}
