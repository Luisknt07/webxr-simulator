// Floating scene controls; landing/catalogue pages retain their document bar.
// Native practice state selects the presentation; handlers/permissions stay put.
const ICONS = {
  home:'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  scenes:'M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v6H3zM14 15h7v6h-7z',
  guide:'M5 3h11l4 4v14H5zM15 3v5h5M8 12h9M8 16h9',
  results:'M4 4h16v16H4zM8 15v2M12 11v6M16 7v10',
  overview:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  xr:'M3 6h18l1 12h-6l-4-4-4 4H2L3 6ZM6 9v5M4 11.5h4M16 10h.01M19 13h.01',
  menu:'M4 6h16M4 12h16M4 18h16',
  microphone:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  assistant:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  camera:'M3 6h5l2-3h4l2 3h5v15H3ZM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  controls:'M4 7h16M4 17h16M8 4v6M16 14v6',
  move:'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  account:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-3a8 6 0 0 1 16 0v3',
  rooms:'M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM2 20v-3a7 5 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6M19 13a5 4 0 0 1 3 4v3',
  hand:'M8 12V5a2 2 0 0 1 4 0v6M12 10V3a2 2 0 0 1 4 0v8M16 11V6a2 2 0 0 1 4 0v9c0 5-3 7-7 7h-2c-3 0-5-2-6-4l-3-5a2 2 0 0 1 3-2l3 3',
  chat:'M3 4h18v13H9l-6 4V4ZM7 8h10M7 12h7',
  leave:'M10 3H3v18h7M8 12h13m-5-5 5 5-5 5',
  pause:'M8 4v16M16 4v16',
  restart:'M4 4v6h6M4 10a8 8 0 1 1 0 5',
  drive:'M3 14h11V8H7v6M14 4h4v15h4M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM15 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  sound:'M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
  back:'m10 5-7 7 7 7M3 12h18',
  settings:'M4 7h16M4 17h16M8 4v6M16 14v6'
};
export function createExperienceIcon(dom, action) {
  const svg=dom.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('st-header-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  const path=dom.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',ICONS[action]||ICONS.scenes);svg.appendChild(path);return svg;
}
export function connectExperienceHeader(header, {brand, actions, controls={}, onInteract}={}) {
  if(!header||!brand||!actions)return {dispose(){}};
  const dom=header.ownerDocument,view=dom.defaultView||window;
  header.classList.add('st-app-header');brand.classList.add('st-app-brand');actions.classList.add('st-app-actions');
  const cube=dom.createElement('i');cube.className='st-app-cube';cube.setAttribute('aria-hidden','true');
  const copy=dom.createElement('span');copy.className='st-app-brand-copy';
  const name=dom.createElement('strong');name.textContent='SMART-TWIN Simulator';
  const subtitle=dom.createElement('small');subtitle.textContent='Simulación industrial y logística';copy.append(name,subtitle);brand.replaceChildren(cube,copy);
  let closed=false;
  function decorate(control,action){
    if(!control)return;
    control.classList.add('st-header-action');control.dataset.stAction=action;
    if(!ICONS[action]||control.querySelector('.st-header-icon'))return;
    if(action==='microphone')control.textContent='';
    if(action==='assistant'&&control.textContent.startsWith('✦ '))control.textContent=control.textContent.slice(2);
    control.insertBefore(createExperienceIcon(dom,action),control.firstChild);
  }
  const refresh=()=>{
    if(closed)return;
    for(const [action,value]of Object.entries(controls)){const control=typeof value==='string'?actions.querySelector(value):value;decorate(control,action);}
    for(const [selector,action]of [['[data-voice-assistant-toggle]','voice'],['[data-voice-microphone]','microphone'],['[data-assistant-workspace-toggle]','assistant']])decorate(actions.querySelector(selector),action);
  };
  const resize=()=>{const rect=header.getBoundingClientRect();if(rect.height>0)dom.body.style.setProperty('--st-header-height',Math.ceil(rect.bottom)+'px');};
  const syncMode=()=>{if(closed)return;const next=dom.body.getAttribute('data-practice-game')==='true'?'game':'tour',layout=!header.dataset.screen||header.dataset.screen==='demo'?'floating':'bar';if(header.dataset.stExperience===next&&header.dataset.stLayout===layout)return;header.dataset.stExperience=next;header.dataset.stLayout=layout;resize();};
  const interact=event=>{event.stopPropagation();if(onInteract&&['pointerdown','keydown'].includes(event.type))onInteract();};
  for(const type of ['pointerdown','click','keydown','keyup'])header.addEventListener(type,interact);
  const observer=typeof view.MutationObserver==='function'?new view.MutationObserver(refresh):null;
  if(observer)observer.observe(actions,{childList:true,subtree:true});
  const sizes=typeof view.ResizeObserver==='function'?new view.ResizeObserver(resize):null;if(sizes)sizes.observe(header);
  const modeObserver=typeof view.MutationObserver==='function'?new view.MutationObserver(syncMode):null;
  if(modeObserver)modeObserver.observe(dom.body,{attributes:true,attributeFilter:['data-practice-game']});
  const screenObserver=typeof view.MutationObserver==='function'?new view.MutationObserver(syncMode):null;
  if(screenObserver)screenObserver.observe(header,{attributes:true,attributeFilter:['data-screen']});
  const onHide=event=>{if(!event.persisted)dispose();};
  function dispose(){if(closed)return;closed=true;if(observer)observer.disconnect();if(modeObserver)modeObserver.disconnect();if(screenObserver)screenObserver.disconnect();if(sizes)sizes.disconnect();view.removeEventListener('resize',resize);view.removeEventListener('pagehide',onHide);for(const type of ['pointerdown','click','keydown','keyup'])header.removeEventListener(type,interact);}
  view.addEventListener('resize',resize);view.addEventListener('pagehide',onHide);refresh();syncMode();
  return {refresh,dispose};
}
