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
- versionierte Punktesysteme für F1-Hauptrennen, F1-Sprints, LMU und WDL mit Schnellste-Runde-Bonus und Gültigkeitszeitraum
- aktive und historische Saisons mit Kategorien, automatischem oder manuellem Rennkalender
- Startseitenstatistiken, interne KRL-Teams mit Fahrer-Rollen und KRL Icons
- getrennte Teampflege für Freitag und Sonntag mit Fahrer A und Fahrer B
- F1-Fahrerrollen `Stamm Freitag`, `Stamm Sonntag` und `F1 Ersatz` sowie `LMU Stammfahrer` und `LMU Ersatzfahrer`
- stabile Fahrer-IDs mit Plattform und beliebig vielen Aliasen direkt im Fahrerformular; Team und Gamertag werden dort nicht gepflegt
- Google-Sheets-ähnliche, rennzentrierte Gesamteingabe für F1, LMU und WDL
- automatisch erzeugte Fahrer-/Team-WM, Liga-Standings, GP-Results, WDL-Diagramm und CSV-/PNG-Exporte
- F1-Rennkalender mit Datum und Startzeit getrennt für Freitag und Sonntag sowie optionalem Sprint-Event, LMU-/WDL-Kalender und LMU-Cockpits
- aktive WDL-Ligen mit Logo, Link und zugeordnetem F1-Team; in historischen Saisons bleiben auch inaktive Ligen auswählbar

Alle Bilder werden ausschließlich als PNG, JPG oder WebP vom eigenen Gerät hochgeladen. Externe Bild-URLs und automatische Bildimporte sind nicht vorgesehen.

## GP-Ergebnisse und Saisonverlauf

Ein Rennen wird zuerst im `F1-Rennkalender (aktuell)` angelegt. Eine Strecke enthält die getrennten Freitags- und Sonntagsdaten sowie optional die Kennzeichnung als Sprint-Event. Dadurch entstehen Hauptrennen und gegebenenfalls ein zusätzlicher Sprint in den aktiven Saisons automatisch. Historische Rennen werden unter `Historische / manuelle Rennen` gepflegt. Die Ergebniszeilen sind die einzige Wertungsquelle: Die öffentliche Seite erzeugt daraus GP-Results, Fahrer-WM, Team-WM, Punkteverlauf und Saisonmatrix. In jeder Rennspalte werden P1, P2 und P3 in Gold, Silber und Bronze hervorgehoben.

Für die schnelle Eingabe stehen `/admin/race-editor`, `/admin/season-progress/lmu` und `/admin/season-progress/wdl` bereit. Die Pflege beginnt immer mit Saison und Kalenderrennen; anschließend wird das vollständige Rennen statt einzelner Fahrerformulare gespeichert. In der aktiven F1-Saison erscheinen die Fahrer der passenden Teamaufstellung und F1-Ersatzfahrer; historische Saisons erlauben alle Fahrer und eine freie Teamwahl. Rennergebnisse referenzieren die stabile Fahrer-ID, sodass Namenswechsel über Aliase hinweg korrekt zusammengezählt werden. Nur aktive F1-Hauptrennen und LMU-Ergebnisse erhöhen die Rennzähler.

Punkte werden über `Punktesysteme` und `Punkte je Platz` gepflegt. Jedes System gehört zu F1, LMU oder WDL, kann zeitlich begrenzt werden und optional Punkte für die schnellste Runde vergeben. Formel 1 besitzt getrennte Platzierungswerte für Haupt- und Sprintrennen. Änderungen berechnen alle vorhandenen Ergebnisse sofort neu.

F1-Teams werden je Liga separat gepflegt. In der Teampflege werden einem Team wie Mercedes direkt `Fahrer A` und `Fahrer B` aus den passenden Stammfahrern zugeordnet. Die Fahrerpflege enthält deshalb keine Teamzuordnung; sie verwaltet nur Stammdaten, Aliase und die F1-Rolle.

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
