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
- `/lmu` – LMU-Cockpits und hochladbare WM-Grafiken
- `/wettkampf-der-ligen` – teilnehmende Ligen und Teamstandings
- `/endurance` – vorbereitete Endurance-Seite

## Adminbereich

Im Dashboard lassen sich folgende Inhalte anlegen, bearbeiten und löschen:

- Startseitenstatistiken und Teamstruktur
- getrennte Teampflege für Freitag und Sonntag mit Fahrer A und Fahrer B
- getrennte F1-, LMU- und WDL-Fahrer-/Team-Stammdaten
- F1-Fahrerrollen `Stamm Freitag`, `Stamm Sonntag` und `Ersatzfahrer Formel 1`
- stabile Fahrer-IDs mit Plattform und beliebig vielen Aliasen direkt im Fahrerformular; Team und Gamertag werden dort nicht gepflegt
- Grand Prix und Saisonverlaufszeilen mit deutlich sichtbaren Podiums- und Statusmarkierungen (DNF, DNS, DNQ, DSQ, DNA)
- automatisch erzeugte Fahrer-WM, Team-WM und GP-Results
- LMU-Cockpits und LMU-WM-Grafiken
- teilnehmende Ligen und Wettkampf-Teamstandings

Alle Bilder werden ausschließlich als PNG, JPG oder WebP vom eigenen Gerät hochgeladen. Externe Bild-URLs und automatische Bildimporte sind nicht vorgesehen.

## GP-Ergebnisse und Saisonverlauf

Ein Rennen wird zuerst im `F1-Rennkalender` angelegt. Dadurch steht es automatisch für den Saisonverlauf bereit. Danach werden unter `Saisonverlauf eintragen` Stammfahrer, Platz, Status und Punkte erfasst. Diese Einträge sind die einzige Ergebnisquelle: Die öffentliche Seite erzeugt daraus automatisch GP-Results, Fahrer-WM, Team-WM, Punkteverlauf und Saisonmatrix. In jeder Rennspalte werden P1, P2 und P3 in Gold, Silber und Bronze hervorgehoben.

Für die schnelle Eingabe steht unter `/admin/race-editor` eine tabellarische, Google-Sheets-ähnliche Ansicht bereit. Dort wird zuerst `Stamm Freitag` oder `Stamm Sonntag` und anschließend ein Rennen aus dem zugehörigen Kalender ausgewählt. Die Tabelle zeigt ausschließlich die Stammfahrer, die in den Teams dieser Liga als Fahrer A oder Fahrer B aufgestellt sind. Rennergebnisse referenzieren die stabile Fahrer-ID; Namenswechsel werden deshalb über Aliase hinweg korrekt zusammengezählt.

F1-Teams werden je Liga separat gepflegt. In der Teampflege werden einem Team wie Mercedes direkt `Fahrer A` und `Fahrer B` aus den passenden Stammfahrern zugeordnet. Die Fahrerpflege enthält deshalb keine Teamzuordnung; sie verwaltet nur Stammdaten, Aliase und die F1-Rolle.

F1- und LMU-Rennkalender werden im Adminbereich gepflegt. Der zeitlich nächste veröffentlichte Termin beider Disziplinen erscheint automatisch auf der Startseite. Angemeldete Admins sehen auf den öffentlichen F1-, LMU- und WDL-Seiten direkte Stift-Links zur jeweiligen Stammdatenpflege.

Fahrer-WM, Team-WM und sämtliche GP-Results lassen sich auf der jeweiligen Ligaseite als Excel-kompatible CSV-Datei herunterladen.

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
