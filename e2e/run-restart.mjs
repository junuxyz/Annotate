// Restart-style checks without relaunching: reload the app inside the same hidden window.
import { execFileSync } from 'node:child_process';
const profile = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJS = (expr) =>
  execFileSync('node', ['cdp.mjs', 'eval', expr], { encoding: 'utf8' }).trim();
const reload = async () => {
  try {
    evalJS(`app.commands.executeCommandById('app:reload')`);
  } catch {}
  await sleep(1500);
  execFileSync('node', ['launch-hidden.mjs', profile], { encoding: 'utf8' });
  await sleep(2000);
};
let fail = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fail++;
};
const snap = `(async()=>{const p=app.plugins.plugins['annotate'];await p.persist();return JSON.stringify(p.data.threads.map(t=>[t.id,t.comments.length,t.resolved,t.anchor.quote]))})()`;
const before = evalJS(snap);
await reload();
const after = evalJS(
  `JSON.stringify(app.plugins.plugins['annotate'].data.threads.map(t=>[t.id,t.comments.length,t.resolved,t.anchor.quote]))`,
);
check('threads, replies and states persist across app reload', before === after);
// interrupted response
const q = 'The second test word is amber.';
const start = evalJS(
  `(async()=>{const p=app.plugins.plugins['annotate'];p.data.codex.enabled=true;p.configureCodex();await new Promise(r=>setTimeout(r,4000));let t=p.data.threads.find(t=>t.anchor.quote===${JSON.stringify(q)});if(!t)return 'no-thread';if(t.codex&&['unknown','unavailable'].includes(t.codex.status))t.codex={status:'idle'};p.openThread(t);const ta=document.querySelector('.annotate-composer textarea');ta.value='@chatgpt Write a 500-word story about amber.';ta.dispatchEvent(new Event('input',{bubbles:true}));ta.form.requestSubmit();for(let i=0;i<80&&!['pending','streaming'].includes(t.codex?.status);i++)await new Promise(r=>setTimeout(r,250));await p.persist();return t.codex?.status})()`,
);
await reload();
const rec = JSON.parse(
  JSON.parse(
    evalJS(
      `(async()=>{const p=app.plugins.plugins['annotate'];const t=p.data.threads.find(t=>t.anchor.quote===${JSON.stringify(q)});p.openThread(t);await new Promise(r=>setTimeout(r,500));const reset=document.querySelector('.annotate-codex-reset');const r={st:t.codex.status,last:t.comments.at(-1).status,resetShown:!reset.hidden};reset.click();r.after=t.codex.status;p.closePopup();await p.persist();return JSON.stringify(r)})()`,
    ),
  ),
);
check(
  'interrupted response is unknown, not resent, and can start a new conversation',
  start !== 'no-thread' &&
    rec.st === 'unknown' &&
    rec.last === 'unknown' &&
    rec.resetShown &&
    rec.after === 'idle',
  JSON.stringify({ start, ...rec }),
);
process.exit(fail);
