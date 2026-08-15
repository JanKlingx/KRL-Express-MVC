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

Der Login befindet sich unter `http://localhost:3000/admin/login`. Es gibt bewusst keine öffentliche Registrierung. Ein erneuter Aufruf von `npm run setup` aktualisiert das Passwort des in `.env` eingetragenen Admins, ohne vorhandene Tabelleninhalte zu löschen.

Für den Wettkampf der Ligen kann zusätzlich ein eigener, eingeschränkter Zugang eingerichtet werden. Dazu `WDL_ADMIN_EMAIL` und `WDL_ADMIN_PASSWORD` in `.env` setzen und `npm run setup` erneut ausführen. Der Login befindet sich unter `http://localhost:3000/wdl-admin/login`; dieser Benutzer sieht ausschließlich teilnehmende Ligen und WDL-Teamstandings.

## Öffentliche Routen

- `/` – Startseite mit Ligen, Statistiken und Team
- `/f1/freitag` – Fahrerfeld, Fahrer-WM, gerenderte GP-Ergebnisse und Saisonverlauf (Saisons 4–11 mitgeliefert)
- `/f1/sonntag` – getrennte Daten für die Sonntagsliga
- `/lmu` – LMU-Cockpits und hochladbare WM-Grafiken
- `/wettkampf-der-ligen` – teilnehmende Ligen und Teamstandings
- `/endurance` – vorbereitete Endurance-Seite

## Adminbereich

Im Dashboard lassen sich folgende Inhalte anlegen, bearbeiten und löschen:

- Startseitenstatistiken und Teamstruktur
- Ligen, F1-Teams und Fahrerfelder
- Fahrer- und Team-WM
- Grand Prix und einzelne Klassifikationszeilen mit deutlich sichtbaren Podiums- und Statusmarkierungen (DNF, DNS, DNQ, DSQ, DNA)
- öffentliche Google-Sheets-Datenquelle für den Saisonverlauf
- LMU-Cockpits und LMU-WM-Grafiken als PNG
- teilnehmende Ligen und Wettkampf-Teamstandings

Bei Feldern wie `Liga-ID`, `Team-ID` oder `Fahrer-ID` wird die ID des verknüpften Eintrags verwendet. Diese ID steht in der ersten Spalte der jeweiligen Adminübersicht.

## GP-Ergebnisse und Saisonverlauf

Ein Grand Prix wird zuerst unter `Grand Prix` angelegt. Danach werden die Fahrerzeilen unter `GP-Klassifikationen` über ein beschriftetes Auswahlfeld zugeordnet. Die öffentliche Ligaseite rendert daraus Podium und vollständige Ergebnistabelle in der Akzentfarbe der Liga; Plätze 1–3 sowie DNF, DNS, DNQ, DSQ und DNA sind farblich klar erkennbar. Ein PNG ist nicht mehr erforderlich.

Unter `Saisonverlauf (Google Sheets)` kann pro Liga ein öffentlich freigegebener Google-Sheets-Link hinterlegt werden. Der Link darf ein normaler Bearbeitungs-/Freigabelink oder ein veröffentlichter Link sein. Die Anwendung lädt den angegebenen Tabellenreiter als CSV, hält ihn fünf Minuten im Cache und fällt bei der Freitagsliga auf den mitgelieferten Export zurück. Das Sheet muss die Saisonblöcke wie im KRL-Export enthalten.

Die Saisonansicht bildet die Tabellenlogik mit Fahrer, Team, Rennen, Gesamtpunkten, Punktedifferenz und Durchschnitt ab. Nichtstarts und Ausfälle werden als Status-Badges hervorgehoben.

Ein neuer CSV- oder Markdown-Export kann auch lokal importiert werden:

```powershell
npm run import:history -- freitag "C:\Pfad\zum\export.csv"
```

PNG-Uploads werden nur noch für die vorhandenen LMU-WM-Grafiken verwendet und weiterhin auf Dateityp, Größe und Signatur geprüft.

## Projektstruktur

```text
KRL-Express-MVC/
├── app.js
├── server.js
├── config/
├── controllers/
├── data/
│   └── season-history/
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
└── data/
```

## Vor der Veröffentlichung

- echte KRL-Logos, Teamfotos und Referenzbilder in `public/images` einsetzen
- Platzhalterpfade im Adminbereich austauschen
- Impressum, Datenschutz und Kontakt rechtlich vollständig ergänzen
- HTTPS verwenden und `NODE_ENV=production` setzen
- regelmäßige Sicherung der Dateien unter `data/` und `public/uploads/` einrichten

## Technischer Hinweis

Controller enthalten die Request-Logik, Models verwalten die Datenbank, Routes ordnen URLs und Middleware zu, Views übernehmen ausschließlich die Darstellung. Datenbankabfragen befinden sich weder in Routes noch in EJS-Dateien.
