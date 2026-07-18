const { SkillRuntime } = require("./runtime");
const registry = require("./registry");

module.exports = {
  SkillRuntime,
  ...registry,
};
