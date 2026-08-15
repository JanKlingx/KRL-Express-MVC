require('dotenv').config();

const { Sequelize } = require('sequelize');

const requiredVariables = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD'
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `Die Umgebungsvariable ${variable} fehlt in der .env-Datei.`
    );
  }
}

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    dialect: 'mariadb',
    logging: false,

    dialectOptions: {
      allowPublicKeyRetrieval: true,   
      ssl: false                       
    },

    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },

    define: {
      underscored: true,
      timestamps: true
    }
  }
);

module.exports = sequelize;
