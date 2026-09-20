const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const taskDir = __dirname;
const repoRoot = path.resolve(taskDir, "../../..");
const headPinPath = path.join(taskDir, "implementation-head.pin");

function resolveImplementationEvidence() {
  const head = execSync("git rev-parse HEAD", { encoding: "utf8", cwd: repoRoot }).trim();
  if (!fs.existsSync(headPinPath)) {
    console.error(
      "Missing implementation-head.pin — run node .trellis/tasks/09-19-dual-theme-ui-refactor/sync-implementation-head-pin.cjs",
    );
    process.exit(1);
  }
  const pinnedHead = fs.readFileSync(headPinPath, "utf8").trim();
  if (pinnedHead !== head) {
    console.error("implementation-head.pin mismatch", { head, pinnedHead });
    process.exit(1);
  }
  return { implementationSha: head, allApisMocked: true };
}

module.exports = { resolveImplementationEvidence, repoRoot, taskDir };
