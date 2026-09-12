import { convexBackend } from '../lib/server/backend';
import { requiredEnv } from '../lib/server/secrets';
import { createGateway } from './gateway/create';

requiredEnv('AHQ_SERVICE_SECRET');
requiredEnv('CREDENTIAL_ENCRYPTION_KEY');

const server = createGateway({ backend: convexBackend() }).listen(Number(process.env.PORT || 4001));
server.on('listening', () => console.log('MCP gateway listening'));
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
