import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const idPattern = /^[a-zA-Z0-9_-]+$/;
const shaderPattern = /^[a-zA-Z0-9_-]+\.wgsl$/;

function userLabsPlugin(): Plugin {
  const root = process.cwd();
  const userLabsRoot = path.resolve(root, "user-labs");

  return {
    name: "games-platform-user-labs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const method = request.method ?? "GET";
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const parts = url.pathname.split("/").filter(Boolean);

        if (parts[0] !== "__user_labs") {
          next();
          return;
        }

        try {
          if (method === "GET" && parts.length === 1) {
            const labs = await listLabs(userLabsRoot);
            sendJson(response, 200, labs);
            return;
          }

          const labId = parts[1];
          if (!labId || !isSafeId(labId)) {
            sendJson(response, 400, { error: "Invalid lab id." });
            return;
          }

          if (method === "GET" && parts.length === 2) {
            sendJson(response, 200, JSON.parse(await readFile(labDocumentPath(userLabsRoot, labId), "utf8")));
            return;
          }

          if (method === "PUT" && parts.length === 2) {
            const body = await readBody(request);
            await mkdir(path.dirname(labDocumentPath(userLabsRoot, labId)), { recursive: true });
            await writeFile(labDocumentPath(userLabsRoot, labId), body, "utf8");
            sendJson(response, 200, { ok: true });
            return;
          }

          const shaderFile = parts[3];
          if (parts.length === 4 && parts[2] === "shaders" && shaderFile && isSafeShader(shaderFile)) {
            if (method === "GET") {
              sendText(response, 200, await readFile(shaderPath(userLabsRoot, labId, shaderFile), "utf8"));
              return;
            }
            if (method === "PUT") {
              const body = await readBody(request);
              await mkdir(path.dirname(shaderPath(userLabsRoot, labId, shaderFile)), { recursive: true });
              await writeFile(shaderPath(userLabsRoot, labId, shaderFile), body, "utf8");
              sendJson(response, 200, { ok: true });
              return;
            }
          }

          sendJson(response, 404, { error: "Unknown user lab endpoint." });
        } catch (error) {
          const status = isNotFound(error) ? 404 : 500;
          sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [userLabsPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});

function isSafeId(value: string) {
  return idPattern.test(value);
}

function isSafeShader(value: string) {
  return shaderPattern.test(value);
}

function labDocumentPath(root: string, labId: string) {
  return path.join(root, labId, "lab.json");
}

function shaderPath(root: string, labId: string, shaderFile: string) {
  return path.join(root, labId, "shaders", shaderFile);
}

async function listLabs(root: string) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const labs = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeId(entry.name)) {
      continue;
    }
    const file = labDocumentPath(root, entry.name);
    try {
      const info = await stat(file);
      labs.push({ id: entry.name, path: `user-labs/${entry.name}/lab.json`, updatedAt: info.mtimeMs });
    } catch {
      // Ignore incomplete drafts without a lab.json.
    }
  }

  return { labs };
}

function readBody(request: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response: import("node:http").ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendText(response: import("node:http").ServerResponse, status: number, text: string) {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(text);
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
