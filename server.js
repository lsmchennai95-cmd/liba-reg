import { app } from './app.js';
import { env } from './config/env.js';
import { testConnection } from './config/database.js';

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

