// Explicit opt-in: one synthetic turn, no Obsidian instance and no retries.
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { modelTrace, traceRequest } from './model-trace.mjs';

if (process.env.ANNOTATE_CAPTURE_MODEL_TRACE !== '1')
  throw Error('Set ANNOTATE_CAPTURE_MODEL_TRACE=1 to authorize one synthetic model turn.');
const provider = process.argv[2];
if (!['codex', 'claude'].includes(provider) || process.argv.length !== 3)
  throw Error('Usage: npm run trace:capture -- codex|claude');
const root = await mkdtemp(join(tmpdir(), 'annotate-model-trace-'));
let backend;
let timer;
try {
  await build({
    entryPoints: ['src/codex.ts', 'src/claude.ts', 'src/ai.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outdir: root,
  });
  const require = createRequire(import.meta.url);
  const { resolveExecutable } = require(join(root, 'ai.js'));
  const executable = resolveExecutable(
    process.env[
      provider === 'codex' ? 'ANNOTATE_CODEX_EXECUTABLE' : 'ANNOTATE_CLAUDE_EXECUTABLE'
    ] || provider,
  );
  const { stdout: version } = await promisify(execFile)(executable, ['--version'], {
    timeout: 10_000,
  });
  const wire = join(root, 'wire.jsonl');
  await writeFile(wire, '', { mode: 0o600 });
  const wrapper = join(root, 'record-cli.cjs');
  await writeFile(
    wrapper,
    `#!${process.execPath}
const {spawn}=require('node:child_process');
const {appendFileSync}=require('node:fs');
const readline=require('node:readline');
const child=spawn(${JSON.stringify(executable)},process.argv.slice(2),{stdio:'pipe'});
const record=(direction,line)=>{try{appendFileSync(${JSON.stringify(wire)},JSON.stringify({direction,message:JSON.parse(line)})+'\\n');}catch{}};
readline.createInterface({input:process.stdin}).on('line',line=>{record('input',line);child.stdin.write(line+'\\n');});
process.stdin.on('end',()=>child.stdin.end());
readline.createInterface({input:child.stdout}).on('line',line=>{record('output',line);process.stdout.write(line+'\\n');});
child.stderr.on('data',()=>{});
child.on('error',()=>process.exit(1));
child.on('close',code=>process.exit(code??1));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
`,
    { mode: 0o700 },
  );
  if (provider === 'codex') {
    const { CodexBackend } = require(join(root, 'codex.js'));
    backend = new CodexBackend(wrapper, () => {}, {
      home: join(root, 'isolated-home'),
      authSource:
        process.env.ANNOTATE_CODEX_AUTH_FILE ||
        join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'),
    });
    backend.preferredModel = process.env.ANNOTATE_CODEX_MODEL || '';
  } else {
    const { ClaudeBackend } = require(join(root, 'claude.js'));
    backend = new ClaudeBackend(wrapper, process.env.ANNOTATE_CLAUDE_MODEL || 'haiku', () => {});
  }
  const done = new Promise((resolveDone, reject) => {
    timer = setTimeout(() => {
      backend.disable();
      reject(Error('Single trace capture timed out; no retry performed.'));
    }, 90_000);
    void (async () => {
      await backend.enable();
      const id = await backend.session();
      await backend.ask(
        id,
        JSON.stringify(traceRequest),
        () => {},
        (state, error) => (state === 'completed' ? resolveDone() : reject(Error(error || state))),
      );
    })().catch(reject);
  });
  await done;
  const records = (await readFile(wire, 'utf8')).trim().split('\n').map(JSON.parse);
  const trace = modelTrace(provider, records, version.trim());
  await mkdir('tests/traces', { recursive: true });
  const output = resolve('tests/traces', `${provider}.json`);
  await writeFile(output, JSON.stringify(trace, null, 2) + '\n');
  console.log(`Captured one ${provider} synthetic turn: ${output}`);
} finally {
  clearTimeout(timer);
  backend?.disable();
  await new Promise((resolveDone) => setTimeout(resolveDone, 300));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
