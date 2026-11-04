import assert from 'node:assert/strict';
import type { Page } from 'puppeteer-core';

export async function checkGraphContinuity(page: Page, out: string) {
  const failures: string[] = [];
  const settle = () => page.evaluate(async () => { for(let i=0;i<15;i++) await new Promise(requestAnimationFrame); });
  const measure = () => page.evaluate(() => {
    const root = document.querySelector('.meo-contributed-block')!.shadowRoot!;
    const svg = root.querySelector('svg')!;
    const group = svg.classList.contains('meo-markmap') ? svg.querySelector('g')! : svg;
    const matrix = (group as SVGGraphicsElement).getScreenCTM()!;
    const canvas = root.querySelector('.meo-contributed-canvas')!.getBoundingClientRect();
    const center = new DOMPoint(canvas.left + canvas.width/2,canvas.top+canvas.height/2).matrixTransform(matrix.inverse());
    return {scale:matrix.a,x:center.x,y:center.y};
  });
  const wait = () => page.waitForFunction(() => document.querySelector('.meo-contributed-block')?.shadowRoot?.querySelector('svg') && !document.querySelector('[data-meo-mermaid-rendering="true"]'));
  const sameCamera = (label: string, before: {scale:number;x:number;y:number}, after: {scale:number;x:number;y:number}) => {
    if (Math.abs(after.scale / before.scale - 1) > .03 || Math.hypot(after.x-before.x,after.y-before.y) > 3)
      failures.push(`${label}: ${JSON.stringify({before,after})}`);
  };
  for (const large of [false,true]) for (const language of ['puml','markmap']) {
    await page.click('button[data-mode="live"]');
    const body = language==='puml' ? '@startuml\n[A] --> [B]\n@enduml' : '# Root\n## One\n- A\n- B';
    await page.evaluate(text => { const v=(window as any).__viewportTestView();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:0}});v.scrollDOM.scrollTop=0; }, '# Diagram\n\n```'+language+'\n'+body+'\n```\n\n'+'Paragraph.\n\n'.repeat(large ? 15000 : 30));
    await wait(); await settle(); await page.click('.meo-mermaid-mode-btn'); await page.waitForSelector('.meo-mermaid-layout-btn'); await wait(); await settle();
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('.meo-mermaid-zoom-controls [data-action="zoom-in"]')!.click());
    const box = await page.evaluate(() => {const r=document.querySelector('.meo-contributed-block')!.getBoundingClientRect();return{x:r.x+30,y:r.y+40}});
    await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.x+45,box.y+25,{steps:4});await page.mouse.up();await settle();
    const before=await measure();
    await page.click('.meo-mermaid-layout-btn');await wait();await settle();const layout=await measure();
    sameCamera(`${language}/${large} layout`,before,layout);
    await page.evaluate(language => {const v=(window as any).__viewportTestView();const at=v.state.doc.toString().indexOf(language==='puml'?'[B]':'- B');v.dispatch({changes:{from:at+ (language==='puml'?2:3),insert:' updated'}});},language);
    await page.waitForFunction(()=>document.querySelector('.meo-contributed-block')?.shadowRoot?.textContent?.includes('updated'));
    await wait();await settle();const edited=await measure();
    sameCamera(`${language}/${large} edit`,layout,edited);
    await page.click('.meo-mermaid-layout-btn');await wait();await settle();
    sameCamera(`${language}/${large} return layout`,edited,await measure());
    await page.click('.meo-mermaid-mode-btn');await wait();
    if (large) continue;
    await page.click('button[data-mode="preview"]');
    for(const preset of ['default','newsprint','whitey','obsidian-minimal']) {
      await page.select('.preview-preset-control select',preset);
      await page.waitForFunction(preset=>document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.documentElement.dataset.meoPreviewPreset===preset,{},preset);
      await page.waitForFunction(()=>document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('.meo-export-graph .meo-contributed-block')?.shadowRoot?.querySelector('svg'));await settle();
      const bg=await page.evaluate(()=>{
        const d=document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
        const block=d.querySelector('.meo-export-graph')!, mermaid=d.createElement('div');
        mermaid.className='meo-export-mermaid';block.after(mermaid);
        const color=d.defaultView!.getComputedStyle(block).backgroundColor;
        const builtin=d.defaultView!.getComputedStyle(mermaid).backgroundColor;mermaid.remove();
        if(color!==builtin)throw new Error(`Graph surface ${color} differs from Mermaid ${builtin}`);
        const root=block.querySelector('.meo-contributed-block')!.shadowRoot!;
        if(d.defaultView!.getComputedStyle(root.querySelector('.meo-contributed-canvas')!).backgroundColor!=='rgba(0, 0, 0, 0)')throw new Error('Renderer forces an opaque surface');
        return color;
      });
      if(preset!=='default'&&bg!=='rgba(0, 0, 0, 0)')failures.push(`${language}/${preset}: forced background ${bg}`);
      if(preset==='default'&&bg==='rgba(0, 0, 0, 0)')failures.push(`${language}/${preset}: missing background`);
      if(language==='markmap'&&(preset==='default'||preset==='newsprint')) {
        await page.evaluate(()=>document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentWindow!.scrollTo(0,0));
        await settle();
        await page.screenshot({path:out+'/graph-surface-'+preset+'.png'});
      }
    }
  }
  assert.deepEqual(failures,[]);
}
