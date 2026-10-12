import { Component, MarkdownRenderer, type App } from 'obsidian';
import { mathParts } from './math';

type Render = { text: string; path: string; component: Component };

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
    const markdown = mathParts(text)
      .map((part) =>
        part.kind === 'math' && part.text.startsWith('\\')
          ? `${part.display ? '$$\n' : '$'}${part.source}${part.display ? '\n$$' : '$'}`
          : part.text,
      )
      .join('');
    if (!previous) body.textContent = text;
    void MarkdownRenderer.render(app, markdown, content, path, render.component)
      .then(() => {
        if (this.renders.get(body) !== render) {
          render.component.unload();
          return;
        }
        const list = body.closest('.annotate-messages');
        const pinned = list && list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        body.replaceChildren(content);
        if (pinned) list.scrollTop = list.scrollHeight;
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
