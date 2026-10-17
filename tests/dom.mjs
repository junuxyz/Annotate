import { Window as HappyWindow } from 'happy-dom';

// Supply the DOM extensions provided by Obsidian, on each window's own prototypes.
export class Window extends HappyWindow {
  constructor(...args) {
    super(...args);
    const win = this;
    this.createEl = (tag) => this.document.createElement(tag);
    this.createDiv = () => this.createEl('div');
    this.createSpan = () => this.createEl('span');
    this.createSvg = (tag) => this.document.createElementNS('http://www.w3.org/2000/svg', tag);
    this.createFragment = () => this.document.createDocumentFragment();
    Object.defineProperty(this.Node.prototype, 'win', {
      get() {
        return this.ownerDocument?.defaultView ?? win;
      },
      configurable: true,
    });
    this.Node.prototype.createEl = function (tag) {
      const element = this.ownerDocument.createElement(tag);
      this.appendChild(element);
      return element;
    };
    this.Node.prototype.createSvg = function (tag) {
      const element = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
      this.appendChild(element);
      return element;
    };
    this.Node.prototype.instanceOf = function (type) {
      const owner = this.ownerDocument?.defaultView ?? win;
      return this instanceof (owner[type.name] ?? type);
    };
    this.HTMLElement.prototype.setCssStyles = function (styles) {
      Object.assign(this.style, styles);
    };
    Object.defineProperty(this.UIEvent.prototype, 'targetNode', {
      get() {
        return this.target instanceof win.Node ? this.target : null;
      },
      configurable: true,
    });
  }
}
