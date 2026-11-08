// Compatibility alias: the app owns its processing worker.
process.env.PORT = process.env.GAMEFRAME_PORT || process.env.PORT || '8000';
require('../server').startServer();
