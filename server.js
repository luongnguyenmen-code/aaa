const app = require('./src/app');
const { PORT } = require('./src/core/config');
if (require.main === module) app.listen(PORT, () => console.log('ST25 portal: http://localhost:' + PORT));
module.exports = app;
