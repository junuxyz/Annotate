// Only the Obsidian host is substituted; editor state, views, and DOM are real libraries.
import { StateField } from '@codemirror/state';
export const editorInfoField = StateField.define({
  create: () => ({ file: { path: 'test.md' } }),
  update: (value) => value,
});
export const editorLivePreviewField = StateField.define({
  create: () => false,
  update: (value) => value,
});
export const Platform = { isDesktopApp: true };
export class FileSystemAdapter {
  getBasePath() {
    return process.cwd();
  }
  async exists() {
    return false;
  }
}
export class TFolder {
  constructor(path = '') {
    this.path = path;
  }
}
export class Plugin {
  extensions = [];
  commands = [];
  saved = null;
  manifest = { id: 'annotate', dir: '.obsidian/plugins/annotate' };
  recovery = new Map();
  postProcessors = [];
  activeView = { file: { path: 'test.md' }, getMode: () => 'source' };
  source = '';
  workspaceHandlers = new Map();
  app = {
    workspace: {
      on: (name, callback) => {
        this.workspaceHandlers.set(name, callback);
        return {};
      },
      emit: (name) => this.workspaceHandlers.get(name)?.(),
      getActiveViewOfType: () => this.activeView,
      onLayoutReady: (callback) => callback(),
      getLeavesOfType: () => [],
    },
    vault: {
      adapter: Object.assign(new FileSystemAdapter(), {
        write: async (path, text) => this.recovery.set(path, text),
      }),
      on: () => ({}),
      getAbstractFileByPath: (path) => new TFile(path),
      cachedRead: async () => this.source,
      getRoot: () => new TFolder(''),
    },
  };
  async loadData() {
    return structuredClone(this.saved);
  }
  async saveData(data) {
    this.saved = structuredClone(data);
    this.loadData = async () => structuredClone(this.saved);
  }
  registerMarkdownPostProcessor(processor) {
    this.postProcessors.push(processor);
  }
  registerEditorExtension(extension) {
    this.extensions.push(editorInfoField, extension);
  }
  registerEvent() {}
  registerDomEvent() {}
  addCommand(command) {
    this.commands.push(command);
  }
  addRibbonIcon() {}
  addSettingTab(tab) {
    this.settingTab = tab;
  }
}
export class MarkdownView {}
export class Modal {}
export class Notice {
  constructor(message) {
    if (message.includes('could not save')) throw new Error(message);
  }
}
export class PluginSettingTab {
  updates = 0;
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  update() {
    this.updates++;
  }
  hide() {}
}
export class Setting {}

export class TFile {
  constructor(path) {
    this.path = path;
  }
}
export class MarkdownRenderChild {
  constructor(containerEl) {
    this.containerEl = containerEl;
  }
}

export async function loadMathJax() {}
export async function finishRenderMath() {}
export function renderMath(source, display) {
  const el = document.createElement('span');
  el.className = 'test-math';
  el.textContent = source;
  el.dataset.display = String(display);
  return el;
}

export function setIcon(element, name) {
  element.dataset.icon = name;
}

export class Component {
  loaded = false;
  load() {
    this.loaded = true;
  }
  unload() {
    this.loaded = false;
  }
}
export class MarkdownRenderer {
  static async render(app, markdown, el, sourcePath, component) {
    if (app.renderMarkdown) return app.renderMarkdown(markdown, el, sourcePath, component);
    const p = el.ownerDocument.createElement('p');
    p.textContent = markdown;
    el.append(p);
  }
}
