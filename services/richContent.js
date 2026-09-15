const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function safeUrl(value,image=false){
 if(/^\/(?!\/)[\w/.-]+(?:[?#][\w=&.-]*)?$/.test(value))return value;
 try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}catch{}
 return null;
}
function videoUrl(value){
 try{const url=new URL(value);let id;if(['www.youtube.com','youtube.com'].includes(url.hostname))id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})$/)?.[1];else if(url.hostname==='youtu.be')id=url.pathname.slice(1);if(/^[\w-]{11}$/.test(id||''))return `https://www.youtube-nocookie.com/embed/${id}`;}catch{}return null;
}
function inline(text){
 const pattern=/(!?)\[([^\]\n]*)\]\(([^\s)]+)\)/g;let result='',last=0;
 for(const match of text.matchAll(pattern)){result+=escape(text.slice(last,match.index));const url=safeUrl(match[3],Boolean(match[1]));result+=!url?escape(match[0]):match[1]?`<img src="${escape(url)}" alt="${escape(match[2])}" loading="lazy">`:`<a href="${escape(url)}"${url.startsWith('https:')?' target="_blank" rel="noopener noreferrer"':''}>${escape(match[2])}</a>`;last=match.index+match[0].length;}
 return result+escape(text.slice(last));
}
function renderRichContent(value){return String(value||'').split(/\r?\n\r?\n/).filter(Boolean).map(block=>{
 const video=videoUrl(block.trim());if(video)return `<iframe src="${video}" title="Video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
 const heading=block.match(/^(#{2,3}) ([^\n]+)$/);if(heading)return `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>`;
 return `<p>${inline(block).replace(/\r?\n/g,'<br>')}</p>`;
}).join('\n');}
module.exports={renderRichContent,safeUrl,videoUrl};
