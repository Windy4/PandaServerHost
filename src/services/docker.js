'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Docker = require('dockerode');
const config = require('../config');

const docker = new Docker(); // uses /var/run/docker.sock by default

/**
 * Per-server RCON password. Deterministic (derived from the JWT secret + server
 * id) so it survives restarts, and never leaves the container: RCON is not
 * published to any host port, so this only authenticates rcon-cli inside it.
 */
function rconPassword(server) {
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update('rcon:' + server.id)
    .digest('hex')
    .slice(0, 24);
}

/** Deterministic container name for a server row. */
function containerName(serverId) {
  return `panda-mc-${serverId}`;
}

/** Absolute host path holding a server's /data volume. */
function serverDataDir(serverId) {
  return path.join(config.serversDir, String(serverId));
}

async function ensureImage(image) {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch (_e) {
    /* not present locally — pull it */
  }
  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (doneErr) =>
        doneErr ? reject(doneErr) : resolve()
      );
    });
  });
}

/**
 * Create (deploy) a container for a server. Enforces hard resource limits via
 * cgroups so a server can never exceed the RAM/CPU it was granted.
 * Idempotent-ish: removes any stale container with the same name first.
 */
async function deployServer(server) {
  const name = containerName(server.id);
  const dataDir = serverDataDir(server.id);
  fs.mkdirSync(dataDir, { recursive: true });

  await ensureImage(config.mcImage);

  // Remove a pre-existing container of the same name (e.g. re-deploy).
  try {
    const old = docker.getContainer(name);
    await old.remove({ force: true });
  } catch (_e) {
    /* none existed */
  }

  // Give the JVM ~85% of the container RAM; leave headroom for native/off-heap.
  const heapMb = Math.max(512, Math.floor(server.ram_mb * 0.85));

  const env = [
    'EULA=TRUE',
    `TYPE=${server.server_type}`,
    `VERSION=${server.mc_version}`,
    `MEMORY=${heapMb}M`,
    // itzg respects INIT_MEMORY/MAX_MEMORY too; MEMORY sets both.
    // Enable RCON so the dashboard can send console commands. The RCON port is
    // NOT published to the host (no PortBindings entry for 25575), so it is only
    // reachable from inside the container via rcon-cli through `docker exec`.
    'ENABLE_RCON=true',
    'RCON_PORT=25575',
    `RCON_PASSWORD=${rconPassword(server)}`,
    'STOP_SERVER_ANNOUNCE_DELAY=5',
  ];

  const createOpts = {
    name,
    Image: config.mcImage,
    Env: env,
    Labels: {
      'panda.server_id': String(server.id),
      'panda.owner_id': String(server.owner_id),
    },
    ExposedPorts: { '25565/tcp': {} },
    HostConfig: {
      // --- Resource limits (the "only that much resources" requirement) ---
      Memory: server.ram_mb * 1024 * 1024,
      MemorySwap: server.ram_mb * 1024 * 1024, // disable swap beyond RAM
      NanoCpus: Math.round(server.cpu_cores * 1e9),
      PidsLimit: 512,
      // --- Isolation / hardening ---
      // Drop every capability, then add back only what the itzg entrypoint
      // needs: it starts as root, chowns /data, and uses gosu/su-exec to drop
      // to the unprivileged `minecraft` user (UID 1000). Without SETUID/SETGID
      // that switch fails with "operation not permitted"; CHOWN/DAC_OVERRIDE/
      // FOWNER let it fix /data ownership. no-new-privileges still prevents
      // regaining privileges once dropped.
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'SETUID', 'SETGID', 'KILL'],
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: false, // /data must be writable; rootfs stays default
      RestartPolicy: { Name: 'unless-stopped' },
      // --- Networking: map the assigned host port to the MC port ---
      PortBindings: {
        '25565/tcp': [{ HostPort: String(server.host_port) }],
      },
      Binds: [`${dataDir}:/data`],
    },
  };

  const container = await docker.createContainer(createOpts);
  await container.start();
  return container.id;
}

async function getContainer(server) {
  if (!server.container_id) return docker.getContainer(containerName(server.id));
  return docker.getContainer(server.container_id);
}

async function startServer(server) {
  const c = await getContainer(server);
  await c.start();
}

async function stopServer(server) {
  const c = await getContainer(server);
  await c.stop({ t: 20 });
}

async function restartServer(server) {
  const c = await getContainer(server);
  await c.restart({ t: 20 });
}

async function removeServer(server) {
  try {
    const c = await getContainer(server);
    await c.remove({ force: true });
  } catch (_e) {
    /* already gone */
  }
}

async function statusOf(server) {
  try {
    const c = await getContainer(server);
    const info = await c.inspect();
    return info.State.Running ? 'running' : 'stopped';
  } catch (_e) {
    return 'unknown';
  }
}

async function tailLogs(server, tail = 200) {
  const c = await getContainer(server);
  const buf = await c.logs({ stdout: true, stderr: true, tail, timestamps: false });
  // Strip Docker multiplexed stream headers (8-byte frames) when present.
  return demux(buf);
}

/**
 * Send a console command to the running server via rcon-cli inside the
 * container. The command is passed as a single argv element (no shell), so
 * there is no shell-injection surface. Returns the server's text response.
 */
async function sendCommand(server, command) {
  const c = await getContainer(server);
  const exec = await c.exec({
    Cmd: ['rcon-cli', String(command)],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (d) => chunks.push(d));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  const info = await exec.inspect().catch(() => ({ ExitCode: 0 }));
  const text = demux(buf).trim();
  if (info.ExitCode && info.ExitCode !== 0) {
    throw new Error(text || 'command failed (is the server fully started?)');
  }
  return text;
}

async function liveStats(server) {
  const c = await getContainer(server);
  const s = await c.stats({ stream: false });
  const memUsage = s.memory_stats.usage || 0;
  const memLimit = s.memory_stats.limit || 1;
  let cpuPct = 0;
  try {
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
    const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
    const cpus = s.cpu_stats.online_cpus || 1;
    if (sysDelta > 0 && cpuDelta > 0) cpuPct = (cpuDelta / sysDelta) * cpus * 100;
  } catch (_e) {
    /* stats not ready */
  }
  return {
    memUsageMb: Math.round(memUsage / 1024 / 1024),
    memLimitMb: Math.round(memLimit / 1024 / 1024),
    cpuPercent: Math.round(cpuPct * 10) / 10,
  };
}

function demux(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return '';
  // Heuristic: Docker stream frames start with a stream-type byte (0,1,2)
  // followed by 3 zero bytes. If it doesn't look framed, return as-is.
  if (buf[0] > 2 || buf[1] !== 0 || buf[2] !== 0 || buf[3] !== 0) {
    return buf.toString('utf8');
  }
  const out = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off + 4);
    off += 8;
    out.push(buf.toString('utf8', off, off + len));
    off += len;
  }
  return out.join('');
}

module.exports = {
  docker,
  containerName,
  serverDataDir,
  deployServer,
  startServer,
  stopServer,
  restartServer,
  removeServer,
  statusOf,
  tailLogs,
  liveStats,
  sendCommand,
};
