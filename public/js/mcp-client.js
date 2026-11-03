// Minimal MCP client over Streamable HTTP, routed through the server proxy (/api/mcp/call) so the
// browser is not blocked by CORS and outbound calls pass the SSRF guard and audit log.
// stdio servers (npx/uvx) cannot run inside a browser or a Worker: export their config for a desktop
// client, or run them behind an HTTP bridge and register the bridge URL here.
export function mcpClient(api, { url, authorization }) {
  let sessionId = null;
  const call = async (method, params) => {
    const r = await api('/api/mcp/call', { method: 'POST', body: { url, authorization, sessionId, method, params } });
    if (r.sessionId) sessionId = r.sessionId;
    if (r.response?.error) throw new Error(r.response.error.message || 'MCP error');
    return r.response?.result;
  };
  return {
    async connect() {
      const info = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'halyard', version: '1.5.0' } });
      await call('notifications/initialized').catch(() => {});
      return info;
    },
    async listTools() { return (await call('tools/list', {}))?.tools || []; },
    async callTool(name, args) { return call('tools/call', { name, arguments: args || {} }); },
  };
}

export function desktopConfig(servers) {
  return { mcpServers: Object.fromEntries(servers.map((s) => [s.name.replace(/^@/, '').replace(/[/]/g, '-'), s.url ? { type: 'http', url: s.url } : { command: s.config.command, args: s.config.args, ...(s.env ? { env: s.env } : {}) }])) };
}
