import * as h from './e2e.mjs';
const { ev, key, type, click, shot, check, sleep, P, CMD, SHIFT } = h;
const text =
  String.raw`LaTeX test: 한글 <b>literal</b> $e^{i\pi}+1=0$ and \(\alpha+\beta\).
$$\begin{pmatrix}1&2\\3&4\end{pmatrix}\quad\frac{a}{b}$$
\[\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}\]
Code: \$5 and \$10, \$x\$, ` +
  '`$code$`' +
  String.raw`, incomplete $z`;
const waitMath = async () => {
  for (let i = 0; i < 40; i++) {
    if (
      await ev(
        `return document.querySelectorAll('.annotate-messages .math mjx-container').length>=4`,
      )
    )
      return;
    await sleep(250);
  }
};
for (const mode of ['reading', 'live', 'source']) {
  await h.mode(mode);
  await ev(`${P}p.closePopup()`);
  mode === 'reading'
    ? await h.selectReading('Boundary target: violet flower.')
    : await h.selectEditor('Boundary target: violet flower.');
  await key('m', CMD | SHIFT);
  await type(text);
  await key('Enter');
  await waitMath();
  const snap = await ev(
    `const b=document.querySelector('.annotate-message-body');return {math:b.querySelectorAll('mjx-container').length,display:b.querySelectorAll('.math-block').length,html:!!b.querySelector('b'),text:b.textContent,errors:b.querySelectorAll('mjx-merror').length}`,
  );
  check(
    `[${mode}] inline/display math with native styles and literal HTML`,
    snap.math === 4 &&
      snap.display === 2 &&
      !snap.html &&
      snap.text.includes('<b>literal</b>') &&
      snap.text.includes('$code$') &&
      snap.text.includes('$z') &&
      snap.errors === 0,
    JSON.stringify(snap),
  );
  await shot(`math-${mode}`);
  const id = await ev(`${P}return p.data.threads.at(-1).id`);
  await ev(`${P}p.closePopup();p.openThread(p.data.threads.find(t=>t.id===${JSON.stringify(id)}))`);
  await waitMath();
  check(
    `[${mode}] reopening renders saved LaTeX`,
    await ev(`return document.querySelectorAll('.math mjx-container').length===4`),
  );
  await type(
    String.raw`Bad $\notARealCommand{a}$; wide $$\underbrace{a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a}_{\text{a long expression}}$$`,
  );
  await click('.annotate-send');
  await sleep(600);
  check(
    `[${mode}] invalid TeX keeps thread usable and wide math scrolls`,
    await ev(
      `const bodies=document.querySelectorAll('.annotate-message-body'),wide=bodies[1]?.querySelector('.math-block'),r=document.querySelector('.annotate-popover').getBoundingClientRect();return bodies.length===2&&bodies[1].textContent.includes('notARealCommand')&&wide.scrollWidth>wide.clientWidth&&r.right<=innerWidth&&r.bottom<=innerHeight`,
    ),
  );
  await shot(`math-wide-${mode}`);
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===${JSON.stringify(id)});t.comments.push({id:'math-stream',author:'Codex',role:'assistant',status:'streaming',body:'Streaming $x^2$ then $y',createdAt:Date.now()});p.paintCodex()`,
  );
  await sleep(300);
  await ev(`window.__mathNode=document.querySelector('[data-message-id="math-stream"] .math')`);
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===${JSON.stringify(id)});t.comments.at(-1).body+='^2$';p.paintCodex()`,
  );
  await sleep(300);
  check(
    `[${mode}] completed streamed equations remain rendered`,
    await ev(
      `const b=document.querySelector('[data-message-id="math-stream"]');return b.querySelector('.math')?.textContent===window.__mathNode?.textContent&&b.querySelectorAll('mjx-container').length===2`,
    ),
  );
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===${JSON.stringify(id)});t.comments.at(-1).status='completed';p.paintCodex();await p.persist();p.closePopup()`,
  );
}
await ev(
  `app.changeTheme('moonstone');${P}p.openThread(p.data.threads.find(t=>t.comments[0]?.body.startsWith('LaTeX test:')))`,
);
await sleep(500);
await shot('math-light');
check(
  'math renders in light theme',
  await ev(
    `return document.body.classList.contains('theme-light')&&document.querySelectorAll('.math mjx-container').length===8`,
  ),
);
await ev(`app.changeTheme('obsidian');${P}p.closePopup()`);
process.exit(h.done());
