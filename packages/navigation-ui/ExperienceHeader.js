// Shared controls with two presentations: floating game HUD and tour toolbar.
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
  assistant:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'
};
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
    const svg=dom.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('st-header-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const path=dom.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',ICONS[action]);svg.appendChild(path);control.insertBefore(svg,control.firstChild);
  }
  const refresh=()=>{
    if(closed)return;
    for(const [action,value]of Object.entries(controls)){const control=typeof value==='string'?actions.querySelector(value):value;decorate(control,action);}
    for(const [selector,action]of [['[data-voice-assistant-toggle]','voice'],['[data-voice-microphone]','microphone'],['[data-assistant-workspace-toggle]','assistant']])decorate(actions.querySelector(selector),action);
  };
  const resize=()=>{const rect=header.getBoundingClientRect();if(rect.height>0)dom.body.style.setProperty('--st-header-height',Math.ceil(rect.bottom)+'px');};
  const syncMode=()=>{if(closed)return;const next=dom.body.getAttribute('data-practice-game')==='true'?'game':'tour';if(header.dataset.stExperience===next)return;header.dataset.stExperience=next;resize();};
  const interact=event=>{event.stopPropagation();if(onInteract&&['pointerdown','keydown'].includes(event.type))onInteract();};
  for(const type of ['pointerdown','click','keydown','keyup'])header.addEventListener(type,interact);
  const observer=typeof view.MutationObserver==='function'?new view.MutationObserver(refresh):null;
  if(observer)observer.observe(actions,{childList:true,subtree:true});
  const sizes=typeof view.ResizeObserver==='function'?new view.ResizeObserver(resize):null;if(sizes)sizes.observe(header);
  const modeObserver=typeof view.MutationObserver==='function'?new view.MutationObserver(syncMode):null;
  if(modeObserver)modeObserver.observe(dom.body,{attributes:true,attributeFilter:['data-practice-game']});
  const onHide=event=>{if(!event.persisted)dispose();};
  function dispose(){if(closed)return;closed=true;if(observer)observer.disconnect();if(modeObserver)modeObserver.disconnect();if(sizes)sizes.disconnect();view.removeEventListener('resize',resize);view.removeEventListener('pagehide',onHide);for(const type of ['pointerdown','click','keydown','keyup'])header.removeEventListener(type,interact);}
  view.addEventListener('resize',resize);view.addEventListener('pagehide',onHide);refresh();syncMode();
  return {refresh,dispose};
}
