const fs = require('node:fs');
const path = require('node:path');
const { PAGES } = require('../core/config');
const partials = path.join(__dirname, '../views/partials');
function renderPage(req, res, next) {
  const page = req.params.page || 'index.html';
  if (!/^[a-zA-Z0-9_-]+\.html$/.test(page)) return next();
  const file = path.join(PAGES, page);
  if (!fs.existsSync(file)) return next();
  try {
    let html = fs.readFileSync(file, 'utf8');
    for (const name of ['header', 'footer']) {
      let partial = fs.readFileSync(path.join(partials, name + '.html'), 'utf8');
      if (name === 'header') partial = partial.replace(/href="([^"]+)" class="([^"]+)"/g, (match, href, classes) => href === page && /nav-link|nav-dropdown-item/.test(classes) ? 'href="' + href + '" class="' + classes + ' active" aria-current="page"' : match);
      html = html.replace('<!-- include:' + name + ' -->', partial);
    }
    res.type('html').send(html);
  } catch (error) { next(error); }
}
module.exports = { renderPage };
