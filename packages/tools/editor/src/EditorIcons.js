// A small, local SVG vocabulary keeps editor controls independent of fonts,
// icon CDNs and platform-specific emoji. Masks inherit the control's colour.
const PATHS = {
  new:'M12 5v14M5 12h14', save:'M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8',
  book:'M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15',
  guide:'M4 5h7l2 2h7v14H4V5ZM7 2v6M8 11h8M8 15h6',
  practice:'m2 8 10-5 10 5-10 5L2 8Zm4 3v6c4 3 8 3 12 0v-6M22 8v8',
  play:'m8 4 13 8-13 8V4Z', pause:'M8 4v16M16 4v16', stop:'M5 5h14v14H5z',
  account:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 6 0 0 1 16 0v2H4Z',
  mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  voice:'M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4',
  assistant:'m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z',
  select:'m5 3 15 10-7 1-4 7L5 3Z', move:'M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4',
  rotate:'M3 10a9 9 0 1 1 2 8M3 3v7h7', scale:'M9 3H3v6M15 21h6v-6M3 3l7 7M21 21l-7-7',
  grid:'M3 3h18v18H3V3ZM3 9h18M3 15h18M9 3v18M15 3v18',
  magnet:'M4 3v10a8 8 0 0 0 16 0V3h-5v10a3 3 0 0 1-6 0V3H4ZM4 8h5M15 8h5',
  undo:'M3 9h10a6 6 0 0 1 0 12M3 9l6-6M3 9l6 6', redo:'M21 9H11a6 6 0 0 0 0 12M21 9l-6-6M21 9l-6 6',
  folder:'M3 6h7l2 3h10v12H2V6h1ZM2 6V3h8l2 3', search:'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 6 6',
  chevron:'m9 5 7 7-7 7', close:'m6 6 12 12M6 18 18 6',
  library:'m3 5 5-2 5 2v15l-5-2-5 2V5Zm5-2v15M16 4l5-1v16l-5 1V4Z',
  project:'M3 7h18v14H3V7ZM8 7V3h8v4M3 12h18M10 12v3h4v-3',
  favorite:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',
  filter:'M3 5h18M6 12h12M9 19h6', rows:'M3 5h3M10 5h11M3 12h3M10 12h11M3 19h3M10 19h11',
  expand:'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6', collapse:'M3 9h6V3M15 3v6h6M21 15h-6v6M9 21v-6H3',
  cube:'m12 2 10 5v10l-10 5L2 17V7l10-5Zm0 10v10M2 7l10 5 10-5',
  conveyor:'M3 6h18v8H3V6ZM3 18h18M6 14v7M18 14v7M7 6v8M12 6v8M17 6v8',
  vehicle:'M4 4h8v11H3V8h1M7 4v11M12 15h9v-4h-4M17 3v15M17 18h5M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  robot:'M3 21h10M5 21v-4l4-4M9 13l-4-5 3-4 7 3M15 7l5 4-3 4M17 15l-3 2m3-2 3 1M8 4a2 2 0 1 0 0 .1M15 7a2 2 0 1 0 0 .1',
  rack:'M3 2v20M21 2v20M3 7h18M3 14h18M3 21h18M7 3h5v4H7V3ZM13 10h5v4h-5v-4M6 17h8v4H6v-4',
  machine:'M8 3h8l1 4 4 1v8l-4 1-1 4H8l-1-4-4-1V8l4-1 1-4ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  product:'m12 2 10 5v10l-10 5L2 17V7l10-5Zm0 10v10M2 7l10 5 10-5M7 4l10 5',
  chip:'M6 6h12v12H6V6ZM9 1v5M15 1v5M9 18v5M15 18v5M1 9h5M1 15h5M18 9h5M18 15h5M10 10h4v4h-4z',
  safety:'m12 2 9 4v6c0 5-4 8-9 10-5-2-9-5-9-10V6l9-4ZM8 12l3 3 5-6',
  environment:'m3 10 9-8 9 8v12H3V10ZM8 22v-8h8v8',
  person:'M12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 10h16M12 7v8M12 15l-5 8M12 15l5 8',
  info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 10v7M12 6v.1',
  sound:'M3 9h4l5-5v16l-5-5H3V9ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
  menu:'M4 6h16M4 12h16M4 18h16',
  vr:'M3 6h18l1 10-5 2-3-4h-4l-3 4-5-2L3 6ZM7 10h.01M17 10h.01'
};
export function iconData(name) {
  const d=PATHS[name]||PATHS.cube;
  return 'url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+d+'"/></svg>')+'")';
}
export function setEditorIcon(element,name,label,compact=false) {
  if(!element)return element;
  if(label!==undefined)element.textContent=label;
  element.setAttribute('data-ed-icon',name);element.classList.add('ed-iconized');
  if(element.style&&element.style.setProperty)element.style.setProperty('--ed-command-icon',iconData(name));
  else if(element.style)element.style['--ed-command-icon']=iconData(name);
  if(compact){element.classList.add('ed-icon-only');element.setAttribute('aria-label',label||element.title||element.textContent);}
  return element;
}
