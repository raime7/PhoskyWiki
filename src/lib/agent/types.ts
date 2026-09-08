export interface AgentSource {
  id: number;
  termId: number;
  type: "term" | "perspective";
  title: string;
  url: string;
  text: string;
}

export interface AgentContext {
  termId: number;
  sources: AgentSource[];
}
