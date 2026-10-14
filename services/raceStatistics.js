const selections={driverOfTheDay:e=>e.driverOfTheDay,first:e=>Number(e.position)===1,second:e=>Number(e.position)===2,third:e=>Number(e.position)===3,pole:e=>e.polePosition,fastestLap:e=>e.fastestLap};
function awardColumns(entries){
 const values={};for(const [field,predicate]of Object.entries(selections)){const entry=entries.find(predicate);values[field]=entry?.driverName||null;values[field+'Team']=entry&&!entry.isReserve?entry.teamName||'':'';}
 return values;
}
module.exports={awardColumns};
