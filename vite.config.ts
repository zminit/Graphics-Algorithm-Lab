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
            sendJson(response, 200, await listAll(userLabsRoot));
            return;
          }

          if (parts[1] === "blueprints") {
            await handleBlueprintRequest(method, parts, request, response, userLabsRoot);
            return;
          }

          if (parts[1] === "experiments") {
            await handleExperimentRequest(method, parts, request, response, userLabsRoot);
            return;
          }

          await handleLegacyLabRequest(method, parts, request, response, userLabsRoot);
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

async function handleBlueprintRequest(
  method: string,
  parts: string[],
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  root: string,
) {
  const id = parts[2];
  if (!id || !isSafeId(id)) {
    sendJson(response, 400, { error: "Invalid blueprint id." });
    return;
  }
  if (method === "GET" && parts.length === 3) {
    sendJson(response, 200, JSON.parse(await readFile(blueprintDocumentPath(root, id), "utf8")));
    return;
  }
  if (method === "PUT" && parts.length === 3) {
    const body = await readBody(request);
    await mkdir(path.dirname(blueprintDocumentPath(root, id)), { recursive: true });
    await writeFile(blueprintDocumentPath(root, id), body, "utf8");
    sendJson(response, 200, { ok: true });
    return;
  }
  const shaderFile = parts[4];
  if (parts.length === 5 && parts[3] === "shaders" && shaderFile && isSafeShader(shaderFile)) {
    if (method === "GET") {
      sendText(response, 200, await readFile(blueprintShaderPath(root, id, shaderFile), "utf8"));
      return;
    }
    if (method === "PUT") {
      const body = await readBody(request);
      await mkdir(path.dirname(blueprintShaderPath(root, id, shaderFile)), { recursive: true });
      await writeFile(blueprintShaderPath(root, id, shaderFile), body, "utf8");
      sendJson(response, 200, { ok: true });
      return;
    }
  }
  sendJson(response, 404, { error: "Unknown blueprint endpoint." });
}

async function handleExperimentRequest(
  method: string,
  parts: string[],
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  root: string,
) {
  const id = parts[2];
  if (!id || !isSafeId(id)) {
    sendJson(response, 400, { error: "Invalid experiment id." });
    return;
  }
  if (method === "GET" && parts.length === 3) {
    sendJson(response, 200, JSON.parse(await readFile(experimentDocumentPath(root, id), "utf8")));
    return;
  }
  if (method === "PUT" && parts.length === 3) {
    const body = await readBody(request);
    await mkdir(path.dirname(experimentDocumentPath(root, id)), { recursive: true });
    await writeFile(experimentDocumentPath(root, id), body, "utf8");
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: "Unknown experiment endpoint." });
}

async function handleLegacyLabRequest(
  method: string,
  parts: string[],
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  root: string,
) {
  const labId = parts[1];
  if (!labId || !isSafeId(labId)) {
    sendJson(response, 400, { error: "Invalid lab id." });
    return;
  }

  if (method === "GET" && parts.length === 2) {
    sendJson(response, 200, JSON.parse(await readFile(legacyLabDocumentPath(root, labId), "utf8")));
    return;
  }

  if (method === "PUT" && parts.length === 2) {
    const body = await readBody(request);
    await mkdir(path.dirname(legacyLabDocumentPath(root, labId)), { recursive: true });
    await writeFile(legacyLabDocumentPath(root, labId), body, "utf8");
    sendJson(response, 200, { ok: true });
    return;
  }

  const shaderFile = parts[3];
  if (parts.length === 4 && parts[2] === "shaders" && shaderFile && isSafeShader(shaderFile)) {
    if (method === "GET") {
      sendText(response, 200, await readFile(legacyShaderPath(root, labId, shaderFile), "utf8"));
      return;
    }
    if (method === "PUT") {
      const body = await readBody(request);
      await mkdir(path.dirname(legacyShaderPath(root, labId, shaderFile)), { recursive: true });
      await writeFile(legacyShaderPath(root, labId, shaderFile), body, "utf8");
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  sendJson(response, 404, { error: "Unknown user lab endpoint." });
}

function isSafeId(value: string) {
  return idPattern.test(value);
}

function isSafeShader(value: string) {
  return shaderPattern.test(value);
}

function legacyLabDocumentPath(root: string, labId: string) {
  return path.join(root, labId, "lab.json");
}

function legacyShaderPath(root: string, labId: string, shaderFile: string) {
  return path.join(root, labId, "shaders", shaderFile);
}

function blueprintDocumentPath(root: string, blueprintId: string) {
  return path.join(root, "blueprints", blueprintId, "blueprint.json");
}

function blueprintShaderPath(root: string, blueprintId: string, shaderFile: string) {
  return path.join(root, "blueprints", blueprintId, "shaders", shaderFile);
}

function experimentDocumentPath(root: string, experimentId: string) {
  return path.join(root, "experiments", experimentId, "lab.json");
}

async function listAll(root: string) {
  const [labs, blueprints, experiments] = await Promise.all([
    listLegacyLabs(root),
    listDocuments(path.join(root, "blueprints"), "blueprint.json", "user-labs/blueprints"),
    listDocuments(path.join(root, "experiments"), "lab.json", "user-labs/experiments"),
  ]);
  return { labs, blueprints, experiments };
}

async function listLegacyLabs(root: string) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const labs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeId(entry.name) || entry.name === "blueprints" || entry.name === "experiments") {
      continue;
    }
    const file = legacyLabDocumentPath(root, entry.name);
    try {
      const info = await stat(file);
      labs.push({ id: entry.name, path: `user-labs/${entry.name}/lab.json`, updatedAt: info.mtimeMs });
    } catch {
      // Ignore incomplete drafts without a lab.json.
    }
  }
  return labs;
}

async function listDocuments(root: string, documentName: string, publicRoot: string) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const docs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeId(entry.name)) {
      continue;
    }
    const file = path.join(root, entry.name, documentName);
    try {
      const info = await stat(file);
      docs.push({ id: entry.name, path: `${publicRoot}/${entry.name}/${documentName}`, updatedAt: info.mtimeMs });
    } catch {
      // Ignore incomplete drafts without a document.
    }
  }
  return docs;
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
