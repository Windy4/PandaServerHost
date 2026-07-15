'use strict';

const db = require('../db');
const config = require('../config');

const used = db.prepare('SELECT host_port FROM servers');

/**
 * Returns the lowest free port in [portMin, portMax] not already assigned to a
 * server. Throws if the pool is exhausted. You port-forward these manually.
 */
function allocatePort() {
  const taken = new Set(used.all().map((r) => r.host_port));
  for (let p = config.portMin; p <= config.portMax; p++) {
    if (!taken.has(p)) return p;
  }
  throw new Error(
    `No free ports left in range ${config.portMin}-${config.portMax}. ` +
      'Widen MC_PORT_MIN/MC_PORT_MAX or delete unused servers.'
  );
}

module.exports = { allocatePort };
