import { createRequire } from 'node:module';

// Mobile pins an older React at the workspace root. Render all web dependencies
// with the web app's React instance, matching Vite's resolve.dedupe behavior.
const webRequire = createRequire(new URL('../package.json', import.meta.url));
const workspaceRequire = createRequire(new URL('../../../package.json', import.meta.url));
for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']) {
  webRequire(name);
  workspaceRequire.cache[workspaceRequire.resolve(name)] =
    webRequire.cache[webRequire.resolve(name)];
}
