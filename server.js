require('dotenv').config();

const app = require('./app');
const { sequelize } = require('./models');   // ✔️ nur das importieren

const port = Number(process.env.PORT) || 3000;

async function start() {
  try {
    await sequelize.authenticate();           // ✔️ Verbindung testen
    await app.get('sessionStore').sync();     // ✔️ Session-Tabelle erstellen

    app.listen(port, () => {
      console.log(`KRL läuft auf http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Start fehlgeschlagen:', error);
    process.exit(1);
  }
}

start();
