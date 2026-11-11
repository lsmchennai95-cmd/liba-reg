import { app } from './app.js';
import { env } from './config/env.js';
import { testConnection } from './config/database.js';
import { logException } from './services/errorLogger.service.js';

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logException(err, { endpoint: 'process.unhandledRejection' });
});

process.on('uncaughtException', (err) => {
  logException(err, { endpoint: 'process.uncaughtException' });
  process.exit(1);
});

const startServer = async () => {
  console.log(`Starting LIBA Server in ${env.nodeEnv} mode...`);

  // Verify MySQL Connection
  await testConnection();

  const server = app.listen(env.port, () => {
    console.log(`LIBA Server listening at http://localhost:${env.port}`);
    console.log(`Health check: http://localhost:${env.port}/api/v1/health`);
  });

  const shutdown = () => {
    console.log('Shutting down LIBA Server gracefully...');
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();

