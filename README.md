# Katzes Racing League – Express MVC

Vollständige, responsive KRL-Webanwendung mit Node.js, Express, EJS, Sequelize/SQLite, geschütztem Adminbereich und sicheren PNG-Uploads.

## Schnellstart

Voraussetzung: Node.js 20 oder neuer.

1. ZIP entpacken und im Projektordner ein Terminal öffnen.
2. `npm install` ausführen.
3. `.env.example` als `.env` kopieren.
4. In `.env` insbesondere `SESSION_SECRET`, `ADMIN_EMAIL` und `ADMIN_PASSWORD` ändern.
5. `npm run setup` ausführen.
6. `npm run dev` ausführen.
7. `http://localhost:3000` öffnen.

Der Login befindet sich unter `http://localhost:3000/admin/login`. Es gibt bewusst keine öffentliche Registrierung. Ein erneuter Aufruf von `npm run setup` aktualisiert das Passwort des in `.env` eingetragenen Admins, ohne vorhandene Tabelleninhalte zu löschen.

## Öffentliche Routen

- `/` – Startseite mit Ligen, Statistiken und Team
- `/f1/freitag` – Fahrerfeld, Fahrer-WM, Team-WM und GP-Ergebnisse
- `/f1/sonntag` – getrennte Daten für die Sonntagsliga
- `/lmu` – LMU-Cockpits und hochladbare WM-Grafiken
- `/wettkampf-der-ligen` – teilnehmende Ligen und Teamstandings
- `/endurance` – vorbereitete Endurance-Seite

## Adminbereich

Im Dashboard lassen sich folgende Inhalte anlegen, bearbeiten und löschen:

- Startseitenstatistiken und Teamstruktur
- Ligen, F1-Teams und Fahrerfelder
- Fahrer- und Team-WM
- GP-Ergebnisse als PNG
- LMU-Cockpits und LMU-WM-Grafiken als PNG
- teilnehmende Ligen und Wettkampf-Teamstandings

Bei Feldern wie `Liga-ID`, `Team-ID` oder `Fahrer-ID` wird die ID des verknüpften Eintrags verwendet. Diese ID steht in der ersten Spalte der jeweiligen Adminübersicht.

## Upload-Sicherheit

- ausschließlich PNG
- höchstens 10 MB
- Prüfung von Dateiendung, MIME-Typ und PNG-Signatur
- zufälliger UUID-Dateiname
- sichere Ablage in `public/uploads`
- alte Dateien werden beim Ersetzen oder Löschen entfernt

Die mitgelieferten SVG-Bilder sind nur neutrale Seed-Platzhalter. Echte Ergebnisgrafiken werden im Adminbereich als PNG hochgeladen.

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
