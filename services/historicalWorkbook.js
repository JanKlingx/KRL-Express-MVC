const ExcelJS = require('exceljs');
const { HEADERS } = require('./historicalSeasonImport');
const { createCsv } = require('./csv');
const COLUMNS = ['Runde','Datum','Strecke','Fahrer','Team','Rolle','Session','Platz','Punkte','Status','FL','Pole','DotD'];
const choice = row => `${row.id} · ${row.country ? row.country + ' / ' : ''}${row.name}`;
function exampleRows(masters, labels = true) {
  const [a,b] = masters.drivers, team=masters.teams[0], track=masters.tracks[0];
  if (!a || !b || !team || !track) return [];
  const ref = row => labels ? choice(row) : row.id;
  return [
    [1,'2020-03-01',ref(track),ref(a),ref(team),'stamm','gp',1,26,'',1,1,0],
    [1,'2020-03-01',ref(track),ref(b),ref(team),'ersatz','gp','',0,'DNF',0,0,0],
    [2,'2020-03-08',ref(track),ref(b),ref(team),'stamm','gp',1,25,'',0,1,1],
    [2,'2020-03-08',ref(track),ref(b),ref(team),'stamm','sprint','',0,'DNF',0,0,0]
  ];
}
function styleSheet(sheet,widths) {
  sheet.views=[{state:'frozen',ySplit:1}];
  widths.forEach((width,i)=>sheet.getColumn(i+1).width=width);
  sheet.getRow(1).height=30;
  sheet.getRow(1).eachCell(cell=>{cell.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF183E49'}};cell.alignment={vertical:'middle',wrapText:true};});
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(2,sheet.rowCount),column:widths.length}};
}
async function buildTemplate(masters) {
  const book=new ExcelJS.Workbook();book.creator='Katzes Racing League';book.created=new Date();
  const guide=book.addWorksheet('Start');
  const instructions=[['Historische F1-Saison','Excel-Vorlage'],['1. Stammdaten prüfen','Fahrer, Teams und Strecken stammen aus dem aktuellen Stand beim Download. Nach neuen Stammdaten eine neue Vorlage herunterladen.'],['2. Beispiele ansehen','Das Blatt Beispiel zeigt zwei Rennen: Fahrer B übernimmt ab R2 das Cockpit von Fahrer A. Im Sprint ist B DNF, im GP gewertet.'],['3. Ergebnisse ausfüllen','Nur das Blatt Ergebnisse wird importiert. Pro Fahrer und Session eine Zeile. Namen in den Dropdowns auswählen. Platz, Punkte und Datum selbst ausfüllen.'],['4. Datei hochladen','Als .xlsx speichern und auf der Importseite auswählen. Vorschau erstellen, Zuordnungen prüfen und erst dann importieren.'],['Runden und Einsätze','Bei 1 beginnen, keine Runde überspringen. Stammfahrer pro Runde aufführen, solange sie das Cockpit besitzen. Vor Eintritt und nach Abgabe keine Stamm-Zeile erfassen.'],['Abwesenheit','Stammfahrer mit bestehendem Cockpit: DNS bei Nichtstart, S bei Rennsperre. DNA ist für Ersatzfahrer ohne Wertung. Platz leer und Punkte 0.'],['Sprintwochenende','Für jeden Fahrer eine gp- und eine sprint-Zeile. Team und Rolle gleich, Ergebnisstatus darf abweichen. S gilt für das gesamte Wochenende.'],['Punkte und Auszeichnungen','Punkte einschließlich aller Boni eintragen. FL, Pole und DotD: 1 = ja, 0 = nein. Nur im GP, nicht im Sprint. Diese Felder addieren keine weiteren Punkte.'],['Status','Leer = gewertet. DNF = ausgefallen, DSQ = disqualifiziert, DNS = nicht gestartet, DNA = nicht in der Wertung, S = Rennsperre.'],['Datum','Ein echtes Excel-Datum oder JJJJ-MM-TT. Innerhalb einer Runde dasselbe Datum und dieselbe Strecke.'],['Stammdaten-IDs','Dropdowns enthalten ID und Namen. Die ID ordnet den Datensatz eindeutig zu. Referenzblätter werden nicht importiert.'],['Vorbereitung','5000 Ergebniszeilen sind vorbereitet. Das Blatt Beispiel enthält Demonstrationswerte und wird niemals importiert. Testtage später im Kalender ergänzen.']];
  guide.addRows(instructions);styleSheet(guide,[30,115]);guide.autoFilter=undefined;
  guide.eachRow((row,i)=>{if(i>1){row.height=46;row.eachCell(cell=>{cell.alignment={vertical:'middle',wrapText:true};cell.font={name:'Calibri',size:11};});}});
  const results=book.addWorksheet('Ergebnisse');results.addRow(COLUMNS);styleSheet(results,[10,16,40,30,30,14,12,10,12,12,8,8,8]);
  const examples=book.addWorksheet('Beispiel');examples.addRow(COLUMNS);examples.addRows(exampleRows(masters).map(row=>row.map((value,index)=>index===1?new Date(`${value}T00:00:00Z`):value)));examples.getColumn(2).numFmt='yyyy-mm-dd';styleSheet(examples,[10,16,40,30,30,14,12,10,12,12,8,8,8]);
  if (!exampleRows(masters).length) {guide.addRow(['Beispieldaten fehlen','Für ein Beispiel werden mindestens zwei F1-Fahrer, ein Team und eine Strecke benötigt.']);}
  const lists=[['Fahrer','drivers','FahrerAuswahl'],['Teams','teams','TeamAuswahl'],['Strecken','tracks','StreckenAuswahl']];
  for (const [title,key,name] of lists) {
    const sheet=book.addWorksheet(title);sheet.addRow(['Auswahl','ID','Name']);
    masters[key].forEach(row=>sheet.addRow([choice(row),row.id,row.name]));
    styleSheet(sheet,[55,12,40]);book.definedNames.add(`${title}!$A$2:$A$${Math.max(2,sheet.rowCount)}`,name);
  }
  for(let row=2;row<=5001;row++) {
    for(let col=1;col<=13;col++) {const cell=results.getCell(row,col);cell.font={name:'Calibri',size:11,color:{argb:'FF123C6A'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:row%2?'FFF5F9FA':'FFEAF3F5'}};cell.alignment={vertical:'middle'};}
    results.getCell(row,2).numFmt='yyyy-mm-dd';results.getCell(row,9).numFmt='0.0';
    for(const [col,formula] of [[3,'StreckenAuswahl'],[4,'FahrerAuswahl'],[5,'TeamAuswahl'],[6,'"stamm,ersatz"'],[7,'"gp,sprint"'],[10,'"DNF,DSQ,DNS,DNA,S"'],[11,'"0,1"'],[12,'"0,1"'],[13,'"0,1"']]) results.getCell(row,col).dataValidation={type:'list',allowBlank:true,formulae:[formula],showErrorMessage:true,errorStyle:'stop',errorTitle:'Auswahl prüfen',error:'Bitte einen Eintrag aus dem Dropdown auswählen.'};
  }
  return book.xlsx.writeBuffer();
}
function checkWorkbookSize(buffer) {
  if(buffer.length>2*1024*1024)throw new Error('Die Excel-Datei darf höchstens 2 MB groß sein.');
  const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(end<0 || end+22>buffer.length)throw new Error('Die Datei ist keine gültige XLSX-Datei.');
  const count=buffer.readUInt16LE(end+10);let offset=buffer.readUInt32LE(end+16),size=0;
  if(count>200)throw new Error('Die Excel-Datei enthält zu viele Bestandteile. Bitte die Vorlage verwenden.');
  for(let index=0;index<count;index++) {
    if(offset+46>buffer.length || buffer.readUInt32LE(offset)!==0x02014b50)throw new Error('Die Excel-Datei ist beschädigt.');
    size+=buffer.readUInt32LE(offset+24);
    if(size>32*1024*1024)throw new Error('Die entpackte Excel-Datei ist zu groß. Bitte nur die Vorlage mit Ergebnissen hochladen.');
    offset+=46+buffer.readUInt16LE(offset+28)+buffer.readUInt16LE(offset+30)+buffer.readUInt16LE(offset+32);
  }
}
async function workbookToCsv(buffer) {
  checkWorkbookSize(buffer);
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  const sheet=book.getWorksheet('Ergebnisse');if(!sheet)throw new Error('Das Tabellenblatt Ergebnisse fehlt. Bitte unsere Excel-Vorlage verwenden.');
  if(COLUMNS.some((name,i)=>sheet.getCell(1,i+1).text.trim()!==name))throw new Error('Die Spalten im Blatt Ergebnisse wurden verändert. Bitte die Vorlagenüberschriften beibehalten.');
  if(sheet.rowCount>5001)throw new Error('Maximal 5000 Ergebniszeilen sind erlaubt.');
  const rows=[];
  sheet.eachRow((row,index)=>{
    if(index===1)return;
    const values=COLUMNS.map((_,i)=>{
      const cell=row.getCell(i+1);const value=cell.value;
      if(value && typeof value==='object' && !(value instanceof Date))throw new Error(`Excel-Zeile ${index}: Bitte Werte statt Formeln oder Verknüpfungen eintragen.`);
      if(value instanceof Date)return value.toISOString().slice(0,10);
      return value==null?'':String(value).trim();
    });
    if(!values.some(Boolean))return;
    for(const i of [2,3,4]) {const match=values[i].match(/^(\d+)(?:\s*·.*)?$/);if(!match)throw new Error(`Excel-Zeile ${index}: Bitte Strecke, Fahrer und Team aus den Dropdowns auswählen.`);values[i]=match[1];}
    rows.push(values);
  });
  if(!rows.length)throw new Error('Das Blatt Ergebnisse ist leer. Das Blatt Beispiel wird nicht importiert.');
  return createCsv([HEADERS,...rows]);
}
module.exports={buildTemplate,workbookToCsv,exampleRows,COLUMNS};
