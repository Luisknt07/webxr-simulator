import model from './model.cjs';

function node(tag,className,value){const result=document.createElement(tag);if(className)result.className=className;if(value!==undefined)result.textContent=value;return result;}
function button(label,action,className=''){const result=node('button',className,label);result.type='button';result.addEventListener('click',action);return result;}
const labelOf=row=>row&&String(row.title||row.name||row.label||row.id)||'';

/** Read-only documentation renderer. Providers own their content and images;
 * resource actions always return to the editor's existing permission boundary. */
export default class DocumentationBrowser {
 constructor(host,options={}){
  this.host=host;this.options=options;this.generation=0;this.history=[];this.future=[];this.disposed=false;this.query='';this.currentId='';this.books=new Map();
  this.root=node('section','st-docs');this.root.setAttribute('aria-label','Documentación de módulos');
  this.root.addEventListener('keydown',event=>{event.stopPropagation();if(event.code==='Escape'){this.root.classList.remove('st-docs-nav-open');if(this.menuButton)this.menuButton.setAttribute('aria-expanded','false');}});
  this.build();host.appendChild(this.root);this.refreshContext(options.initialTarget);
 }
 providers(){return (this.options.getProviders?this.options.getProviders():[]).filter(provider=>provider&&provider.id&&(!provider.available||provider.available()));}
 available(){return !this.disposed&&this.provider&&this.providers().some(row=>row.id===this.provider.id);}
 openResource(target){if(!this.available()||this.provider.id!==target.moduleId)return false;const resource=this.resources().find(row=>row.id===target.resourceId);if(!resource)return false;if(this.options.onResource)this.options.onResource(target);return true;}
 build(){
  const top=node('header','st-docs-top');this.menuButton=button('☰ Índice',()=>{const open=this.root.classList.toggle('st-docs-nav-open');this.menuButton.setAttribute('aria-expanded',String(open));},'st-docs-nav-toggle');this.menuButton.setAttribute('aria-expanded','false');top.appendChild(this.menuButton);
  const identity=node('div','st-docs-identity');identity.appendChild(node('strong','','Documentación'));this.moduleLabel=node('span');identity.appendChild(this.moduleLabel);top.appendChild(identity);
  this.moduleSelect=node('select','st-docs-module');this.moduleSelect.setAttribute('aria-label','Módulo de documentación');this.moduleSelect.addEventListener('change',()=>this.openProvider(this.moduleSelect.value));top.appendChild(this.moduleSelect);
  const search=node('label','st-docs-search');search.appendChild(node('span','st-docs-search-icon','⌕'));this.search=node('input');this.search.type='search';this.search.placeholder='Buscar equipos, operaciones o conceptos…';this.search.setAttribute('aria-label','Buscar en la documentación');this.search.addEventListener('input',()=>{this.query=this.search.value;this.renderNavigation();if(this.query.trim())this.renderResults();else if(this.currentId)this.showArticle(this.currentId,false);else this.renderHome();});search.appendChild(this.search);top.appendChild(search);this.root.appendChild(top);
  const body=node('div','st-docs-body');this.nav=node('nav','st-docs-nav');this.nav.setAttribute('aria-label','Índice de documentación');body.appendChild(this.nav);
  this.reading=node('div','st-docs-reading');this.reading.tabIndex=-1;body.appendChild(this.reading);this.toc=node('nav','st-docs-toc');this.toc.setAttribute('aria-label','En esta página');body.appendChild(this.toc);this.root.appendChild(body);
  this.status=node('p','st-docs-status');this.status.setAttribute('role','status');this.root.appendChild(this.status);
 }
 async refreshContext(target){
  if(this.disposed)return false;
  const providers=this.providers(),signature=providers.map(row=>row.id).join('|')+'@'+(this.options.getContextKey?this.options.getContextKey():'');
  if(signature===this.contextSignature&&!target)return true;
  this.contextSignature=signature;this.providerRows=providers;this.moduleSelect.textContent='';
  for(const provider of providers){const option=node('option','',provider.title||provider.id);option.value=provider.id;this.moduleSelect.appendChild(option);}
  this.moduleSelect.hidden=providers.length<2;
  if(!providers.length){this.generation++;this.book=null;this.provider=null;this.nav.textContent='';this.toc.textContent='';this.reading.textContent='';this.reading.appendChild(node('h1','','Documentación del proyecto'));this.reading.appendChild(node('p','','No hay documentación disponible para los módulos habilitados en esta vista.'));this.moduleLabel.textContent='';this.status.textContent='El contenido se ofrece por módulo.';return false;}
  const selected=providers.find(row=>target&&row.id===target.moduleId)||providers.find(row=>this.provider&&row.id===this.provider.id)||providers[0];
  return this.openProvider(selected.id,target&&target.articleId);
 }
 async openProvider(id,articleId){
  const provider=this.providers().find(row=>row.id===id);if(!provider||this.disposed)return false;
  const generation=++this.generation;this.provider=provider;this.moduleSelect.value=id;this.moduleLabel.textContent=provider.title||id;this.status.textContent='Cargando documentación…';
  try{
   let book=this.books.get(id);if(!book){book=model.normalizeBook(await provider.load());if(this.disposed||generation!==this.generation||!this.providers().some(row=>row.id===id))return false;this.books.set(id,book);}
   if(this.disposed||generation!==this.generation)return false;
   this.book=book;this.history=[];this.future=[];this.query='';this.search.value='';this.currentId='';this.renderNavigation();
   if(articleId&&book.byId.has(articleId))this.showArticle(articleId);else this.renderHome();
   this.status.textContent=book.articles.length+' artículos · '+(book.source.title||book.source.filename||'Documentación del módulo');return true;
  }catch(error){if(!this.disposed&&generation===this.generation){this.book=null;this.reading.textContent='';this.reading.appendChild(node('h1','','No se pudo cargar la documentación'));this.reading.appendChild(node('p','',error.message));this.reading.appendChild(button('Reintentar',()=>this.openProvider(id,articleId),'st-docs-primary'));this.status.textContent='La escena y tus archivos no se han modificado.';}return false;}
 }
 resources(){return this.options.getResources?this.options.getResources():[];}
 renderNavigation(){
  this.nav.textContent='';if(!this.book)return;
  this.nav.appendChild(button('⌂ Inicio del módulo',()=>this.renderHome(),'st-docs-home-link'));
  const matches=new Set(model.searchArticles(this.book,this.query).map(row=>row.id)),used=new Set();
  const append=(title,articles)=>{
   articles=articles.filter(row=>matches.has(row.id)&&!used.has(row.id));if(!articles.length)return;
   const group=node('details','st-docs-nav-group');group.open=!!this.query||articles.some(row=>row.id===this.currentId)||!this.currentId;
   const summary=node('summary','',title);summary.appendChild(node('span','st-docs-count',String(articles.length)));group.appendChild(summary);
   for(const article of articles){used.add(article.id);const link=button('',()=>this.showArticle(article.id),'st-docs-nav-article');link.dataset.articleId=article.id;link.appendChild(node('small','',article.kind==='equipment'?article.id:''));link.appendChild(node('span','',article.title));link.setAttribute('aria-current',this.currentId===article.id?'page':'false');group.appendChild(link);}this.nav.appendChild(group);
  };
  const guides=this.book.articles.filter(row=>!row.family||row.kind==='guide'||row.kind==='concept');
  for(const chapter of this.book.chapters)append(labelOf(chapter),guides.filter(row=>row.chapterId===chapter.id));
  append('Guías y fundamentos',guides);
  for(const family of this.book.families)append(labelOf(family),this.book.articles.filter(row=>row.family===family.id));
  append('Más contenidos',this.book.articles);
 }
 heading(title,breadcrumb){
  this.reading.textContent='';this.toc.textContent='';
  delete this.reading.dataset.articleId;
  const path=node('div','st-docs-breadcrumb');path.appendChild(button(this.provider.title||this.provider.id,()=>this.renderHome()));if(breadcrumb)path.appendChild(node('span','','› '+breadcrumb));this.reading.appendChild(path);
  this.reading.appendChild(node('h1','',title));this.reading.scrollTop=0;
 }
 renderHome(){
  if(!this.book||!this.available())return;this.currentId='';this.query='';this.search.value='';this.renderNavigation();this.heading('Biblioteca de conocimientos','Inicio');
  this.reading.appendChild(node('p','st-docs-lead','Consulta el funcionamiento de los equipos, sus componentes, las operaciones y los criterios para conectar una instalación. Cada ficha indica su relación con los recursos disponibles del editor.'));
  const numbers=node('div','st-docs-metrics');for(const [number,label]of [[this.book.articles.length,'artículos'],[this.book.families.length,'familias de equipos']]){const cell=node('span');cell.appendChild(node('strong','',String(number)));cell.appendChild(document.createTextNode(' '+label));numbers.appendChild(cell);}this.reading.appendChild(numbers);
  const guides=this.book.articles.filter(article=>article.kind==='guide'||article.kind==='concept'||!article.family);if(guides.length){this.reading.appendChild(node('h2','','Empieza aquí'));const list=node('div','st-docs-guide-list');for(const article of guides){const card=button('',()=>this.showArticle(article.id),'st-docs-guide');card.appendChild(node('strong','',article.title));if(article.summary)card.appendChild(node('span','',article.summary));list.appendChild(card);}this.reading.appendChild(list);}
  this.reading.appendChild(node('h2','','Explorar por familia'));const grid=node('div','st-docs-family-grid');for(const family of this.book.families){const rows=this.book.articles.filter(article=>article.family===family.id);if(!rows.length)continue;const card=button('',()=>{this.query='';this.search.value='';this.showArticle(rows[0].id);},'st-docs-family');card.appendChild(node('small','',family.id));card.appendChild(node('strong','',labelOf(family)));card.appendChild(node('span','',rows.length+' fichas'));grid.appendChild(card);}this.reading.appendChild(grid);
  const source=this.book.source;if(source.filename){this.reading.appendChild(node('h2','','Documento base'));this.reading.appendChild(node('p','',source.filename));this.reading.appendChild(node('p','st-docs-muted','Las ilustraciones y los contenidos conceptuales se conservan con sus identificadores de origen. La disponibilidad de un equipo se contrasta con la biblioteca del editor.'));}
 }
 renderResults(){
  if(!this.book||!this.available())return;const results=model.searchArticles(this.book,this.query);this.heading('Resultados de búsqueda',this.query);this.reading.appendChild(node('p','st-docs-muted',results.length+' artículos encontrados'));
  if(!results.length)this.reading.appendChild(node('p','','Prueba con otro nombre de equipo, identificador, operación o componente.'));
  for(const article of results.slice(0,100)){const hit=button('',()=>this.showArticle(article.id),'st-docs-search-result');hit.appendChild(node('small','',article.id));hit.appendChild(node('strong','',article.title));hit.appendChild(node('span','',article.summary||article.definition||''));this.reading.appendChild(hit);}if(results.length>100)this.reading.appendChild(node('p','','Se muestran los primeros 100 resultados. Afina la búsqueda para encontrar una ficha concreta.'));
 }
 rich(parent,value){
  const text=String(value||''),pattern=/\b(?:TR|VE|AL|UC|MU|PI|EM|RO|EO|MA|SE|SI)-\d{2}\b|https?:\/\/[^\s<>"']+/g;let offset=0,match;
  while((match=pattern.exec(text))){parent.appendChild(document.createTextNode(text.slice(offset,match.index)));const token=match[0];if(this.book.byId.has(token))parent.appendChild(button(token,()=>this.showArticle(token),'st-docs-inline-link'));else{const href=model.safeLink(token);if(href){const link=node('a','',token);link.href=href;link.target='_blank';link.rel='noopener noreferrer';parent.appendChild(link);}else parent.appendChild(document.createTextNode(token));}offset=pattern.lastIndex;}parent.appendChild(document.createTextNode(text.slice(offset)));
 }
 image(parent,image){
  const src=model.safeImage(image&&image.src);if(!src)return;
  const figure=node('figure','st-docs-figure'),img=node('img');img.src=new URL(src,document.baseURI).href;img.alt=image.alt||'Esquema funcional del equipo';img.loading='lazy';img.decoding='async';if(image.width>0)img.width=image.width;if(image.height>0)img.height=image.height;
  img.addEventListener('error',()=>{img.hidden=true;figure.appendChild(node('p','st-docs-muted','La ilustración no está disponible en esta distribución.'));},{once:true});figure.appendChild(img);if(image.caption)figure.appendChild(node('figcaption','',image.caption));parent.appendChild(figure);
 }
 block(parent,block){
  if(!block||typeof block!=='object')return;
  if(block.type==='table'){
   const wrap=node('div','st-docs-table-scroll'),table=node('table'),columns=block.columns||block.headers||[];
   if(columns.length){const head=node('thead'),row=node('tr');for(const value of columns){const cell=node('th');cell.scope='col';this.rich(cell,value);row.appendChild(cell);}head.appendChild(row);table.appendChild(head);}
   const body=node('tbody');for(const values of block.rows||[]){const row=node('tr');for(const value of values){const cell=node('td');this.rich(cell,typeof value==='object'?value.text:value);row.appendChild(cell);}body.appendChild(row);}table.appendChild(body);wrap.appendChild(table);parent.appendChild(wrap);
  }else if(block.type==='list'){
   const list=node(block.ordered?'ol':'ul');for(const item of block.items||[]){const row=node('li');this.rich(row,typeof item==='string'?item:item.text);list.appendChild(row);}parent.appendChild(list);
  }else if(block.type==='image')this.image(parent,block);
  else if(block.type==='code'){const pre=node('pre'),code=node('code','',block.text||'');pre.appendChild(code);parent.appendChild(pre);}
  else{const paragraph=node('p');this.rich(paragraph,block.text||block.caption||'');parent.appendChild(paragraph);}
 }
 showArticle(id,record=true){
  if(!this.book||!this.available()||!this.book.byId.has(id))return false;const article=this.book.byId.get(id);
  if(record&&this.currentId&&this.currentId!==id){this.history.push(this.currentId);this.future=[];}this.currentId=id;this.query='';this.search.value='';this.root.classList.remove('st-docs-nav-open');this.menuButton.setAttribute('aria-expanded','false');this.renderNavigation();
  const chapter=this.book.chapters.find(row=>row.id===article.chapterId),family=this.book.families.find(row=>row.id===article.family);this.heading(article.title,[labelOf(chapter),labelOf(family),article.id].filter(Boolean).join(' › '));this.reading.dataset.articleId=id;
  const status=model.articleStatus(article,this.resources()),meta=node('div','st-docs-article-meta');meta.appendChild(node('span','st-docs-badge st-docs-badge-'+status.key,status.label));if(article.family)meta.appendChild(node('span','st-docs-muted',article.id));this.reading.appendChild(meta);
  if(article.summary){const lead=node('p','st-docs-lead');this.rich(lead,article.summary);this.reading.appendChild(lead);}this.image(this.reading,article.illustration);
  this.toc.appendChild(node('strong','','En esta página'));
  article.sections.forEach((section,index)=>{const anchor='st-doc-section-'+index;const area=node('section','st-docs-section');area.id=anchor;if(section.title){const title=node('h2','',section.title);area.appendChild(title);const link=button(section.title,()=>{area.scrollIntoView({block:'start'});},'st-docs-toc-link');this.toc.appendChild(link);}for(const block of section.blocks)this.block(area,block);this.reading.appendChild(area);});
  const related=status.matches;if(related.length){this.reading.appendChild(node('h2','','Relación con la biblioteca'));const list=node('div','st-docs-related');for(const row of related){const target={resourceId:row.resource.id,articleId:id,moduleId:this.provider.id},generation=this.generation;const control=button('',()=>generation===this.generation&&this.openResource(target),'st-docs-resource');control.appendChild(node('strong','',row.resource.name));control.appendChild(node('small','',row.relation==='exact'?'Ver recurso en biblioteca':'Ver familia relacionada'));list.appendChild(control);}this.reading.appendChild(list);}else if(article.family)this.reading.appendChild(node('p','st-docs-pending-note','Esta ficha documenta el concepto. El modelo específico queda pendiente de incorporar a la biblioteca.'));
  const articleIndex=this.book.articles.indexOf(article),footer=node('footer','st-docs-article-footer');if(this.history.length)footer.appendChild(button('← Volver a la ficha anterior',()=>{const previous=this.history.pop();this.future.push(id);this.showArticle(previous,false);}));if(this.book.articles[articleIndex+1])footer.appendChild(button('Siguiente: '+this.book.articles[articleIndex+1].title+' →',()=>this.showArticle(this.book.articles[articleIndex+1].id)));this.reading.appendChild(footer);
  if(this.options.onArticle)this.options.onArticle({articleId:id,moduleId:this.provider.id});return true;
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.generation++;this.books.clear();this.root.remove();}
}
