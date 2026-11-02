/**
 * THROWAWAY UI PROTOTYPE — two document-map layouts in the existing editor.
 * A replaces the reading surface; B opens beside it. ?variant=A|B.
 * No extension SDK or persistence. The heading/list parser is sample-only.
 */
import { createElement, Network, ArrowLeft, X, Maximize2, Minimize2, LocateFixed, Minus, Plus, RefreshCw, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide';
type PrototypeHost = {
  root: HTMLElement; editorSurface: HTMLElement; entryContainer: HTMLElement;
  getText(): string; revealLine(line: number): void;
  preserveReading(): () => void; getLanguage(): string;
};
type MapNode = { id: number; label: string; children: MapNode[]; x?: number; y?: number };
const styles = "\n.mm-prototype-entry{gap:5px!important;width:auto!important;padding:0 8px!important;margin-right:6px;font:12px var(--vscode-font-family,system-ui)!important;white-space:nowrap}\n.mm-prototype-entry svg{width:16px;height:16px}\n.mm-prototype-panel{position:absolute;inset:40px 0 54px;z-index:240;display:flex;flex-direction:column;background:var(--meo-background);color:var(--meo-ui-text);font:13px var(--vscode-font-family,system-ui)}\n.mm-prototype-panel[hidden]{display:none}\n.mm-prototype-panel.is-side{left:52%;border-left:1px solid var(--meo-ui-separator)}\n.mm-prototype-head{height:38px;flex:none;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--meo-ui-separator)}\n.mm-prototype-head strong{font-size:12px;font-weight:500;margin-right:auto}\n.mm-prototype-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:28px;height:28px;border:0;border-radius:5px;padding:4px 6px;background:transparent;color:var(--meo-ui-text);cursor:pointer;font:12px var(--vscode-font-family,system-ui)}\n.mm-prototype-button svg{width:16px;height:16px;pointer-events:none}\n.mm-prototype-button:hover{background:var(--meo-ui-surface-hover)}\n.mm-prototype-button:active{background:var(--meo-ui-surface-pressed)}\n.mm-prototype-button:focus-visible,.mm-node:focus-visible{outline:2px solid var(--meo-ui-focus);outline-offset:2px}\n.mm-prototype-canvas{position:relative;flex:1;min-height:0;overflow:hidden}\n.mm-prototype-svg{display:block;width:100%;height:100%;touch-action:none;cursor:grab}\n.mm-prototype-svg:active{cursor:grabbing}\n.mm-branch{fill:none;stroke:var(--meo-ui-text-muted);stroke-opacity:.48;stroke-width:1.4}\n.mm-node{cursor:pointer}\n.mm-node text{fill:var(--meo-ui-text);font:14px var(--vscode-font-family,system-ui)}\n.mm-node .mm-node-hit{fill:transparent}\n.mm-node line{stroke:var(--meo-ui-text-muted);stroke-width:1.4}\n.mm-node.selected .mm-node-hit{fill:var(--meo-ui-surface-selected)}\n.mm-node.selected text{fill:var(--meo-ui-accent-text)}\n.mm-node.selected line{stroke:var(--meo-ui-accent-text);stroke-width:2}\n.mm-fold circle{fill:var(--meo-background);stroke:var(--meo-ui-text-muted)}\n.mm-fold text{font:12px system-ui;fill:var(--meo-ui-text);text-anchor:middle}\n.mm-fold{cursor:pointer}\n.mm-prototype-controls{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:4px;border-radius:8px;background:var(--meo-ui-surface);border:1px solid var(--meo-ui-border-float);white-space:nowrap}\n.mm-prototype-controls span{font-size:11px;min-width:36px;text-align:center;color:var(--meo-ui-text-muted)}\n.mm-prototype-locate{position:absolute;right:12px;top:10px;background:var(--meo-ui-surface);border:1px solid var(--meo-ui-border-float);max-width:calc(100% - 24px)}\n.mm-prototype-locate span{max-width:155px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.mm-prototype-tip{position:absolute;left:12px;top:10px;color:var(--meo-ui-text-muted);font-size:11px;pointer-events:none}\n.mm-prototype-dock{position:absolute;z-index:900;left:50%;bottom:8px;transform:translateX(-50%);display:flex;align-items:center;gap:5px;max-width:calc(100% - 16px);padding:4px 8px;background:var(--meo-ui-surface-raised);color:var(--meo-ui-text);border:1px solid var(--meo-ui-border-control);box-shadow:0 2px 10px #0002;border-radius:9px;font:12px var(--vscode-font-family,system-ui);white-space:nowrap}\n.mm-prototype-dock .mm-label{min-width:150px;text-align:center}\n.mm-prototype-dock small{font-size:10px;color:var(--meo-ui-text-muted);border-right:1px solid var(--meo-ui-separator);padding-right:8px}\n.mm-prototype-state{font-size:10px!important;color:var(--meo-ui-text-muted);margin-left:4px}\n.mm-prototype-empty{margin:auto;text-align:center;color:var(--meo-ui-text-muted);line-height:1.8;padding:24px}\n@media(max-width:560px){.mm-prototype-dock .mm-label{min-width:128px}.mm-prototype-state{display:none}.mm-prototype-panel.is-side{left:45%}.mm-prototype-entry{padding:0 5px!important}.mm-prototype-entry span{display:none}.mm-prototype-head{gap:3px;padding:0 5px}.mm-prototype-tip{max-width:75%;line-height:1.6}}\n";

export function mountMindmapPrototype(host: PrototypeHost) {
  const sheet=document.createElement('style');sheet.textContent=styles;document.head.append(sheet);
  const t=(zh:string,en:string)=>host.getLanguage().startsWith('zh')?zh:en;
  function button(label:string,i:Parameters<typeof createElement>[0],run:()=>void,text=false){
    const b=document.createElement('button');b.type='button';b.className='mm-prototype-button';b.title=label;b.setAttribute('aria-label',label);b.append(createElement(i,{width:16,height:16}));
    if(text){const s=document.createElement('span');s.textContent=label;b.append(s)}
    b.addEventListener('click',run);return b;
  }
  let variant=new URLSearchParams(location.search).get('variant')==='B'?'B':'A';
  let opened=false,maximized=false,selected:number|null=null,folded=new Set<number>();
  let zoom=1,pan={x:0,y:0},map:MapNode|null=null,viewWidth=750,viewHeight=380;
  let restoreReading:()=>void=()=>{},updateTimer:ReturnType<typeof setTimeout>|undefined;
  const entry=button(t('思维导图','Mind map'),Network,()=>opened?close():open(),true);
  entry.classList.add('format-button','mm-prototype-entry');entry.dataset.prototype='mindmap';
  host.entryContainer.prepend(entry);
  const panel=document.createElement('section');panel.className='mm-prototype-panel';panel.hidden=true;panel.setAttribute('aria-label',t('思维导图','Mind map'));host.root.append(panel);
  const dock=document.createElement('div');dock.className='mm-prototype-dock';host.root.append(dock);
  const original={right:host.editorSurface.style.right,bottom:host.editorSurface.style.bottom,visibility:host.editorSurface.style.visibility};
  host.editorSurface.style.bottom='54px';
  function parseSampleOutline(text:string):MapNode|null{
    const lines=text.slice(0,128000).split('\n'),root:MapNode={id:0,label:t('当前文档','Current document'),children:[]};
    const stack:{depth:number;node:MapNode}[]=[{depth:0,node:root}];
    let fence=false,count=0;
    for(let n=0;n<lines.length&&count<90;n++){
      if(/^\s*(\x60{3,}|~{3,})/.test(lines[n])){fence=!fence;continue}
      if(fence)continue;
      const heading=/^(#{1,6})\s+(.+)/.exec(lines[n]),item=/^(\s*)(?:[-*+]|\d+\.)\s+(.+)/.exec(lines[n]);
      if(!heading&&!item)continue;
      if(heading&&heading[1].length===1&&root.children.length===0&&root.id===0){root.id=n+1;root.label=heading[2];continue}
      const depth=heading?heading[1].length:7+Math.floor(item![1].length/2);
      const node:MapNode={id:n+1,label:(heading?heading[2]:item![2]).replace(/\*\*|\x60/g,'').slice(0,32),children:[]};
      while(stack.length>1&&stack[stack.length-1].depth>=depth)stack.pop();
      stack[stack.length-1].node.children.push(node);stack.push({depth,node});count++;
    }
    return count?root:null;
  }
  function snapshot(){map=parseSampleOutline(host.getText());if(selected&&!find(map,selected))selected=null}
  function find(node:MapNode|null,id:number):MapNode|undefined{return node?.id===id?node:node?.children.map(n=>find(n,id)).find(Boolean)}
  function currentSide(){return variant==='B'&&!maximized}
  function layout(){
    panel.classList.toggle('is-side',currentSide());
    host.editorSurface.style.right=opened&&currentSide()?(host.root.clientWidth<=560?'55%':'48%'):original.right;
    host.editorSurface.style.visibility=opened&&!currentSide()?'hidden':original.visibility;
    entry.classList.toggle('is-active',opened);entry.setAttribute('aria-pressed',String(opened));
  }
  function open(){
    restoreReading=host.preserveReading();snapshot();opened=true;maximized=false;panel.hidden=false;
    layout();renderMap();renderDock();requestAnimationFrame(()=>restoreReading());
  }
  function close(restore=true){
    if(!opened)return;
    if(currentSide())restoreReading=host.preserveReading();
    opened=false;panel.hidden=true;layout();renderDock();
    if(restore)requestAnimationFrame(()=>restoreReading());
    entry.focus({preventScroll:true});
  }
  function locate(){
    const node=selected===null?null:find(map,selected);if(!node)return;
    if(!currentSide())close(false);
    requestAnimationFrame(()=>host.revealLine(Math.max(1,node.id)));
  }
  function switchVariant(){
    close();variant=variant==='A'?'B':'A';maximized=false;
    try{const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url)}catch{/* Webviews can restrict URL writes. */}
    renderDock();
  }
  function renderDock(){
    dock.replaceChildren();
    const badge=document.createElement('small');badge.textContent=t('交互原型','PROTOTYPE');
    const label=document.createElement('span');label.className='mm-label';label.textContent=variant==='A'?t('A · 当前区域切换','A · Replace document'):t('B · 正文旁边打开','B · Beside document');
    const status=document.createElement('span');status.className='mm-prototype-state';status.textContent=opened?t('导图已打开','Map open'):t('正在查看正文','Document');
    dock.append(badge,button(t('上一方案','Previous variant'),ChevronLeft,switchVariant),label,button(t('下一方案','Next variant'),ChevronRight,switchVariant),status);
  }
  const ns='http://www.w3.org/2000/svg';
  function svgEl(name:string,attrs:Record<string,string|number>={},text?:string){
    const el=document.createElementNS(ns,name);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;return el;
  }
  function renderMap(){
    panel.replaceChildren();
    const head=document.createElement('header');head.className='mm-prototype-head';
    if(!currentSide())head.append(button(t('返回正文','Back to document'),ArrowLeft,()=>close(),true));
    const title=document.createElement('strong');title.textContent=currentSide()?t('思维导图','Mind map'):t('全文导图','Document map');head.append(title);
    head.append(button(t('刷新导图','Refresh map'),RefreshCw,()=>{snapshot();renderMap()}));
    if(variant==='B')head.append(button(maximized?t('恢复分栏','Restore split'):t('展开查看','Expand'),maximized?Minimize2:Maximize2,()=>{restoreReading=host.preserveReading();maximized=!maximized;layout();renderMap();requestAnimationFrame(()=>restoreReading())}));
    if(currentSide())head.append(button(t('关闭导图','Close map'),X,()=>close()));
    panel.append(head);
    const canvas=document.createElement('div');canvas.className='mm-prototype-canvas';panel.append(canvas);
    if(!map){const empty=document.createElement('p');empty.className='mm-prototype-empty';empty.textContent=t('为文档添加标题或列表后，再打开导图。','Add headings or lists to view the document map.');canvas.append(empty);return}
    const nodes:MapNode[]=[],edges:[MapNode,MapNode][]=[];let row=0;
    function measure(n:MapNode,depth:number){
      const children=folded.has(n.id)?[]:n.children;
      children.forEach(c=>{measure(c,depth+1);edges.push([n,c])});
      n.x=depth*200+25;n.y=children.length?children.reduce((sum,c)=>sum+c.y!,0)/children.length:row++*46+38;nodes.push(n);
    }
    measure(map,0);viewWidth=Math.max(...nodes.map(n=>n.x!))+190;viewHeight=Math.max(row*46+30,260);
    const svg=svgEl('svg',{class:'mm-prototype-svg',viewBox:'0 0 '+viewWidth+' '+viewHeight,role:'group','aria-label':t('思维导图画布','Mind map canvas')});
    const camera=svgEl('g');svg.append(camera);
    function cameraTransform(){camera.setAttribute('transform','translate('+(viewWidth/2+pan.x)+' '+(viewHeight/2+pan.y)+') scale('+zoom+') translate('+(-viewWidth/2)+' '+(-viewHeight/2)+')')}
    cameraTransform();
    for(const[a,b]of edges)camera.append(svgEl('path',{class:'mm-branch',d:'M '+(a.x!+163)+' '+(a.y!+13)+' C '+(a.x!+186)+' '+(a.y!+13)+', '+(b.x!-25)+' '+(b.y!+13)+', '+b.x+' '+(b.y!+13)}));
    for(const n of nodes){
      const g=svgEl('g',{class:'mm-node'+(selected===n.id?' selected':''),transform:'translate('+n.x+','+n.y+')',tabindex:0,role:'button','aria-label':n.label});
      g.append(svgEl('rect',{class:'mm-node-hit',x:-5,y:-16,width:172,height:34,rx:5}),svgEl('text',{x:4,y:5},n.label.length>13?n.label.slice(0,12)+'…':n.label),svgEl('line',{x1:0,y1:13,x2:163,y2:13}),svgEl('title',{},n.label));
      let clickTime=0;
      const choose=()=>{
        const now=Date.now(),double=selected===n.id&&now-clickTime<500;clickTime=now;selected=n.id;
        canvas.querySelectorAll('.mm-node').forEach(el=>el.classList.toggle('selected',el===g));showLocate();if(double)locate();
      };
      g.addEventListener('click',choose);
      g.addEventListener('keydown',(event)=>{const e=event as KeyboardEvent;if(e.key==='Enter'){e.preventDefault();selected=n.id;locate()}if(e.key===' '){e.preventDefault();choose()}});
      camera.append(g);
      if(n.children.length){
        const f=svgEl('g',{class:'mm-fold',transform:'translate('+(n.x!+173)+','+(n.y!+13)+')',tabindex:0,role:'button','aria-label':t('折叠或展开','Collapse or expand')+' '+n.label});
        f.append(svgEl('circle',{r:7}),svgEl('text',{y:4},folded.has(n.id)?'+':'−'));
        const fold=()=>{folded.has(n.id)?folded.delete(n.id):folded.add(n.id);renderMap()};
        f.addEventListener('click',fold);f.addEventListener('keydown',(event)=>{const e=event as KeyboardEvent;if(e.key==='Enter'||e.key===' '){e.preventDefault();fold()}});camera.append(f);
      }
    }
    canvas.append(svg);
    const tip=document.createElement('span');tip.className='mm-prototype-tip';tip.textContent=t('拖动画布 · 滚轮缩放','Drag to pan · Scroll to zoom');canvas.append(tip);
    function showLocate(){
      canvas.querySelector('.mm-prototype-locate')?.remove();
      const chosen=selected===null?null:find(map,selected);if(!chosen)return;
      const b=button(t('在正文中查看','Show in document')+' · '+chosen.label,ArrowUpRight,locate,true);b.classList.add('mm-prototype-locate');canvas.append(b);
    }
    showLocate();
    const controls=document.createElement('div');controls.className='mm-prototype-controls';const percent=document.createElement('span');
    function changeZoom(delta:number){zoom=Math.max(.5,Math.min(2.5,zoom+delta));cameraTransform();percent.textContent=Math.round(zoom*100)+'%'}
    controls.append(button(t('缩小','Zoom out'),Minus,()=>changeZoom(-.15)),percent,button(t('放大','Zoom in'),Plus,()=>changeZoom(.15)),button(t('适应画布','Fit map'),LocateFixed,()=>{pan={x:0,y:0};zoom=1;changeZoom(0)}));changeZoom(0);canvas.append(controls);
    let drag:{x:number;y:number;startX:number;startY:number}|null=null;
    svg.addEventListener('pointerdown',(event)=>{const e=event as PointerEvent;if((e.target as Element).closest('.mm-node,.mm-fold'))return;drag={x:e.clientX,y:e.clientY,startX:pan.x,startY:pan.y};(svg as SVGSVGElement).setPointerCapture(e.pointerId)});
    svg.addEventListener('pointermove',(event)=>{if(!drag)return;const e=event as PointerEvent,m=(svg as SVGSVGElement).getScreenCTM();if(!m)return;pan={x:drag.startX+(e.clientX-drag.x)/m.a,y:drag.startY+(e.clientY-drag.y)/m.d};cameraTransform()});
    svg.addEventListener('pointerup',()=>drag=null);svg.addEventListener('pointercancel',()=>drag=null);
    svg.addEventListener('wheel',(event)=>{const e=event as WheelEvent;e.preventDefault();changeZoom(e.deltaY>0?-.08:.08)},{passive:false});
  }
  const onKey=(event:KeyboardEvent)=>{
    if(event.key==='Escape'&&opened){event.preventDefault();close();return}
    const target=event.target as Element;
    if(target.closest('input,textarea,[contenteditable="true"],.cm-editor,.mm-node,.mm-fold,[role="tablist"]'))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();switchVariant()}
  };
  document.addEventListener('keydown',onKey);
  const onMode=(event:Event)=>{if((event.target as Element).closest('button[data-mode]'))close()};
  host.root.addEventListener('click',onMode,{capture:true});
  const onInput=()=>{if(!opened)return;clearTimeout(updateTimer);updateTimer=setTimeout(()=>{if(opened){snapshot();renderMap()}},240)};
  host.editorSurface.addEventListener('input',onInput);
  const onResize=()=>{if(opened)layout()};window.addEventListener('resize',onResize);
  const languageObserver=new MutationObserver(()=>{
    const label=t('思维导图','Mind map');entry.title=label;entry.setAttribute('aria-label',label);
    const span=entry.querySelector('span');if(span)span.textContent=label;
    renderDock();if(opened)renderMap();
  });
  languageObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  renderDock();
  return {open,close,switchVariant,dispose(){
    clearTimeout(updateTimer);close();languageObserver.disconnect();document.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);
    host.root.removeEventListener('click',onMode,true);host.editorSurface.removeEventListener('input',onInput);
    entry.remove();panel.remove();dock.remove();sheet.remove();host.editorSurface.style.bottom=original.bottom;
  }};
}

