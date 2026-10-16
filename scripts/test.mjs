import { spawn, execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const command = promisify(execFile);
let files = (await readdir('tests')).filter((file) => /\.test\.(mjs|ts)$/.test(file)).sort();
const args = process.argv.slice(2);
const selection = args.indexOf('--files');
if (selection !== -1) {
  const requested = args[selection + 1]?.split(',');
  if (
    args.lastIndexOf('--files') !== selection ||
    !requested?.length ||
    requested.some((file) => !files.includes(file))
  )
    throw new Error('--files requires a comma-separated list of existing test filenames.');
  files = files.filter((file) => requested.includes(file));
  args.splice(selection, 2);
}
const heapMiB = 256;
function limit(name, maximum) {
  const value = Number(process.env[name] ?? maximum);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  return value;
}
const rssKiB = limit('ANNOTATE_TEST_RSS_MIB', 768) * 1024;
const deadlineMs = limit('ANNOTATE_TEST_TIMEOUT_MS', 30_000);
const outputLimit = limit('ANNOTATE_TEST_OUTPUT_BYTES', 1024 * 1024);
const options = process.env.NODE_OPTIONS ?? '';
const env = {
  ...process.env,
  NODE_OPTIONS: `${options.replace(/--max-old-space-size(?:=|\s+)\d+/g, '')} --max-old-space-size=${heapMiB}`,
};

async function run(file) {
  console.log(
    `\nTesting ${file} (heap ${heapMiB} MiB, process tree ${rssKiB / 1024} MiB, ${deadlineMs / 1000} s limit)`,
  );
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--test',
      ...args,
      '--test-concurrency=1',
      `--max-old-space-size=${heapMiB}`,
      `tests/${file}`,
    ],
    { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stopped = false;
  let exited = false;
  let monitoring = false;
  let bytes = 0;
  let peakKiB = 0;
  const stop = (reason) => {
    if (stopped || exited) return;
    stopped = true;
    console.error(`Stopped ${file}: ${reason}`);
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  const forward = (stream, chunk) => {
    bytes += chunk.length;
    if (bytes > outputLimit) stop(`output exceeded ${outputLimit} bytes`);
    else stream.write(chunk);
  };
  child.stdout.on('data', (chunk) => forward(process.stdout, chunk));
  child.stderr.on('data', (chunk) => forward(process.stderr, chunk));
  const timeout = setTimeout(
    () => stop(`${deadlineMs / 1000} second deadline exceeded`),
    deadlineMs,
  );
  const monitor = setInterval(
    async () => {
      if (monitoring || stopped || exited || !child.pid) return;
      monitoring = true;
      try {
        let rows;
        if (process.platform === 'win32') {
          const { stdout } = await command(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1} {2}" -f $_.ProcessId,$_.ParentProcessId,([long]$_.WorkingSetSize/1024) }',
            ],
            { timeout: 2000, maxBuffer: 1024 * 1024 },
          );
          rows = stdout;
        } else {
          const { stdout } = await command('ps', ['-axo', 'pid=,ppid=,rss='], {
            timeout: 2000,
            maxBuffer: 1024 * 1024,
          });
          rows = stdout;
        }
        const processes = rows
          .trim()
          .split('\n')
          .map((line) => line.trim().split(/\s+/).map(Number));
        const descendants = new Set([child.pid]);
        let size;
        do {
          size = descendants.size;
          for (const [pid, parent] of processes) if (descendants.has(parent)) descendants.add(pid);
        } while (size !== descendants.size);
        const total = processes.reduce(
          (sum, [pid, , rss]) => sum + (descendants.has(pid) ? rss : 0),
          0,
        );
        peakKiB = Math.max(peakKiB, total);
        if (total > rssKiB) stop(`process tree exceeded ${rssKiB / 1024} MiB RSS`);
      } catch (error) {
        stop(`memory monitoring failed: ${error.message}`);
      } finally {
        monitoring = false;
      }
    },
    process.platform === 'win32' ? 1000 : 200,
  );
  const interrupt = () => stop('test runner interrupted');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const code = await new Promise((resolve) => {
    child.once('error', (error) => {
      exited = true;
      console.error(error.message);
      resolve(1);
    });
    child.once('close', (exitCode) => {
      exited = true;
      resolve(exitCode ?? 1);
    });
  });
  clearTimeout(timeout);
  clearInterval(monitor);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  console.log(
    `Finished ${file}; ${peakKiB ? `sampled peak ${(peakKiB / 1024).toFixed(0)} MiB RSS` : 'finished before the first memory sample'}`,
  );
  return stopped ? 1 : code;
}

for (const file of files) {
  const code = await run(file);
  if (code) process.exit(code);
}
