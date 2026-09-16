import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ModelPreference {
  id: string;
  guidance?: string;
}

export interface Definition {
  description: string;
  prompt: string;
  workers: string[];
  models: ModelPreference[];
}

export interface Config {
  default: string | null;
  agents: Record<string, Definition>;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function modelPreferences(value: unknown, field: string): ModelPreference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((item) => {
    const entry = typeof item === "string" ? { id: item } : item;
    if (!object(entry) || typeof entry.id !== "string" || !/^[^/\s]+\/\S+$/.test(entry.id)) {
      throw new Error(`${field} entries must contain a provider/model identifier`);
    }
    if (Object.keys(entry).some((key) => !["id", "guidance"].includes(key))) {
      throw new Error(`${field} entries only support id and guidance`);
    }
    if (entry.guidance !== undefined && (typeof entry.guidance !== "string" || !entry.guidance.trim())) {
      throw new Error(`${field}.guidance must be a non-empty string`);
    }
    return { id: entry.id, ...(entry.guidance === undefined ? {} : { guidance: entry.guidance as string }) };
  });
}

export function loadConfig(path: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { default: null, agents: {} };
    throw error;
  }
  if (!object(raw) || !object(raw.agents)) throw new Error("Expected an agents object");
  for (const key of Object.keys(raw)) {
    if (!["default", "agents"].includes(key)) throw new Error(`Unknown configuration field: ${key}`);
  }
  const agents: Record<string, Definition> = Object.create(null);
  for (const [name, value] of Object.entries(raw.agents)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || ["clear", "status"].includes(name)) {
      throw new Error(`Invalid or reserved agent name: ${name}`);
    }
    if (!object(value) || typeof value.prompt !== "string" || !value.prompt.trim()) {
      throw new Error(`${name}.prompt must be a Markdown file path`);
    }
    for (const key of Object.keys(value)) {
      if (!["description", "prompt", "workers", "models"].includes(key)) {
        throw new Error(`Unknown field ${name}.${key}; primary identities do not set models, thinking, or tools`);
      }
    }
    if (value.description !== undefined && typeof value.description !== "string") {
      throw new Error(`${name}.description must be a string`);
    }
    const models = modelPreferences(value.models, `${name}.models`);
    agents[name] = {
      description: value.description ?? "",
      prompt: resolve(dirname(path), value.prompt),
      workers: strings(value.workers, `${name}.workers`),
      models,
    };
  }
  const selected = raw.default ?? null;
  if (selected !== null && (typeof selected !== "string" || !Object.hasOwn(agents, selected))) {
    throw new Error("default must be null or a configured agent name");
  }
  return { default: selected, agents };
}

export function loadInstructions(definition: Definition): string {
  const text = readFileSync(definition.prompt, "utf8").trim();
  if (!text) throw new Error(`Empty primary-agent prompt: ${definition.prompt}`);
  return text;
}
