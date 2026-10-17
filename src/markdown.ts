import './dom';
import { Component, MarkdownRenderer, type App } from 'obsidian';
import { mathParts } from './math';
import { parser } from '@lezer/markdown';

type Render = { text: string; path: string; component: Component };

function literalMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&');
}

/** Disarm content that could fetch resources or invoke named code processors. */
export function safeCommentMarkdown(text: string): string {
  const edits: { from: number; to: number; text: string }[] = [];
  const protectedRanges: { from: number; to: number }[] = [];
  parser.parse(text).iterate({
    enter(node) {
      if (node.name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo');
        if (info) edits.push({ from: info.from, to: info.to, text: '' });
        protectedRanges.push({ from: node.from, to: node.to });
        return false;
      }
      if (node.name === 'InlineCode' || node.name === 'CodeBlock') {
        protectedRanges.push({ from: node.from, to: node.to });
        return false;
      }
      if (
        ['Image', 'HTMLTag', 'HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock'].includes(
          node.name,
        )
      ) {
        edits.push({
          from: node.from,
          to: node.to,
          text: literalMarkdown(text.slice(node.from, node.to)),
        });
        protectedRanges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  // Wiki embeds are an Obsidian extension absent from the CommonMark parser.
  let rangeIndex = 0;
  for (const match of text.matchAll(/!\[\[/g)) {
    const from = match.index;
    while (true) {
      const range = protectedRanges[rangeIndex];
      if (!range || range.to > from) break;
      rangeIndex++;
    }
    const protectedRange = protectedRanges[rangeIndex];
    if (protectedRange && protectedRange.from <= from) continue;
    let slashes = 0;
    for (let at = from - 1; at >= 0 && text[at] === '\\'; at--) slashes++;
    if (slashes % 2) continue;
    edits.push({ from, to: from + 1, text: '\\!' });
  }
  let result = text;
  for (const edit of edits.sort((a, b) => b.from - a.from))
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  return result;
}

function highlightMentions(root: HTMLElement, text: string): void {
  const skill = /^@(?:chatgpt|claude|opencode)\s+(\/[\w:.-]+)(?=\s|$)/i.exec(text.trim())?.[1];
  let skillHighlighted = false;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest('code, pre')) continue;
    if (/@(?:chatgpt|claude|opencode)\b/i.test(node.data) || (skill && node.data.includes(skill)))
      nodes.push(node);
  }
  for (const node of nodes) {
    const fragment = doc.win.createFragment();
    const parts = node.data.split(/(@(?:chatgpt|claude|opencode)\b|\/[\w:.-]+)/gi);
    for (const part of parts) {
      const assistant = /^@(chatgpt|claude|opencode)$/i.exec(part)?.[1]?.toLowerCase();
      const isSkill = !skillHighlighted && part === skill;
      if (assistant || isSkill) {
        const mention = doc.win.createSpan();
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
    const content = body.ownerDocument.win.createDiv();
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
    void MarkdownRenderer.render(
      app,
      safeCommentMarkdown(markdown),
      content,
      path,
      render.component,
    )
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
