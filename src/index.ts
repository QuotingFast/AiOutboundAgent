import { startServer } from './server';

startServer().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
