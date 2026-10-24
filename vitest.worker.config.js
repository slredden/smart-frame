// Worker tests run inside workerd with local D1 + KV. Test-only secrets below are fake, generated
// values and are never used anywhere else.
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export const TEST_SECRETS = {
  URL_SIGNING_KEY: 'test-signing-key-not-real-0123456789',
  TOKEN_ENC_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=', // bytes 0..31, fake gitleaks:allow
  // sha256("test-health-token-0123456789") and sha256("test-publish-token-0123456789")
  HEALTH_TOKEN_HASH: '',
  PUBLISH_TOKEN_HASH: '',
  ADMIN_EMAILS: 'admin@example.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
};

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const { createHash } = await import('node:crypto');
      const h = (s) => createHash('sha256').update(s).digest('hex');
      return {
        wrangler: { configPath: './worker/wrangler.jsonc' },
        miniflare: {
          bindings: Object.assign({}, TEST_SECRETS, {
            HEALTH_TOKEN_HASH: h('test-health-token-0123456789'),
            PUBLISH_TOKEN_HASH: h('test-publish-token-0123456789'),
            GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
            ACCESS_AUD: 'test-aud',
          }),
        },
      };
    }),
  ],
  test: {
    include: ['test/worker/**/*.test.js'],
  },
});
