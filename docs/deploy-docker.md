# Run locally with Docker

```bash
cp .env.example .env            # set ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose up --build       # http://localhost:8787
```

- Data lives in the `halyard-data` volume (`/data/halyard.db`). Back it up by copying the volume or using `sqlite3 /data/halyard.db ".backup backup.db"`.
- The container runs as the non-root `node` user, with a read-only root filesystem, all capabilities dropped and `no-new-privileges`.
- `ALLOW_PRIVATE_NETWORK=true` (set in compose) lets the server-side proxies reach local MCP servers and gateways, for example `http://host.docker.internal:3000/mcp`. Leave it `false` on internet-facing deployments.
- Local models: `docker compose --profile ollama up`, then `docker compose exec ollama ollama pull llama3.2`. In Halyard pick **Ollama** and model `llama3.2`.
- You can raise `PBKDF2_ITERATIONS` (e.g. 600000) in Docker; existing users keep their stored iteration count until they change password.
- Put a TLS-terminating reverse proxy with SSO/MFA in front for anything beyond a single workstation. Then set `TRUST_PROXY=true` so rate limits and the audit log use the client IP your proxy appends to `X-Forwarded-For`, and session cookies are marked `Secure` when the proxy forwards `X-Forwarded-Proto: https`. Set it only when exactly one proxy sits in front and the container is not reachable directly. Without it, clients can't spoof their IP: Halyard ignores forwarded headers and uses the connection address.
- The image runs with `NODE_ENV=production`, so the container refuses to start without a valid `ENCRYPTION_KEY`. Keep the same key for the life of the data: anything encrypted with one key can't be decrypted with another.
- `docker stop` shuts down gracefully: Halyard stops accepting requests, waits for a running factory tick, and closes the database cleanly.

Without Docker: `npm install && npm start` (a `.env` with a fresh key is created on first run).
