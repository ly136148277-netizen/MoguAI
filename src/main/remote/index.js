"use strict";

const { RemoteManager } = require("./RemoteManager");
const { RemoteGateway, inferCapability } = require("./RemoteGateway");
const { RemoteTaskSource } = require("./RemoteTaskSource");
const { RemoteTaskQueue, progressBar } = require("./RemoteTaskQueue");
const { RemotePermission } = require("./permission/RemotePermission");
const { TelegramAdapter } = require("./adapters/TelegramAdapter");
const { QQAdapter } = require("./adapters/QQAdapter");
const { WeChatAdapter } = require("./adapters/WeChatAdapter");
const types = require("./RemoteTypes");
const policy = require("./remote-policy");

module.exports = {
  RemoteManager,
  RemoteGateway,
  RemoteTaskSource,
  RemoteTaskQueue,
  RemotePermission,
  TelegramAdapter,
  QQAdapter,
  WeChatAdapter,
  progressBar,
  inferCapability,
  ...policy,
  ...types,
};
