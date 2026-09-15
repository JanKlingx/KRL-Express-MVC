(() => {
 document.querySelectorAll('[data-news-toggle]').forEach(button=>{const body=document.getElementById(button.dataset.newsToggle);if(!body)return;button.hidden=false;body.classList.add('is-collapsed');button.setAttribute('aria-controls',body.id);button.addEventListener('click',()=>{const collapsed=body.classList.toggle('is-collapsed');button.textContent=collapsed?'Alles lesen':'Weniger anzeigen';button.setAttribute('aria-expanded',String(!collapsed));});});
 document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
  const text=button.dataset.copy;
  try{await navigator.clipboard.writeText(text);const prior=button.innerHTML;button.textContent='Kopiert ✓';setTimeout(()=>button.innerHTML=prior,1600);}
  catch{const field=document.createElement('input');field.value=text;field.readOnly=true;button.after(field);field.focus();field.select();field.setAttribute('aria-label','Zum Kopieren markieren');}
 }));
 document.querySelector('[data-load-tiktok]')?.addEventListener('click',event=>{
  const host=event.currentTarget.parentElement;const quote=document.createElement('blockquote');quote.className='tiktok-embed';quote.cite='https://www.tiktok.com/@katzesracingleaguef1liga';quote.dataset.uniqueId='katzesracingleaguef1liga';quote.dataset.embedType='creator';
  const section=document.createElement('section');const link=document.createElement('a');link.href=quote.cite;link.textContent='@katzesracingleaguef1liga';section.append(link);quote.append(section);host.replaceChildren(quote);
  const script=document.createElement('script');script.src='https://www.tiktok.com/embed.js';script.async=true;script.onerror=()=>host.append(document.createTextNode('Der Feed konnte nicht geladen werden. Nutze den Profil-Link.'));document.body.append(script);
 });
 document.querySelectorAll('[data-load-frame]').forEach(button=>button.addEventListener('click',()=>{const frame=document.createElement('iframe');frame.src=button.dataset.loadFrame;frame.title=button.dataset.frameTitle;frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allowFullscreen=true;button.replaceWith(frame);}));
})();
