const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const methodOverride = require('method-override');

const { sequelize } = require('./models');

const SequelizeStoreFactory =
  require('connect-session-sequelize');

const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const {
  notFound,
  errorHandler
} = require('./middleware/errorHandler');

const SequelizeStore =
  SequelizeStoreFactory(session.Store);

const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: 'sessions',
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 8 * 60 * 60 * 1000
});

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('sessionStore', sessionStore);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '1mb'
  })
);

app.use(express.json({ limit: '1mb' }));

app.use(
  methodOverride(
    (req) => req.body?._method || req.query?._method
  )
);

app.use(
  '/uploads',
  express.static(
    path.join(__dirname, 'public', 'uploads'),
    { fallthrough: false }
  )
);

app.use(
  express.static(path.join(__dirname, 'public'))
);

app.use(
  session({
    store: sessionStore,
       secret:
      process.env.SESSION_SECRET ||
      'nur-fuer-lokale-entwicklung-aendern',

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.isAdmin = Boolean(req.session.userId);
  res.locals.flash = req.session.flash || null;

  delete req.session.flash;
  next();
});

app.use('/', publicRoutes);
app.use('/admin', authRoutes);
app.use('/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;