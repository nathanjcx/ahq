import { convexBackend } from '../lib/server/backend';
import { credentialKey, serviceSecret } from '../lib/server/secrets';
import { createGateway } from './gateway/create';

// Refuse to listen with a weak or missing secret rather than discovering it on the first request.
serviceSecret();
credentialKey();

const server = createGateway({ backend: convexBackend() }).listen(Number(process.env.PORT || 4001));
server.on('listening', () => console.log('MCP gateway listening'));
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
