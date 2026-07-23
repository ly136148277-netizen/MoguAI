const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileUrl, getStatus } = require("../src/main/moguai/factory/debug-session");

describe("moguai factory debug-session helpers", () => {
  it("pathToFileUrl builds file URLs for windows paths", () => {
    const url = pathToFileUrl("D:\\proj\\a.js");
    assert.match(url, /^file:\/\/\//);
    assert.match(url, /D:\/proj\/a\.js$/i);
  });

  it("getStatus reports idle when no session", () => {
    const st = getStatus();
    assert.equal(st.ok, true);
    assert.equal(st.running, false);
  });
});
