// Shared by the historical editor and server validation.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.HistoricalPeriods=factory();
})(typeof window==='undefined'?globalThis:window,()=>{
  const outside=(row,round)=>Boolean(row.startedFromRound&&round<row.startedFromRound||row.retiredFromRound&&round>=row.retiredFromRound);
  const shaded=(row,round)=>Boolean(row.retiredFromRound&&round>=row.retiredFromRound&&(row.role==='reserve'||row.shadeRetired!==false));
  function apply(row,races){
    const cells={...row.cells};
    for(const race of races){
      if(outside(row,Number(race.sortOrder))){
        cells[race.id]={status:'DNA',position:null,points:null,teamId:cells[race.id]?.teamId||row.teamId||null,fastestLap:false,polePosition:false,driverOfTheDay:false,periodDna:true};
      }else if(cells[race.id]?.periodDna){
        // Widening the period makes the cell available again; do not invent results.
        delete cells[race.id];
      }
    }
    return cells;
  }
  return {outside,shaded,apply};
});
