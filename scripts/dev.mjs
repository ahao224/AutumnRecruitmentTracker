import { spawn } from "node:child_process";

const api = spawn(process.execPath, ["server/local-api.mjs"], { stdio: "inherit" });
const site = process.platform === "win32"
  ? spawn("npm run dev:site", { stdio: "inherit", shell: true })
  : spawn("npm", ["run", "dev:site"], { stdio: "inherit" });

let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  api.kill("SIGTERM");
  site.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
api.on("exit", (code) => { if (!closing) stop(code || 0); });
site.on("exit", (code) => { if (!closing) stop(code || 0); });
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
