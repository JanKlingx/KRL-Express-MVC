const test=require('node:test');const assert=require('node:assert/strict');const {buildSeasonData}=require('../services/standings');
function fixture(){
 const team={id:10,name:'Mercedes',sourceType:'current',sourceId:100};const driver={id:7,name:'Reserve',team};
 const entry=points=>({DriverId:7,TeamId:100,teamName:'Mercedes',driverName:'Reserve',points,position:2});
 const races=[{id:3,SeasonId:1,LeagueId:1,sortOrder:3,raceType:'main',entries:[entry(18)]},{id:30,SeasonId:1,LeagueId:1,sortOrder:3,raceType:'sprint',entries:[entry(7)]},{id:4,SeasonId:1,LeagueId:1,sortOrder:4,raceType:'main',entries:[entry(12)]}];
 const carry={GrandPrixResultId:3,DriverId:7,SeasonTeamId:10,selected:true};
 const stints=[{id:1,DriverId:7,roleType:'reserve',fromRound:3,toRound:3,driver},{id:2,DriverId:7,SeasonTeamId:10,roleType:'regular',fromRound:4,toRound:null,driver,seasonTeam:team,carryOvers:[carry]}];
 const lineup=[{GrandPrixResultId:3,DriverId:7,roleType:'reserve',includeInResults:true,ReplacementForDriverId:9,driver}];
 return {races,carry,team,calc:(enabled=false)=>buildSeasonData({id:1,slug:'freitag'},races,[driver],lineup,{reservePointsForConstructors:enabled},stints)};
}
test('Approved GP and sprint points count in constructors even with reserve scoring disabled',()=>{
 const {calc}=fixture();const data=calc();assert.equal(data.teamStandings[0].points,37);assert.equal(data.driverStandings[0].points,37);assert.equal(data.standingsHistory[0].teamStandings[0].points,25);assert.equal(data.standingsHistory[1].teamStandings[0].points,37);
});
test('Already counted reserve points are not duplicated and deselected races remain excluded',()=>{
 const {calc,carry}=fixture();assert.equal(calc(true).teamStandings[0].points,37);carry.selected=false;assert.equal(calc().teamStandings[0].points,12);assert.equal(calc(true).teamStandings[0].points,37);
});
test('Wrong team results cannot be credited and edits recalculate all snapshots',()=>{
 const {calc,races}=fixture();races[0].entries[0].points=20;assert.equal(calc().teamStandings[0].points,39);assert.equal(calc().standingsHistory[0].teamStandings[0].points,27);
 races[0].entries[0].TeamId=200;assert.equal(calc().teamStandings[0].points,12);
});
