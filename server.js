'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
require('./src/db'); // initialise schema
const { loadUser } = require('./src/middleware/auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Security headers ---------------------------------------------------
// When serving plain HTTP (SECURE_COOKIES=false), we MUST NOT emit
// `upgrade-insecure-requests` (it would force the browser to rewrite our
// fetch/asset requests to https:// and they'd fail) or HSTS (which the browser
// caches and then refuses plain HTTP). Both are enabled only behind HTTPS.
const behindHttps = config.secureCookies;
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // Drop the default upgrade-insecure-requests unless we're on HTTPS.
        upgradeInsecureRequests: behindHttps ? [] : null,
      },
    },
    // Only send HSTS when actually serving HTTPS.
    hsts: behindHttps,
    crossOriginEmbedderPolicy: false,
  })
);

// --- Global rate limit (defence against flooding) -----------------------
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Views & static assets
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Serve static assets with revalidation (ETag) rather than a long cache, so a
// `git pull` + restart never leaves users on a stale server.js/style.css.
// Browsers send a conditional request and get a fast 304 when unchanged.
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Attach req.user (if a valid login token is present) to every request.
app.use(loadUser);

// --- API routes ---------------------------------------------------------
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/requests', require('./src/routes/requests'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/servers', require('./src/routes/servers'));

// --- HTML pages ---------------------------------------------------------
app.use('/', require('./src/routes/pages'));

// 404
app.use((req, res) => {
  if (req.accepts('html')) return res.status(404).render('error', { message: 'Page not found' });
  res.status(404).json({ error: 'not found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (res.headersSent) return;
  if (req.accepts('html')) return res.status(500).render('error', { message: 'Something went wrong' });
  res.status(500).json({ error: 'internal error' });
});

app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`PandaServerHost control panel listening on http://${config.host}:${config.port}`);
});
