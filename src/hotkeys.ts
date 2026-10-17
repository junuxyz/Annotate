import { Modal, Notice, Platform, Setting, type App } from 'obsidian';
import { z } from 'zod';

const hotkeySchema = z.object({
  modifiers: z.array(z.enum(['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'])),
  key: z.string().min(1),
  code: z.string().optional(),
});
export type Shortcut = z.infer<typeof hotkeySchema>;
const shortcutList = z.array(hotkeySchema);
const method = z.custom<(...args: unknown[]) => unknown>((value) => typeof value === 'function');
const managerSchema = z.object({
  getHotkeys: method,
  getDefaultHotkeys: method,
  setHotkeys: method,
  removeHotkeys: method,
  save: method,
});
const commandsSchema = z.object({
  commands: z.record(z.string(), z.object({ id: z.string(), name: z.string() })),
});

function keyName(shortcut: Shortcut): string {
  const code = shortcut.code;
  if (code && /^Key[A-Z]$/.test(code)) return code.slice(3);
  if (code && /^Digit[0-9]$/.test(code)) return code.slice(5);
  return shortcut.key;
}
export function formatShortcut(shortcut: Shortcut, mac = Platform.isMacOS): string {
  const modifiers = shortcut.modifiers.map((modifier) =>
    modifier === 'Mod' ? (mac ? 'Cmd' : 'Ctrl') : modifier === 'Meta' ? 'Cmd' : modifier,
  );
  const key = keyName(shortcut);
  return [...modifiers, key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key].join(
    '+',
  );
}
export function sameShortcut(a: Shortcut, b: Shortcut, mac = Platform.isMacOS): boolean {
  const modifiers = (shortcut: Shortcut) =>
    [...new Set(shortcut.modifiers.map((m) => (m === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : m)))]
      .sort()
      .join(',');
  return modifiers(a) === modifiers(b) && keyName(a).toLowerCase() === keyName(b).toLowerCase();
}
type Capture = { kind: 'ignore' | 'cancel' | 'invalid' } | { kind: 'shortcut'; shortcut: Shortcut };
export function captureShortcut(event: KeyboardEvent, mac = Platform.isMacOS): Capture {
  if (
    event.isComposing ||
    ['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process', 'Unidentified'].includes(event.key)
  )
    return { kind: 'ignore' };
  if (event.key === 'Escape') return { kind: 'cancel' };
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !/^F\d{1,2}$/.test(event.key))
    return { kind: 'invalid' };
  const modifiers: Shortcut['modifiers'] = [];
  if (mac && event.metaKey) modifiers.push('Mod');
  if (event.ctrlKey) modifiers.push(mac ? 'Ctrl' : 'Mod');
  if (!mac && event.metaKey) modifiers.push('Meta');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const shortcut: Shortcut = { modifiers, key: event.key };
  if (event.code) shortcut.code = event.code;
  return { kind: 'shortcut', shortcut };
}

// Hotkey editing is an internal Obsidian API. Validate capabilities and preserve its receiver.
export class ShortcutManager {
  private methods: z.infer<typeof managerSchema>;
  constructor(private manager: unknown) {
    this.methods = managerSchema.parse(manager);
  }
  custom(id: string): Shortcut[] | undefined {
    return shortcutList.optional().parse(this.methods.getHotkeys.call(this.manager, id));
  }
  current(id: string): Shortcut[] {
    return (
      this.custom(id) ??
      shortcutList.parse(this.methods.getDefaultHotkeys.call(this.manager, id) ?? [])
    );
  }
  async set(id: string, shortcuts: Shortcut[] | null): Promise<void> {
    const previous = this.custom(id);
    const apply = (next: Shortcut[] | undefined) => {
      if (next === undefined) this.methods.removeHotkeys.call(this.manager, id);
      else this.methods.setHotkeys.call(this.manager, id, next);
    };
    apply(shortcuts === null ? undefined : shortcutList.parse(shortcuts));
    try {
      await this.methods.save.call(this.manager);
    } catch (error) {
      apply(previous);
      throw error;
    }
  }
}

export function commandShortcut(app: App, id: string): string {
  try {
    const manager: unknown = Reflect.get(app, 'hotkeyManager');
    const shortcut = new ShortcutManager(manager).current(id)[0];
    return shortcut ? formatShortcut(shortcut) : '';
  } catch {
    return '';
  }
}

class ShortcutRecorder extends Modal {
  constructor(app: App, name: string, commit: (shortcut: Shortcut) => Promise<void>) {
    super(app);
    this.modalEl.addClass('annotate-shortcut-recorder');
    this.setTitle(`Shortcut: ${name}`);
    this.contentEl.createEl('p', { text: 'Press a shortcut. Escape cancels.' });
    const status = this.contentEl.createEl('p', { attr: { role: 'status' } });
    let saving = false;
    this.scope.register(null, null, (event) => {
      const captured = captureShortcut(event);
      if (captured.kind === 'cancel') this.close();
      else if (captured.kind === 'invalid')
        status.textContent = 'Include Ctrl, Cmd, or Alt, or use a function key.';
      else if (captured.kind === 'shortcut' && !saving) {
        saving = true;
        status.textContent = 'Saving…';
        void commit(captured.shortcut)
          .then(() => this.close())
          .catch((error: unknown) => {
            saving = false;
            status.textContent =
              error instanceof Error ? error.message : 'Could not save shortcut.';
          });
      }
      return false;
    });
  }
}

export function renderShortcutSettings(root: HTMLElement, app: App): () => void {
  const host = z.object({ hotkeyManager: z.unknown(), commands: commandsSchema }).safeParse(app);
  let manager: ShortcutManager;
  try {
    if (!host.success) throw new Error('Obsidian commands are unavailable.');
    manager = new ShortcutManager(host.data.hotkeyManager);
  } catch {
    root.createEl('p', { text: 'Edit shortcuts in Settings → Hotkeys on this Obsidian version.' });
    return () => {};
  }
  if (!host.success) return () => {};
  const commands = Object.values(host.data.commands.commands);
  let recorder: ShortcutRecorder | null = null;
  const render = () => {
    root.empty();
    new Setting(root).setName('Keyboard shortcuts').setHeading();
    for (const command of commands.filter((entry) => entry.id.startsWith('annotate:'))) {
      const name = command.name.replace(/^Annotate: /, '');
      const row = new Setting(root).setName(name).setClass('annotate-hotkey-setting');
      row.settingEl.dataset.command = command.id;
      const shortcuts = manager.current(command.id);
      const update = async (next: Shortcut[] | null) => {
        await manager.set(command.id, next);
        render();
      };
      const change = (index?: number) => {
        recorder?.close();
        recorder = new ShortcutRecorder(app, name, async (shortcut) => {
          const conflicts = commands.filter(
            (other) =>
              other.id !== command.id &&
              manager.current(other.id).some((key) => sameShortcut(key, shortcut)),
          );
          if (conflicts.length)
            throw new Error(
              `Already used by ${conflicts.map((other) => other.name).join(', ')}. Choose another shortcut.`,
            );
          const current = manager.current(command.id);
          await update([
            ...current.filter((key, i) => i !== index && !sameShortcut(key, shortcut)),
            shortcut,
          ]);
        });
        recorder.open();
      };
      for (const [index, shortcut] of shortcuts.entries()) {
        row.addButton((button) =>
          button
            .setButtonText(formatShortcut(shortcut))
            .setTooltip('Change shortcut')
            .setClass('annotate-hotkey-change')
            .onClick(() => change(index)),
        );
        row.addExtraButton((button) => {
          button.extraSettingsEl.addClass('annotate-hotkey-remove');
          return button
            .setIcon('x')
            .setTooltip(`Remove ${formatShortcut(shortcut)}`)
            .onClick(async () => {
              try {
                await update(manager.current(command.id).filter((_key, i) => i !== index));
              } catch {
                new Notice('Could not save shortcut. Try again.');
              }
            });
        });
      }
      row.addButton((button) =>
        button
          .setButtonText(shortcuts.length ? 'Add' : 'Set shortcut')
          .setClass('annotate-hotkey-add')
          .onClick(() => change()),
      );
      row.addExtraButton((button) => {
        button.extraSettingsEl.addClass('annotate-hotkey-reset');
        return button
          .setIcon('rotate-ccw')
          .setTooltip('Clear custom shortcuts')
          .onClick(async () => {
            try {
              await update(null);
            } catch {
              new Notice('Could not reset shortcuts. Try again.');
            }
          });
      });
    }
  };
  render();
  return () => recorder?.close();
}
