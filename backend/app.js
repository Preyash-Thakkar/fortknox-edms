// Test/entry shim: re-exports the Express app and a `ready` promise from server.js.
// server.js only calls app.listen() when run directly, so importing here is safe.
module.exports = require('./server');
