import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const processes = [
  spawn(process.execPath, [path.resolve(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1"], {
    cwd: root,
    stdio: "inherit"
  }),
  spawn(process.execPath, [path.resolve(root, "server", "index.js")], {
    cwd: root,
    stdio: "inherit"
  })
];

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      for (const processToKill of processes) {
        if (processToKill !== child && !processToKill.killed) {
          processToKill.kill();
        }
      }
      process.exit(code);
    }
  });
}

process.on("SIGINT", () => {
  for (const child of processes) child.kill("SIGINT");
});
