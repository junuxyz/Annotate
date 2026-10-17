import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'main.js',
    '.development/**',
    'release/**',
    'backup-*/**',
    'diagnostics/**',
    'e2e/evidence/**',
    'test-vault/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.ts'],
    extends: obsidianmd.configs.recommended.filter(
      (config) => !config.files?.includes('package.json'),
    ),
    rules: {
      'obsidianmd/ui/sentence-case': [
        'warn',
        {
          brands: [
            'Obsidian',
            'Annotate',
            'ChatGPT',
            'OpenCode',
            'Codex',
            'Claude',
            'Ctrl',
            'Cmd',
            'Alt',
            'Settings',
            'Hotkeys',
          ],
          acronyms: ['AI', 'CLI', 'MCP', 'HTTPS', 'URL', 'JSON'],
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['src/main.ts', 'src/mentions.ts'],
    rules: {
      // Preserve keyCode 229 so IME confirmation does not submit a comment.
      '@typescript-eslint/no-deprecated': ['error', { allow: [{ from: 'lib', name: 'keyCode' }] }],
    },
  },
);
