import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { resolveSafePath, ensureWorkspace } from "./sandbox";
import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";

const MCP_CONFIG_PATH = ".hlstudio/mcp.json";

export interface McpServerConfig {
  transport: "stdio" | "sse";
  command?: string; // pour stdio
  args?: string[]; // pour stdio
  url?: string; // pour sse
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

// État global des clients MCP
const mcpClients = new Map<string, Client>();
// Liste des secrets à masquer dans les logs (provenant des champs `env`)
const mcpSecrets = new Set<string>();

/**
 * Nettoie une chaîne de caractères en remplaçant tous les secrets connus par "***".
 */
export function sanitizeMcpLogs(text: string): string {
  let sanitized = text;
  for (const secret of mcpSecrets) {
    if (secret && secret.length > 3) { // Ne pas masquer des valeurs trop courtes
      // Échapper les caractères spéciaux pour le regex
      const escapedSecret = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      sanitized = sanitized.replace(new RegExp(escapedSecret, 'g'), "***");
    }
  }
  return sanitized;
}

/**
 * Charge la configuration MCP et connecte les serveurs de manière asynchrone.
 */
export async function connectMcpServers(): Promise<void> {
  // Déconnexion préalable si on recharge
  await disconnectMcpServers();
  
  await ensureWorkspace();
  const configPath = resolveSafePath(MCP_CONFIG_PATH);
  
  let config: McpConfig;
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(raw) as McpConfig;
  } catch (err) {
    // Si pas de fichier ou invalide, on ignore (dégradation propre)
    return;
  }

  if (!config.servers) return;

  const connectionPromises = Object.entries(config.servers).map(async ([name, srvConfig]) => {
    try {
      // Enregistrer les secrets
      if (srvConfig.env) {
        for (const val of Object.values(srvConfig.env)) {
          if (val) mcpSecrets.add(val);
        }
      }

      let transport;
      if (srvConfig.transport === "stdio") {
        if (!srvConfig.command) throw new Error("Paramètre 'command' manquant pour le transport stdio");
        transport = new StdioClientTransport({
          command: srvConfig.command,
          args: srvConfig.args || [],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
            ),
            ...srvConfig.env,
          }
        });
      } else if (srvConfig.transport === "sse") {
        if (!srvConfig.url) throw new Error("Paramètre 'url' manquant pour le transport sse");
        transport = new SSEClientTransport(new URL(srvConfig.url));
      } else {
        throw new Error(`Transport inconnu: ${srvConfig.transport}`);
      }

      const client = new Client({
        name: "hight-light-studio",
        version: "1.0.0",
      }, {
        capabilities: {}
      });

      // Timeout de 10s pour la connexion
      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Timeout de connexion (10s)")), 10_000)
      );
      
      await Promise.race([connectPromise, timeoutPromise]);
      
      mcpClients.set(name, client);
    } catch (err) {
      console.warn(`[MCP] Échec de la connexion au serveur "${name}":`, err);
    }
  });

  await Promise.all(connectionPromises);
}

/**
 * Récupère les outils de tous les serveurs MCP connectés et les formate
 * pour Anthropic.
 */
export async function getMcpTools(): Promise<Anthropic.Tool[]> {
  const tools: Anthropic.Tool[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    try {
      const response = await client.listTools();
      if (response.tools) {
        for (const tool of response.tools) {
          // Préfixer le nom pour éviter les collisions et identifier le serveur
          const prefixedName = `mcp__${serverName}__${tool.name}`;
          
          tools.push({
            name: prefixedName,
            description: `[MCP ${serverName}] ${tool.description || "Outil MCP externe"}`,
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
          });
        }
      }
    } catch (err) {
      console.warn(`[MCP] Échec de récupération des outils pour "${serverName}"`);
    }
  }
  
  return tools;
}

/**
 * Exécute un outil sur un serveur MCP distant.
 */
export async function executeMcpTool(serverName: string, toolName: string, args: any): Promise<string> {
  const client = mcpClients.get(serverName);
  if (!client) {
    throw new Error(`Serveur MCP "${serverName}" non connecté`);
  }

  try {
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    
    // Formater le résultat en string et nettoyer les credentials
    const output = JSON.stringify(result, null, 2);
    return sanitizeMcpLogs(output);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(sanitizeMcpLogs(errMsg));
  }
}

/**
 * Déconnecte tous les serveurs (à appeler en fin de session).
 */
export async function disconnectMcpServers(): Promise<void> {
  for (const [name, client] of mcpClients.entries()) {
    try {
      await client.close();
    } catch (err) {
      // Ignorer les erreurs de fermeture
    }
  }
  mcpClients.clear();
}
