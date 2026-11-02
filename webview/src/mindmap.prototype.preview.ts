// Standalone comparison surface. The graph is the SAME component used by index.ts.
// Document rows are a read-only visual fixture; real editing remains in the Development Host.
import { mountMindmapPrototype } from './mindmap.prototype';
import { createSegmentedControl } from './adapters/segmentedControl';
import { createElement, ListTree, Hash, Save, CopyPlus, Undo2, Redo2, RotateCcw, Heading, List, ListOrdered, Quote, Link, Image, Search, Settings, PanelLeftRightDashed } from 'lucide';
const sample="# 周末短途旅行\n\n## 出发前\n\n把准备工作提前做好，周末留给路上的风景。\n\n### 交通\n\n- 确定出发时间\n- 预订往返车票\n\n### 行李\n\n- 相机与充电器\n- 一件轻便外套\n\n## 第一天\n\n上午到达，下午慢慢逛，不把行程排得太满。\n\n### 城市漫步\n\n- 老街和书店\n- 河边散步\n\n### 晚餐\n\n- 尝试当地小吃\n- 早点回去休息\n\n## 第二天\n\n看天气决定去山里还是留在城里。\n\n### 自然风景\n\n- 公园步道\n- 留一点拍照时间\n\n### 返程\n\n- 午后取行李\n- 傍晚到家\n";
const root=document.getElementById('prototype-editor')!;
const toolbar=document.createElement('div');toolbar.className='mode-toolbar';root.append(toolbar);
const left=document.createElement('div');left.className='format-group';toolbar.append(left);
for(const [i,label] of [[ListTree,'目录'],[Hash,'跳转到行'],[Save,'保存'],[CopyPlus,'另存为'],[Undo2,'撤销'],[Redo2,'重做'],[RotateCcw,'重新加载'],[Heading,'标题'],[List,'列表'],[ListOrdered,'编号'],[Quote,'引用'],[Link,'链接'],[Image,'图片']] as const){
 const button=document.createElement('button');button.className='format-button';button.title=label+'（在真实编辑器中体验）';button.disabled=true;button.append(createElement(i,{width:18,height:18}));left.append(button);
}
const right=document.createElement('div');right.className='toolbar-right';toolbar.append(right);
const modes=createSegmentedControl({ariaLabel:'Markdown 模式',className:'mode-group',buttonClassName:'mode-button',datasetKey:'mode',role:'tablist',width:'170px',options:[{value:'live',label:'Live'},{value:'source',label:'Source'},{value:'preview',label:'Preview'}]});
right.append(modes.element);modes.setActive('live');
const wrapper=document.createElement('div');wrapper.className='prototype-document';root.append(wrapper);
const doc=document.createElement('div');doc.className='prototype-document-content';wrapper.append(doc);
type Mode = 'live' | 'source' | 'preview';
const lines=sample.split('\n');
function showDocument(mode:Mode){
 const visible=Array.from(doc.children).find(el=>el.getBoundingClientRect().bottom>wrapper.getBoundingClientRect().top+15) as HTMLElement|undefined;
 const anchor=visible?.dataset.line;
 const offset=visible?visible.getBoundingClientRect().top-wrapper.getBoundingClientRect().top:0;
 doc.replaceChildren();root.dataset.mode=mode;modes.setActive(mode);
 lines.forEach((line,index)=>{
  const heading=/^(#{1,6})\s+(.+)/.exec(line),item=/^- (.+)/.exec(line);
  const el=document.createElement(mode==='source'?'div':heading?'h'+heading[1].length:'p');
  el.dataset.line=String(index+1);
  if(mode==='source'){el.className='prototype-source-line';const number=document.createElement('span');number.textContent=String(index+1);el.append(number,document.createTextNode(line||' '))}
  else{el.textContent=heading?heading[2]:item?'•  '+item[1]:line||'\u00a0';if(item)el.className='prototype-list';if(!line)el.className='prototype-blank'}
  doc.append(el);
 });
 if(anchor){const el=doc.querySelector<HTMLElement>('[data-line="'+anchor+'"]');if(el)wrapper.scrollTop+=el.getBoundingClientRect().top-wrapper.getBoundingClientRect().top-offset}
}
for(const mode of ['live','source','preview'] as const)modes.getButton(mode).addEventListener('click',()=>showDocument(mode));
showDocument('live');
const controller=mountMindmapPrototype({
 root,editorSurface:wrapper,entryContainer:right,getText:()=>sample,getLanguage:()=>document.documentElement.lang,
 revealLine(line){
  doc.querySelectorAll('.prototype-target').forEach(el=>el.classList.remove('prototype-target'));
  const el=doc.querySelector<HTMLElement>('[data-line="'+line+'"]');if(!el)return;
  el.classList.add('prototype-target');wrapper.scrollTop+=el.getBoundingClientRect().top-wrapper.getBoundingClientRect().top-32;
 },
 preserveReading(){
  const top=wrapper.scrollTop;
  const el=Array.from(doc.children).find(el=>el.getBoundingClientRect().bottom>wrapper.getBoundingClientRect().top+15) as HTMLElement|undefined;
  const line=el?.dataset.line,offset=el?el.getBoundingClientRect().top-wrapper.getBoundingClientRect().top:0;
  return()=>{const target=line?doc.querySelector<HTMLElement>('[data-line="'+line+'"]'):null;if(target)wrapper.scrollTop+=target.getBoundingClientRect().top-wrapper.getBoundingClientRect().top-offset;else wrapper.scrollTop=top};
 }
});
document.getElementById('theme-toggle')!.addEventListener('click',()=>document.documentElement.classList.toggle('prototype-dark'));
document.getElementById('reset-view')!.addEventListener('click',()=>{controller.close();showDocument('live');wrapper.scrollTop=0});
if(new URLSearchParams(location.search).has('open'))controller.open();

