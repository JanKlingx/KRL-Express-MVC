(() => {
 const form=document.querySelector('[data-lmu-results]');if(!form)return;
 const points=JSON.parse(form.querySelector('[data-lmu-points]').textContent);
 function update(){form.querySelectorAll('[data-lmu-result-row]').forEach(row=>{
  const status=row.querySelector('[data-result-status]'),position=row.querySelector('[data-result-position]');if(!status)return;
  position.hidden=Boolean(status.value);position.required=!status.value;if(status.value)position.value='';
  row.querySelectorAll('[data-award]').forEach(input=>{input.disabled=status.value==='DSQ';if(input.disabled)input.checked=false;});
  let total=status.value?0:Number(points.allocations.find(a=>a.raceType==='main'&&Number(a.position)===Number(position.value))?.points||0);
  if(!status.value)for(const key of ['fastestLap','polePosition'])if(points[key+'Enabled']&&row.querySelector(`[data-award="${key}"]`).checked)total+=Number(points[key+'Points']||0);
  row.querySelector('[data-result-points]').textContent=String(total);
 });}
 form.addEventListener('change',event=>{if(event.target.dataset.award&&event.target.checked)form.querySelectorAll(`[data-award="${event.target.dataset.award}"]`).forEach(input=>{if(input!==event.target)input.checked=false;});update();});form.addEventListener('input',update);update();
})();
