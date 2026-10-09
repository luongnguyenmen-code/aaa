const { getConfig } = require('../models/config');
const { renderPage } = require('../controllers/pages');
module.exports = app => {
  app.get('/song-bac.html', (req, res, next) => {
    if (getConfig().casino?.enabled !== true) return res.redirect('/');
    next();
  });
  app.get(['/', '/:page'], renderPage);
};
