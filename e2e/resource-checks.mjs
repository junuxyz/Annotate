import { createServer } from 'node:http';
import { setTimeout as settle } from 'node:timers/promises';

// Loopback is a request trap only. No provider or external service is contacted.
export async function checkResources({
  ev,
  step,
  until,
  assert,
  createComment,
  modes = ['live', 'source', 'reading'],
  themes = ['light', 'dark'],
}) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('Synthetic resource probe');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback probe did not bind.');
  const base = `http://127.0.0.1:${address.port}`;
  const P = `const p=app.plugins.plugins.annotate;`;
  const text = [
    '**Ordinary bold survives** and *ordinary emphasis survives*.',
    `[Ordinary link](${base}/ordinary-link) [[Mentions|Ordinary note link]]`,
    `![Synthetic remote image](${base}/markdown-image)`,
    `![Synthetic reference image][probe]\n\n[probe]: ${base}/reference-image`,
    `<img src="${base}/raw-image" srcset="${base}/raw-srcset 1x">`,
    `<style>@import url("${base}/stylesheet"); .annotate-message-body { background-image: url("${base}/background"); }</style>`,
    `<link rel="stylesheet" href="${base}/linked-stylesheet">`,
    `<iframe src="${base}/frame"></iframe>`,
    `<video src="${base}/video" poster="${base}/poster" autoplay><source src="${base}/source"></video>`,
    `<audio src="${base}/audio" autoplay></audio>`,
    `<object data="${base}/object"></object><embed src="${base}/embed">`,
    `<svg><image href="${base}/svg-image"></image></svg>`,
    '<script>window.__annotateProbeExecuted = true</script>',
    '![[Annotations#Annotation fixtures]]',
    '```annotate-security-probe\nSynthetic named processor payload\n```',
  ].join('\n\n');
  let prepared = false;
  try {
    await ev(
      `${P}if(window.__annotateResourceCheck)throw Error('Resource check already running');window.__annotateResourceCheck={threads:structuredClone(p.data.threads)};p.data.codex.enabled=false;p.configureCodex();window.__annotateProbeExecuted=false;p.registerMarkdownCodeBlockProcessor('annotate-security-probe',(_source,element)=>{window.__annotateProbeExecuted=true;element.textContent='Synthetic processor executed'})`,
    );
    prepared = true;
    for (const mode of modes) {
      for (const theme of themes) {
        await step(
          `resources [${mode}/${theme}]: comments never load embeds or execute processors`,
          async () => {
            await ev(
              `${P}p.closePopup();p.data.threads=[];await p.persistOrThrow();window.__annotateProbeExecuted=false;app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')});app.workspace.activeLeaf?.view?.previewMode?.rerender?.(true);app.workspace.activeLeaf?.view?.editor?.cm?.dispatch({})`,
            );
            await createComment(mode, text);
            await until(
              `const body=document.querySelector('.annotate-message-body .annotate-markdown-content');return body?.querySelector('strong')&&body.querySelector('pre code')&&body.querySelector('a.external-link')&&body.querySelector('a.internal-link')`,
              'safe comment rendering completes',
            );
            await settle(150);
            assert(requests.length === 0, 'rendering initiated an automatic resource request');
            assert(
              await ev(
                `const body=document.querySelector('.annotate-message-body');return !window.__annotateProbeExecuted&&!body.querySelector('img,iframe,video,audio,source,object,embed,style,link,script,svg image,.internal-embed,[src],[srcset],[poster]')`,
              ),
              'resource elements and executable processors stay inert',
            );
            assert(
              await ev(
                `const body=document.querySelector('.annotate-message-body');return body.querySelector('strong').textContent==='Ordinary bold survives'&&body.querySelector('em').textContent==='ordinary emphasis survives'&&body.querySelector('a.external-link').getAttribute('href')===${JSON.stringify(base + '/ordinary-link')}&&body.querySelector('a.internal-link').textContent==='Ordinary note link'&&body.textContent.includes('<img')&&body.textContent.includes('Synthetic named processor payload')`,
              ),
              'ordinary Markdown and links preserved while unsafe source stays readable',
            );
            assert(
              await ev(
                `${P}return p.data.threads.at(-1).comments[0].body===${JSON.stringify(text)}`,
              ),
              'stored Markdown source preserved exactly',
            );
            await ev(`document.querySelector('.annotate-message-edit').click()`);
            assert(
              await ev(
                `return document.querySelector('.annotate-message-editor textarea')?.value===${JSON.stringify(text)}`,
              ),
              'comment editor preserves original source',
            );
            await ev(
              `const form=document.querySelector('.annotate-message-editor');[...form.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click()`,
            );
            assert(requests.length === 0, 'editing or cancelling initiated a resource request');
          },
        );
      }
    }
  } finally {
    try {
      if (prepared)
        await ev(
          `${P}p.closePopup();p.data.threads=window.__annotateResourceCheck.threads;p.data.codex.enabled=false;p.configureCodex();await p.persistOrThrow();delete window.__annotateResourceCheck;delete window.__annotateProbeExecuted;app.workspace.activeLeaf?.view?.previewMode?.rerender?.(true);app.workspace.activeLeaf?.view?.editor?.cm?.dispatch({})`,
        );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
}
