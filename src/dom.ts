// Obsidian installs its global DOM helpers in each workspace window. The supported
// API declares the globals but omits the corresponding Window members.
declare global {
  interface Window {
    createEl: typeof createEl;
    createDiv: typeof createDiv;
    createSpan: typeof createSpan;
    createSvg: typeof createSvg;
    createFragment: typeof createFragment;
  }
}
export {};
