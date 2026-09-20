const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const taskDir = __dirname;
const repoRoot = path.resolve(taskDir, "../../..");
const head = execSync("git rev-parse HEAD", { encoding: "utf8", cwd: repoRoot }).trim();
const pinPath = path.join(taskDir, "implementation-head.pin");
fs.writeFileSync(pinPath, `${head}\n`, "utf8");
console.log(head);
