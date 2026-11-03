# Deploy to Cloudflare (Workers + D1 + Static Assets)

1. `npm install`
2. `npx wrangler d1 create halyard`, then copy the `database_id` into `wrangler.toml`.
3. `npx wrangler d1 migrations apply halyard --remote`
4. Secrets:
   - `openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY`
   - `npx wrangler secret put SETUP_TOKEN` (required to create the first admin; strongly recommended)
5. `npx wrangler deploy`
6. Open the URL, enter the setup token, and create the admin.

**Recommended for SOC 2:** turn on **Settings → Team → Require multi-factor authentication** once your own MFA is set up. Add Cloudflare Access if you also want SSO.

**Scheduled job:** the cron trigger (every 30 min) purges expired sessions and rate-limit rows.

**Backups:** D1 Time Travel provides point-in-time restore. Also schedule `wrangler d1 export halyard --remote --output backup.sql`.

**Local models from a Workers deployment:** the browser calls Ollama or LM Studio directly. Allow your Worker's origin: `OLLAMA_ORIGINS=https://your-worker.example.com ollama serve`. In LM Studio, enable CORS.

**Rotating `ENCRYPTION_KEY`:** set the new secret, then re-enter each provider key in Settings → Models (old ciphertexts cannot be decrypted with the new key). See finding F-04.

**Limits:** Workers caps PBKDF2 at 100,000 iterations; this is the default.
