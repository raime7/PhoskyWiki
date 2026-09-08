import type { AgentConfig } from "./client";

const storageKey = "phoskywiki.agent.config";
const changedEvent = "phoskywiki-agent-config-changed";
export const emptyConfig: AgentConfig = { baseURL: "", key: "", model: "" };

export function readAgentConfig(): string {
  try { return localStorage.getItem(storageKey) ?? ""; }
  catch { return ""; }
}

export function parseAgentConfig(raw: string): AgentConfig {
  try {
    const value = JSON.parse(raw);
    if (typeof value?.baseURL === "string" && typeof value.key === "string" && typeof value.model === "string") return value;
  } catch { /* 无配置或损坏的本地数据：显示空表单。 */ }
  return emptyConfig;
}

export function saveAgentConfig(config: AgentConfig | null) {
  if (config) localStorage.setItem(storageKey, JSON.stringify(config));
  else localStorage.removeItem(storageKey);
  window.dispatchEvent(new Event(changedEvent));
}

export function subscribeAgentConfig(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changedEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changedEvent, callback);
  };
}

export function serverAgentConfig() { return ""; }
