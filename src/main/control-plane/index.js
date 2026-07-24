"use strict";

const { CapabilityRegistry } = require("./CapabilityRegistry");
const { CapabilityDiscovery } = require("./CapabilityDiscovery");
const { BrainManager } = require("./BrainManager");
const { DependencySupervisor } = require("./DependencySupervisor");
const { RemoteCenter } = require("./RemoteCenter");
const { FirstRunWizard } = require("./FirstRunWizard");
const { probeDockerInstalled } = require("./docker-probe");
const types = require("./CapabilityTypes");

/**
 * MOGU Control Plane facade — orchestration only, no new runtime.
 */
function createControlPlane(deps = {}) {
  const registry = new CapabilityRegistry({
    getSettings: deps.getSettings,
    secretStore: deps.secretStore,
    getSetupStatus: deps.getSetupStatus,
    listOllamaModels: deps.listOllamaModels,
    getOpenclawStatus: deps.getOpenclawStatus,
    getRemoteStatus: deps.getRemoteStatus,
    probeCoding: deps.probeCoding,
    probeDocker: deps.probeDocker || probeDockerInstalled,
    testBrain: deps.testBrain,
  });

  const discovery = new CapabilityDiscovery({
    registry,
    probeDocker: deps.probeDocker || probeDockerInstalled,
  });

  const brain = new BrainManager({
    getSettings: deps.getSettings,
    updateSettings: deps.updateSettings,
    secretStore: deps.secretStore,
    testBrain: deps.testBrain,
    listOllamaModels: deps.listOllamaModels,
  });

  const supervisor = new DependencySupervisor({
    registry,
    getSettings: deps.getSettings,
  });

  const remote = new RemoteCenter({
    getSettings: deps.getSettings,
    secretStore: deps.secretStore,
    getRemoteStatus: deps.getRemoteStatus,
    startRemote: deps.startRemote,
    stopRemote: deps.stopRemote,
  });

  const wizard = new FirstRunWizard({
    getSettings: deps.getSettings,
    updateSettings: deps.updateSettings,
  });

  return {
    registry,
    discovery,
    brain,
    supervisor,
    remote,
    wizard,
    async status() {
      const settings = await deps.getSettings();
      if (settings.controlPlaneEnabled !== true) {
        return {
          ok: true,
          controlPlaneEnabled: false,
          message: "控制中心默认关闭。首次向导完成或在设置中开启后可用。",
          overall: "DISABLED",
        };
      }
      return registry.snapshot();
    },
  };
}

module.exports = {
  createControlPlane,
  CapabilityRegistry,
  CapabilityDiscovery,
  BrainManager,
  DependencySupervisor,
  RemoteCenter,
  FirstRunWizard,
  probeDockerInstalled,
  ...types,
};
