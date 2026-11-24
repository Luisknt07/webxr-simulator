import {createExperienceIcon} from './ExperienceHeader.js';

// Presentation only. Every action remains owned by its scene/account module.
export function decorateMenuAction(control, icon, label) {
  const dom=control.ownerDocument;
  control.classList.add('st-menu-action');
  const copy=dom.createElement('span');copy.className='st-menu-label';copy.textContent=label===undefined?control.textContent:label;
  const arrow=dom.createElement('span');arrow.className='st-menu-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');
  control.replaceChildren(createExperienceIcon(dom,icon),copy,arrow);return control;
}
export function setMenuActionLabel(control,label) {
  const copy=control.querySelector('.st-menu-label')||control;if(copy.textContent!==label)copy.textContent=label;
}
export function menuSection(parent,label) {
  const section=parent.ownerDocument.createElement('section');section.className='st-menu-section';section.setAttribute('aria-label',label);
  const title=parent.ownerDocument.createElement('h3');title.className='st-menu-section-title';title.textContent=label;section.appendChild(title);parent.appendChild(section);return section;
}
export function menuAction(parent,{label,icon,action,id,pressed}={}) {
  const control=parent.ownerDocument.createElement('button');control.type='button';if(id)control.dataset.experienceAction=id;
  decorateMenuAction(control,icon,label);if(pressed!==undefined)control.setAttribute('aria-pressed',String(pressed));control.addEventListener('click',action);parent.appendChild(control);return control;
}
export function mountTourShortcuts({document:dom,actions,onInteract}={}) {
  const root=dom.createElement('nav');root.className='st-tour-shortcuts';root.setAttribute('aria-label','Herramientas del recorrido');
  const listeners=[];
  for(const type of ['pointerdown','pointerup','click','keydown','keyup']){const handler=event=>{event.stopPropagation();if(onInteract&&['pointerdown','keydown'].includes(type))onInteract();};root.addEventListener(type,handler);listeners.push(()=>root.removeEventListener(type,handler));}
  for(const {id,label,icon,action} of actions){const control=dom.createElement('button');control.type='button';control.dataset.tourTool=id;control.setAttribute('aria-label',label);control.title=label;control.appendChild(createExperienceIcon(dom,icon));const text=dom.createElement('span');text.textContent=label;control.appendChild(text);control.addEventListener('click',action);root.appendChild(control);}
  dom.body.appendChild(root);return{root,dispose(){listeners.forEach(off=>off());root.remove();}};
}
