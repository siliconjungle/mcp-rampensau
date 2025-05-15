import { SpecServer }          from './generic-spec-server.js';
import rampensauMcpSpec       from './rampensau-mcp-spec.js';

await new SpecServer(rampensauMcpSpec).start();
