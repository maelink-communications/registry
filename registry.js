// Lightweight HTTP service for servers to register and discover each other
// Run on a separate port (default 8000)

import { log } from "./logging.js";

log("Registry loaded", "gray");
const servers = new Map();

// Configuration
const HEARTBEAT_TIMEOUT = 30000; // 30 seconds - mark server stale if no heartbeat
const CLEANUP_INTERVAL = 60000; // 60 seconds - periodic cleanup of stale servers
const REGISTRY_PORT = parseInt(Deno.env.get("REGISTRY_PORT") || "8000");

function registerServer(serverId, address, port, version = "1.0") {
  const now = Date.now();
  servers.set(serverId, {
    id: serverId,
    address,
    port,
    lastHeartbeat: now,
    version,
    registeredAt: now,
  });

  log(`Server registered: ${serverId} at ${address}:${port}`, "green");
  return { success: true, serverId, timestamp: now };
}

function heartbeatServer(serverId) {
  const server = servers.get(serverId);
  if (!server) {
    return {
      success: false,
      error: "Server not registered",
    };
  }

  server.lastHeartbeat = Date.now();
  log(`Heartbeat received from ${serverId}`, "gray");
  return { success: true, serverId, timestamp: server.lastHeartbeat };
}

/**
 * Get list of all active peers
 */
function getPeers() {
  const now = Date.now();
  const activePeers = [];

  for (const [serverId, server] of servers) {
    const isStale = now - server.lastHeartbeat > HEARTBEAT_TIMEOUT;
    if (!isStale) {
      activePeers.push({
        id: server.id,
        address: server.address,
        port: server.port,
        version: server.version,
      });
    }
  }

  return activePeers;
}

/**
 * Deregister a server
 */
function deregisterServer(serverId) {
  const wasPresent = servers.has(serverId);
  if (wasPresent) {
    servers.delete(serverId);
    log(`Server deregistered: ${serverId}`, "yellow");
  }
  return { success: wasPresent, serverId };
}

/**
 * Get status of all registered servers
 */
function getStatus() {
  const now = Date.now();
  const serverList = [];

  for (const [serverId, server] of servers) {
    const isStale = now - server.lastHeartbeat > HEARTBEAT_TIMEOUT;
    serverList.push({
      id: server.id,
      address: server.address,
      port: server.port,
      lastHeartbeat: server.lastHeartbeat,
      isActive: !isStale,
      uptime: now - server.registeredAt,
    });
  }

  return {
    activeCount: serverList.filter((s) => s.isActive).length,
    totalCount: serverList.length,
    servers: serverList,
  };
}

/**
 * Cleanup stale servers periodically
 */
function cleanupStaleServers() {
  const now = Date.now();
  let cleaned = 0;

  for (const [serverId, server] of servers) {
    if (now - server.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      servers.delete(serverId);
      cleaned++;
      log(`Cleaned up stale server: ${serverId}`, "yellow");
    }
  }

  return cleaned;
}

// HTTP Handler
async function handleRequest(req) {
  const url = new URL(req.url);
  const { pathname, method } = { pathname: url.pathname, method: req.method };

  // Response helpers
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Register a new server
    if (pathname === "/register" && method === "POST") {
      const { id, address, port, version } = await req.json();

      if (!id || !address || !port) {
        return json(
          { error: "Missing required fields: id, address, port" },
          400
        );
      }

      const result = registerServer(id, address, port, version);
      return json(result);
    }

    // Heartbeat from a server
    if (pathname === "/heartbeat" && method === "POST") {
      const { id } = await req.json();

      if (!id) {
        return json({ error: "Missing required field: id" }, 400);
      }

      const result = heartbeatServer(id);
      if (!result.success) {
        return json(result, 404);
      }
      return json(result);
    }

    // Get list of active peers
    if (pathname === "/peers" && method === "GET") {
      const peers = getPeers();
      return json({
        success: true,
        peers,
        count: peers.length,
        timestamp: Date.now(),
      });
    }

    // Get detailed status of all servers
    if (pathname === "/status" && method === "GET") {
      const status = getStatus();
      return json({ success: true, ...status, timestamp: Date.now() });
    }

    // Deregister a server
    if (pathname === "/deregister" && method === "POST") {
      const { id } = await req.json();

      if (!id) {
        return json({ error: "Missing required field: id" }, 400);
      }

      const result = deregisterServer(id);
      return json(result);
    }

    // Health check
    if (pathname === "/health" && method === "GET") {
      return json({
        status: "ok",
        timestamp: Date.now(),
        servers: servers.size,
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    log(`Registry error: ${error.message}`, "red");
    return json({ error: error.message }, 500);
  }
}

// Start periodic cleanup
setInterval(() => {
  const cleaned = cleanupStaleServers();
  if (cleaned > 0) {
    log(`Cleanup cycle: removed ${cleaned} stale servers`, "gray");
  }
}, CLEANUP_INTERVAL);

// Export functions for use as a module
export {
  registerServer,
  heartbeatServer,
  getPeers,
  deregisterServer,
  getStatus,
  cleanupStaleServers,
};

// Start HTTP server if this is the main module
if (import.meta.main) {
  Deno.serve({ port: REGISTRY_PORT, onListen: () => {} }, handleRequest);
  log(
    `PROTOKOL Registry | Running on http://localhost:${REGISTRY_PORT}`,
    "magenta"
  );
}
