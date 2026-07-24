"use strict";

/**
 * Remote Message → TaskRequest pipeline entry helper.
 * Pipeline: Remote Message → TaskRequest → PermissionProxy → TaskQueue → Brain/Skill → Result
 */
class RemoteTaskSource {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async ingest(message) {
    return this.gateway.handleInbound(message);
  }

  async submitTask(taskRequest) {
    return this.gateway.submitTask(taskRequest);
  }
}

module.exports = { RemoteTaskSource };
