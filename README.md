# Katzes Racing League – Express MVC

Vollständige, responsive KRL-Webanwendung mit Node.js, Express, EJS, Sequelize/MariaDB, geschütztem Adminbereich und datengetriebenen Rennwertungen.

## Schnellstart

Voraussetzung: Node.js 20 oder neuer.

1. ZIP entpacken und im Projektordner ein Terminal öffnen.
2. `npm install` ausführen.
3. `.env.example` als `.env` kopieren und MariaDB-Verbindung, `SESSION_SECRET`, `ADMIN_EMAIL` und `ADMIN_PASSWORD` anpassen.
5. `npm run setup` ausführen.
6. `npm run dev` ausführen.
7. `http://localhost:3000` öffnen.

Der gemeinsame Login für KRL- und WDL-Verwaltung befindet sich unter `http://localhost:3000/admin/login`. Es gibt bewusst keine öffentliche Registrierung und keinen zweiten WDL-Account. Ein erneuter Aufruf von `npm run setup` aktualisiert das Passwort des in `.env` eingetragenen Admins, ohne vorhandene Tabelleninhalte zu löschen.

## Öffentliche Routen

- `/` – Startseite mit Ligen, Statistiken und Team
- `/f1/freitag` – Stammfahrer, automatisch berechnete Fahrer-/Team-WM, GP-Ergebnisse und Saisonverlauf
- `/f1/sonntag` – getrennte Daten für die Sonntagsliga
- `/lmu` – LMU-Cockpits, Rennkalender, automatische WM und GP-Results
- `/wettkampf-der-ligen` – teilnehmende Ligen, Rennkalender, Standings, Diagramm und Results
- `/endurance` – vorbereitete Endurance-Seite

## Adminbereich

Im Dashboard lassen sich folgende Inhalte anlegen, bearbeiten und löschen:

- zentrale Fahrer-Stammdaten mit kombinierbaren F1-/LMU-Rollen, ehemaligen Fahrer-Rängen, Aliasen und Plattform
- rangabhängige Fahrerstatistiken mit Punkten, gefahrenen Rennen, Siegen, Siegesquote sowie P1/P2/P3; Fahrerbilder, Startnummer und manuelle Reihenfolge entfallen
- Länderstamm mit Kontinentfilter und verpflichtendem Flaggen-Upload sowie verknüpfte F1-Strecken; Land und Flagge werden im Saisonkalender automatisch übernommen
- versionierte Punktesysteme für F1-Hauptrennen, F1-Sprints, LMU und WDL mit Schnellste-Runde-Bonus und Gültigkeitszeitraum
- achtstufiger F1-Saisonassistent für Liga, Saisonfarbe, Kalender, Punktesystem, Fahrer, aktuelle/historische Teams, Line-up und Abschluss
- Saison- und Kalenderbearbeitung mit Drag-and-Drop-Reihenfolge, Testtag, Sprint und sichtbarer Terminänderung im Frontend
- öffentliches Formel-1-Regelwerk mit Strafenkatalog sowie Race-Director Notes als PDF-Vorschau und Download-Archiv
- dreistufiges F1-Rennwochenende mit Aufstellung, Anwesenheitskontrolle und tabellarischer Ergebniseingabe
- F1-Strafkartei für Freitag, Samstag und Sonntag mit ligaabhängigem SP-Limit, einjährigem Verfall und rennbezogener Sperre
- aktive und historische Saisons direkt im jeweiligen F1-, LMU- oder WDL-Saisonverlauf
- Startseitenstatistiken, interne KRL-Teams mit Fahrer-Rollen und KRL Icons
- getrennte zentrale Formel-1-Teams (Name und Upload-Logo) und LMU-Teams (Name); Gesamtpunkte werden automatisch aus den Saisonverläufen addiert
- eigene F1-Aufstellungen je Liga mit mindestens zwei und beliebig vielen Fahrern sowie LMU-Cockpits mit mindestens drei und beliebig vielen Fahrern
- F1-Fahrerrollen `Stamm Freitag`, `Stamm Sonntag`, `Ersatz Freitag` und `Ersatz Sonntag` sowie `LMU Stammfahrer` und `LMU Ersatzfahrer`
- farbige Fahrereinteilung pro aktuellem F1-Rennen mit Anwesenheitsstatus, Teamanzeige und direkter Ersatzfahrer-Zuordnung
- stabile Fahrer-IDs mit Plattform und beliebig vielen Aliasen direkt im Fahrerformular; Team und Gamertag werden dort nicht gepflegt
- Google-Sheets-ähnliche, rennzentrierte Gesamteingabe für F1, LMU und WDL
- automatisch erzeugte Fahrer-/Team-WM, Liga-Standings, GP-Results, WDL-Diagramm und CSV-/PNG-Exporte
- grafische F1-, LMU- und WDL-Kalenderkarten; F1 enthält Datum und Startzeit getrennt für Freitag/Sonntag sowie ein sichtbares Sprint-Badge
- aktive WDL-Ligen mit Logo, Link und zugeordnetem F1-Team; in historischen Saisons bleiben auch inaktive Ligen auswählbar

Alle Bilder werden ausschließlich als PNG, JPG oder WebP vom eigenen Gerät hochgeladen. Externe Bild-URLs und automatische Bildimporte sind nicht vorgesehen.

## GP-Ergebnisse und Saisonverlauf

Der Saisonverlauf befindet sich direkt in der passenden Dashboard-Kategorie Formel 1, LMU oder WDL. Dort werden Saison und Strecke angelegt oder Rennen aus dem jeweiligen Rennkalender importiert. Eine F1-Strecke kann als Sprint-Event aktiviert werden; die Sprintpflege erscheint dann als zusätzliche Spaltengruppe direkt neben dem Hauptrennen. Die frühere globale Admin-Kategorie `Saisonverwaltung` mit getrennten Saison-Kategorien und historischen Rennen ist nicht mehr sichtbar. Die Ergebniszeilen sind die einzige Wertungsquelle: Die öffentliche Seite erzeugt daraus GP-Results, Fahrer-WM, Team-WM, Punkteverlauf und Saisonmatrix. In jeder Rennspalte werden P1, P2 und P3 in Gold, Silber und Bronze hervorgehoben.

Für die schnelle Eingabe stehen `/admin/current-season-progress`, `/admin/race-editor`, `/admin/season-progress/lmu` und `/admin/season-progress/wdl` bereit. Die F1-Pflege beginnt mit dem achtstufigen Saisonassistenten und dem dazugehörigen Kalender. Unter `/admin/f1-race-lineup` werden für das aktuelle Rennen Stammfahrer als Rennsperre, abgemeldet, unsicher oder anwesend markiert. Ersatzfahrer werden passend zur Freitag-/Samstag-/Sonntag-Rolle geladen und als angefragt, abgemeldet, unsicher, anwesend oder auf Abruf geführt. Die anschließende Anwesenheitskontrolle unterscheidet anwesend, unabgemeldet, zu spät abgemeldet und zu spät zur Vorbesprechung; nur freigegebene Personen gelangen in die Ergebnistabelle. Wird ein Ersatzfahrer einem Stammfahrer zugeordnet, übernimmt er automatisch dessen Teamplatz im aktuellen Saisonverlauf. Historische Saisons bleiben davon unberührt und erlauben weiterhin die freie Fahrersuche bis 20 Personen. Rennergebnisse referenzieren die stabile Fahrer-ID, sodass Namenswechsel über Aliase hinweg korrekt zusammengezählt werden. Nur aktive F1-Hauptrennen und LMU-Ergebnisse erhöhen die Rennzähler.

Pro Rennen kann zwischen `Plätze → Punkte aus Datenbank` und `Punkte direkt eingeben` gewechselt werden. Der direkte Modus ist für historische Wertungen mit abweichenden Punktesystemen gedacht und wird bei Änderungen an der zentralen Punktetabelle nicht überschrieben. Im automatischen Modus werden Punkte über `Punktesysteme` und `Punkte je Platz` berechnet. Jedes System gehört zu F1, LMU oder WDL, kann zeitlich begrenzt werden und optional Punkte für die schnellste Runde vergeben. Formel 1 besitzt getrennte Platzierungswerte für Haupt- und Sprintrennen.

Formel-1- und LMU-Teams werden als getrennte zentrale Stammdaten gepflegt. Ein Formel-1-Team wie Mercedes kann anschließend in den Fahrerfeldern der Freitag- und Sonntagsliga eingesetzt und dort mit beliebig vielen Stammfahrern besetzt werden; WDL-Ligen verknüpfen ebenfalls ein solches F1-Team. Ein LMU-Team wird unabhängig davon als Cockpit mit mindestens drei Fahrern eingesetzt. Die öffentliche F1-Kachel erscheint ab zwei, die LMU-Kachel ab drei zugeordneten Fahrern. Fehlt ein Logo, wird der Teamname als Ersatz gezeigt. Die Gesamtpunkte eines Teams werden über die stabile Team-ID aus allen zugehörigen F1- beziehungsweise LMU-Rennergebnissen addiert.

Besucher wählen auf den F1-, LMU- und WDL-Seiten über `Saison auswählen` zwischen der aktiven und historischen Saisons. Kalender, Results, Wertungen und WDL-Ausgaben wechseln gemeinsam. Der zeitlich nächste veröffentlichte F1- oder LMU-Termin erscheint automatisch auf der Startseite. Angemeldete Admins sehen direkte Stift-Links zur jeweiligen Pflege.

Fahrer-WM, Team-WM, Liga-Standings und Results lassen sich als Excel-kompatible CSV-Datei herunterladen. Die WDL-Seite erzeugt zusätzlich einen PNG-Export mit Logo und Wertungsdiagramm.

## Projektstruktur

```text
KRL-Express-MVC/
├── app.js
├── server.js
├── config/
├── controllers/
├── middleware/
├── models/
├── routes/
├── services/
├── scripts/
├── views/
│   ├── admin/
│   ├── errors/
│   └── partials/
├── public/
│   ├── css/
│   ├── images/
│   ├── js/
│   └── uploads/
└── tests/
```

## Vor der Veröffentlichung

- echte KRL-Logos, Fahrerbilder und Rennposter über den Adminbereich hochladen
- Impressum, Datenschutz und Kontakt rechtlich vollständig ergänzen
- HTTPS verwenden und `NODE_ENV=production` setzen
- regelmäßige Sicherung der Dateien unter `data/` und `public/uploads/` einrichten

## Technischer Hinweis

Controller enthalten die Request-Logik, Models verwalten die Datenbank, Routes ordnen URLs und Middleware zu, Views übernehmen ausschließlich die Darstellung. Datenbankabfragen befinden sich weder in Routes noch in EJS-Dateien.


### Fahrerpflege und Rennwochenende

- **Fahrerpflege:** `/admin/drivers` – bestehende Fahrer bearbeiten oder über „Neu“ anlegen. Neue Fahrer mit F1-Sicht starten automatisch als F1 Ersatz; Stammränge werden aus Saisonplätzen vergeben.
- **Fahrer bearbeiten:** direkt in `/admin/drivers` suchen und den Eintrag öffnen. Nicht ausgewählte bestehende Sichten bleiben erhalten. Stammränge werden aus Saisonzuordnungen vergeben und über Fahrerwechsel geändert. F1-Ränge werden aus Stammplätzen und Ersatzfahrereinsätzen vergeben; der Ausstieg läuft über Fahrerwechsel.
- **Plattformpflege:** `/admin/platforms` – Name und PNG/JPG/WebP-Logo, Upload per Drag-and-drop. Bestehende Plattformnamen werden beim Serverstart übernommen. Bereits zugeordnete Plattformen können nicht gelöscht werden.
- **Rennwochenende:** Folgeschritte werden erst nach vollständigen Voraussetzungen geöffnet. Der Plus-Knopf fügt Ersatzfahrer hinzu, X entfernt sie. Bestätigte Zuordnungen bleiben bis zur ausdrücklichen Bearbeitung geschützt.
- **Reset:** Schritt 3 löscht Haupt-/Sprintergebnisse. Schritt 2 setzt zusätzlich Anwesenheit zurück; Schritt 1 zusätzlich die Aufstellung. Die Strafkartei bleibt erhalten. Bei geänderter Anwesenheit werden Ergebnisse zur erneuten Eingabe zurückgesetzt. Die Oberfläche nennt diese Auswirkungen vor der Aktion.
- **Kalenderkacheln:** Der Stift ist nur für Administratoren sichtbar. Datum, Startzeit (Europe/Berlin), Strecke, Titel, Sichtbarkeit und Rennformat sind je Termin pflegbar. Die Rundenzuordnung bleibt für Fahrerwechsel und Saisonverlauf stabil. Lokale Änderungen werden nicht durch zentrale Vorlagenänderungen überschrieben; Formatwechsel mit vorhandenen operativen Daten werden abgewiesen.

Nach dem Aktualisieren `npm install` ausführen und den Server neu starten. Neue Plattform- und Sichtfelder werden durch die vorhandene Schema-Ergänzung angelegt. Die neuen Funktionstests liegen in `tests/driverViewsWorkflow.test.js` und verwenden JSDOM für Formularabläufe; sie ersetzen keinen vollständigen MariaDB-/Browsertest.

### Fahrer-Ausstieg und vereinfachte Pflege

- In **Fahrerwechsel** zuerst Liga/Saison und eine offene Runde wählen, dann **Ersatzfahrer hört auf**. Das Datum dieser Runde bestimmt den Ausstieg in allen betroffenen aktuellen F1-Saisons. Vor dem Speichern zeigt die Prüfung die jeweilige erste DNA-Runde; verschiedene Ligen können unterschiedliche Rundennummern haben. Fehlende Kalenderdaten und bestätigte Folgerennwochenenden müssen zuerst korrigiert werden.
- Der zentrale Ersatzrang entfällt. Ohne weitere aktive Stammränge wird der Fahrer automatisch ehemaliger Formel-1-Fahrer. Frühere Punkte und Einsätze bleiben erhalten; geschlossene Reserve-Stints erzeugen die DNA-Zellen. Auch Legacy-Einsätze ohne bisherigen Reserve-Stint werden berücksichtigt. Historische/abgeschlossene Saisons werden nicht umgeschrieben.
- Bei **Cockpit abgeben → hört auf** endet ein zusätzlicher Ersatzstatus ebenfalls ligaübergreifend. **Cockpit abgeben → bleibt Ersatzfahrer** und **Stammcockpit besetzen** behalten ihre bisherigen getrennten Stamm-/Reservewertungen.
- Plattformpflege ohne Reihenfolge, Fahrerpflege ohne Startnummer, Kalenderpflege ohne Minuten-Dauer. Bereits gespeicherte Werte bleiben in der Datenbank erhalten.
- **Regelwerk & Strafenkatalog** werden als Admin direkt auf `/formel-1/regelwerk?edit=1` bearbeitet. Abschnitte hinzufügen, Überschriftentyp auswählen, Text eingeben und mit Pfeilen verschieben. Öffentlich sichtbare Inhalte bleiben reiner Text; Änderungen werden gemeinsam gespeichert und konkurrierende Änderungen erkannt. Beim Neustart ergänzt die Schema-Aktualisierung `f1_rule_sections.heading_level`.

### Geführter Saison-Assistent und F1-Ränge

- Der Assistent beginnt mit der Liga, zeigt anschließend jeweils den nächsten erreichbaren Schritt und behält gespeicherte Saisonangaben. Erreichte Schritte können über die Navigation erneut geöffnet werden; Saisonname, Farbe und Spiel lassen sich direkt ändern. Die Abschlussübersicht erscheint nach vollständiger Zuordnung aller gewählten Stammfahrer.
- In der aktuellen Fahrerauswahl werden F1 Ersatzfahrer nach Namen oder Alias gesucht; bereits ausgewählte Saisonfahrer bleiben erreichbar. Historische Saisons können weiterhin Fahrer mit F1-Sicht auswählen. Hier ausschließlich Stammfahrer auswählen und jedem ein Cockpit zuweisen; nicht zugeordnete Fahrer werden nicht mehr automatisch Ersatzfahrer.
- Beim Abschluss einer aktuellen Saison werden die aktuellen Stammränge der jeweiligen Liga aus deren Stammplätzen übernommen. Andere Stammränge bleiben erhalten, der bisherige Ersatzrang entfällt bei der Stammplatzvergabe. Historische Saisons ändern keine aktuellen Ränge; im Fahrerprofil werden Stammplätze mit Liga, Saison und Rundengültigkeit angezeigt.
- Neue historische Saisonentwürfe sind bis zur Veröffentlichung bzw. bis zum Vorliegen operativer Daten bearbeitbar. Bestehende Saisonhistorien bleiben geschützt.
- Aktuelle Rennwochenenden: Als Ersatz sind F1 Ersatzfahrer sowie Stammfahrer anderer Ligen auswählbar. Beim Hinzufügen als Ersatzfahrer erhält ein Stammfahrer zusätzlich F1 Ersatz. Historische Rennwochenenden: jeder Fahrer mit F1-Rang kann als Ersatzfahrer gewählt werden, sofern er im selben Rennen kein Stammcockpit belegt. Die Wertung folgt der Rolle des konkreten Einsatzes.
- Die F1-Strafpunktgrenze beträgt fest 12 SP in allen Ligen. Die Pflege unterschiedlicher Grenzwerte entfällt; die Veröffentlichungssteuerung der Strafkartei bleibt bestehen.

### Kalender- und Teamgruppenpflege

- **Zentrale F1-Rennkalender:** Ein gemeinsamer Einstieg mit Auswahl zwischen Erstellen und Bearbeiten. Beim Bearbeiten erst den Kalender auswählen und seinen Namen bestätigen, danach die Struktur öffnen. Beim Erstellen erst einen noch nicht vergebenen Namen speichern.
- **Kalenderstruktur:** Mit Pfeilen oder Drag-and-drop verschieben, anschließend gemeinsam speichern. Rennnummern werden ausschließlich aus der Reihenfolge berechnet; Testtage bleiben unnummeriert. Bereits gewertete Rennen bleiben vor Umnummerierung geschützt. Haupt- und Sprintergebnisse bleiben bei zulässigen Änderungen über ihre bisherigen Identitäten zugeordnet, auch bei mehrfach derselben Strecke.
- **Saisontermine:** Fehlerhafte Kalenderdaten werden einzeln markiert. Gültige Eingaben bleiben beim erneuten Öffnen desselben Saisonkalenders erhalten. Startzeiten werden in Europe/Berlin interpretiert.
- **Historische Ergebnisse:** Existiert eine Rennaufstellung, gelten deren bestätigte Anwesenheit und Einsatzteams auch für Ersatzfahrer. Historische Rennen ohne Rennaufstellung behalten die bisherige manuelle Ergebnispflege.
- **Unser Team:** Auf der Startseite „Bearbeiten“ öffnen. Erst dann erscheinen alle Pflegekästen. Gruppen mit Pfeilen anordnen und die Reihenfolge speichern; Gruppen direkt hinzufügen, bearbeiten und löschen. Pro Gruppe Mitglieder über die Plus-Kachel hinzufügen, per Stift Funktion, Beschreibung und Bild pflegen (auch Drag-and-drop) oder per Papierkorb nur aus der Gruppe entfernen. Fahrerprofile bleiben erhalten. Die bisherigen Team-Transaktionen verweisen auf diesen Bearbeitungsmodus.
- Nach dem Aktualisieren den Server neu starten. Die bestehende Schema-Aktualisierung ergänzt automatisch das optionale Feld `krl_team_assignments.description`.

### Korrektur von Kalenderformularen und F1-Standardrängen

- Kalender-, Datums- und Cockpitfelder verwenden vorangestellte Buchstaben in ihren Formularschlüsseln, damit Express numerische Datenbank-IDs nicht als Arraypositionen verändert. Verschieben, Speichern von Terminen und Cockpitzuordnung behalten damit ihre IDs.
- Testtage und offizielle Rennen werden beim Saisonimport getrennt zugeordnet. Fehlende, eindeutig ergänzbare Termine werden angelegt; offene Haupt- und Sprintergebnisse erhalten das geänderte Datum. Ungültige Daten lassen die übrigen Eingaben erhalten.
- Beim Serverstart werden bisherige F1-Rangflags mit den Stammplätzen aktiver Saisons abgeglichen. Unbelegte Stammflags werden zu F1 Ersatz; echte Stammplätze und Ehemalige bleiben entsprechend erhalten. Die Sichtbarkeit einer aktiven Saison beeinflusst ihren Stammrang nicht.
- Neue Ersatzteilnahmen erhalten einen Zeitraum ab der ersten erfassten Runde je Saison/Liga: davor DNA, bei späterem Nichteinsatz DNS. Frühere Ergebnisse werden nicht verändert. Saisonaufstellung und Fahrerwechsel vergeben Stammränge; das manuelle Vergeben von F1-Rängen entfällt in der Fahrerpflege.
- Den Server nach dem Pull neu starten, damit der Abgleich bestehender Ränge ausgeführt wird. Keine neue Datenbankspalte erforderlich.
