/**
 * Stub electron-log pour les tests unitaires.
 * Toutes les méthodes sont des no-ops — on ne veut pas de logs pendant les tests.
 */
const log = {
  info:  () => {},
  warn:  () => {},
  error: () => {},
  debug: () => {},
  transports: {
    file:    { level: 'info' as const, maxSize: 0, resolvePathFn: () => '' },
    console: { level: 'debug' as const },
  },
};

export default log;
