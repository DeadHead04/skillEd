// A real filesystem MCP service, used to exercise transport and provisioning.
// It performs every requested read/write on disk; there are no response fixtures.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
export function filesystemService(root: string): Server {
  const server = new Server(
    { name: "skilled-real-filesystem-service", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "write_file",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      {
        name: "read_file",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {},
      file = path.resolve(root, String(args.path));
    if (!file.startsWith(path.resolve(root) + path.sep))
      throw new Error("path outside service root");
    if (request.params.name === "write_file") {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, String(args.content));
      return {
        content: [{ type: "text", text: "wrote " + String(args.path) }],
      };
    }
    if (request.params.name === "read_file")
      return {
        content: [{ type: "text", text: await readFile(file, "utf8") }],
      };
    throw new Error("unknown tool");
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = process.env.SKILLED_MCP_ROOT;
  if (!root) throw new Error("SKILLED_MCP_ROOT required");
  await filesystemService(root).connect(new StdioServerTransport());
}
