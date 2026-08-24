require("dotenv").config();

const bcrypt = require("bcrypt");

const {
  sequelize,
  User,
} = require("../models");

const {
  ensureSchema,
} = require("../services/schema");


async function run() {
  /*
   * =====================================================
   * UMGEBUNG PRÜFEN
   * =====================================================
   */

  if (
    !process.env.ADMIN_EMAIL ||
    !process.env.ADMIN_PASSWORD
  ) {
    throw new Error(
      "ADMIN_EMAIL und ADMIN_PASSWORD müssen in der .env-Datei gesetzt sein.",
    );
  }


  /*
   * =====================================================
   * DATENBANK / TABELLEN
   * =====================================================
   */

  await sequelize.sync();

  await ensureSchema();


  /*
   * =====================================================
   * ADMIN
   * =====================================================
   */

  const adminEmail =
    process.env.ADMIN_EMAIL
      .trim()
      .toLowerCase();


  const passwordHash =
    await bcrypt.hash(
      process.env.ADMIN_PASSWORD,
      12,
    );


  const [
    admin,
    created,
  ] =
    await User.findOrCreate({
      where: {
        email:
          adminEmail,
      },

      defaults: {
        email:
          adminEmail,

        passwordHash,

        role:
          "admin",
      },
    });


  /*
   * Existiert der Admin bereits,
   * Passwort aus .env aktualisieren.
   */
  if (
    !created
  ) {
    await admin.update({
      passwordHash,

      role:
        "admin",
    });
  }


  /*
   * =====================================================
   * FERTIG
   * =====================================================
   */

  console.log(
    "Setup abgeschlossen. Datenbank, Schema und Admin sind bereit.",
  );


  await sequelize.close();
}


run().catch(
  async (
    error,
  ) => {

    console.error(
      error.message,
    );


    await sequelize
      .close()
      .catch(
        () => {},
      );


    process.exit(1);
  },
);