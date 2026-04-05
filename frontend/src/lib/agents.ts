import type { Agent, ConstitutionCategory, ConstitutionFact } from "./types";

export const CONSTITUTION_CATEGORIES: Array<{
  key: ConstitutionCategory;
  label: string;
  color: string;
}> = [
  { key: "code_ownership", label: "Code Ownership", color: "#e8e4dc" },
  { key: "expertise", label: "Expertise", color: "#e8e4dc" },
  { key: "collaboration", label: "Collaboration", color: "#e8e4dc" },
  { key: "current_focus", label: "Current Focus", color: "#39ff14" },
  { key: "known_issues", label: "Known Issues", color: "#e8e4dc" }
];

export function factsFor(agent: Agent | null | undefined, category: ConstitutionCategory): ConstitutionFact[] {
  if (!agent) return [];
  const grouped = agent.constitution?.[category];
  if (Array.isArray(grouped)) return grouped;
  return agent.constitution_facts?.filter((fact) => fact.category === category) ?? [];
}

export function factObjects(agent: Agent, category: ConstitutionCategory, max = 3): string[] {
  return factsFor(agent, category)
    .map((fact) => fact.object)
    .filter(Boolean)
    .slice(0, max);
}

export function collaborationBlurb(agent: Agent): string {
  return factsFor(agent, "collaboration")[0]?.object ?? "No collaboration preference indexed yet.";
}

export function shortRole(role: string): string {
  return role.length > 28 ? `${role.slice(0, 25)}...` : role;
}

export function coworkerName(agent: Agent): string {
  const source = agent.name || agent.github_username || "Developer";
  const rawBase = source.split(/[\s-]+/).find(Boolean) ?? source;
  const base = rawBase ? rawBase.charAt(0).toUpperCase() + rawBase.slice(1) : "Developer";
  return `${base}-AUBI`;
}

export function coworkerPossessiveName(agent: Agent): string {
  const source = agent.name || agent.github_username || "Developer";
  const rawBase = source.split(/[\s-]+/).find(Boolean) ?? source;
  const base = rawBase ? rawBase.charAt(0).toUpperCase() + rawBase.slice(1) : "Developer";
  return `${base}${base.toLowerCase().endsWith("s") ? "'" : "'s"} AUBI`;
}

export function humanSourceLabel(agent: Agent): string {
  return `for @${agent.github_username}`;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : ""))
    .filter(Boolean);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFact(fact: unknown): ConstitutionFact | null {
  if (!isRecord(fact)) return null;
  const category = stringValue(fact.category) as ConstitutionCategory;
  if (!category) return null;
  return {
    subject: stringValue(fact.subject),
    predicate: stringValue(fact.predicate),
    object: stringValue(fact.object),
    confidence: numberValue(fact.confidence),
    category,
  };
}

function normalizeFacts(value: unknown): ConstitutionFact[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeFact).filter((fact): fact is ConstitutionFact => Boolean(fact));
}

function factsFromConstitution(value: unknown): ConstitutionFact[] {
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(normalizeFacts);
}

function summaryFromFacts(facts: ConstitutionFact[]): Agent["github_data_summary"] {
  const metadata = facts.find((fact) => fact.category === "profile_metadata" && fact.predicate === "github_data_summary");
  if (!metadata) {
    return {
      commit_count: 0,
      pr_count: 0,
      top_files: [],
      languages: [],
      repos_considered: [],
      target_repos: [],
    };
  }

  try {
    const parsed: unknown = JSON.parse(metadata.object);
    const record = isRecord(parsed) ? parsed : {};
    return {
      commit_count: numberValue(record.commit_count),
      pr_count: numberValue(record.pr_count),
      top_files: stringArray(record.top_files),
      languages: stringArray(record.languages),
      repos_considered: stringArray(record.repos_considered),
      target_repos: stringArray(record.target_repos),
    };
  } catch {
    return {
      commit_count: 0,
      pr_count: 0,
      top_files: [],
      languages: [],
      repos_considered: [],
      target_repos: [],
    };
  }
}

function identityKey(agent: Agent): string {
  const subject = agent.constitution_facts?.find((fact) => fact.subject)?.subject;
  const value = agent.github_username || agent.name || subject || agent.id;
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function factKey(fact: ConstitutionFact): string {
  return [
    fact.category,
    fact.subject,
    fact.predicate,
    fact.object,
  ].join("|").toLowerCase();
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}

function groupFacts(facts: ConstitutionFact[]): Partial<Record<ConstitutionCategory, ConstitutionFact[]>> {
  return facts.reduce<Partial<Record<ConstitutionCategory, ConstitutionFact[]>>>((acc, fact) => {
    acc[fact.category] = [...(acc[fact.category] ?? []), fact];
    return acc;
  }, {});
}

function recordScore(agent: Agent): number {
  return (
    agent.constitution_facts.length * 10 +
    agent.github_data_summary.top_files.length * 3 +
    agent.github_data_summary.languages.length * 2 +
    agent.github_data_summary.commit_count +
    agent.github_data_summary.pr_count
  );
}

function mergeAgents(left: Agent, right: Agent): Agent {
  const primary = recordScore(right) > recordScore(left) ? right : left;
  const secondary = primary === left ? right : left;
  const factMap = new Map<string, ConstitutionFact>();
  [...secondary.constitution_facts, ...primary.constitution_facts].forEach((fact) => {
    factMap.set(factKey(fact), fact);
  });
  const facts = Array.from(factMap.values());

  return {
    ...primary,
    role: primary.role || secondary.role,
    name: primary.name || secondary.name,
    github_username: primary.github_username || secondary.github_username,
    constitution_facts: facts,
    constitution: groupFacts(facts),
    github_data_summary: {
      commit_count: Math.max(primary.github_data_summary.commit_count, secondary.github_data_summary.commit_count),
      pr_count: Math.max(primary.github_data_summary.pr_count, secondary.github_data_summary.pr_count),
      top_files: mergeStrings(primary.github_data_summary.top_files, secondary.github_data_summary.top_files),
      languages: mergeStrings(primary.github_data_summary.languages, secondary.github_data_summary.languages),
      repos_considered: mergeStrings(primary.github_data_summary.repos_considered ?? [], secondary.github_data_summary.repos_considered ?? []),
      target_repos: mergeStrings(primary.github_data_summary.target_repos ?? [], secondary.github_data_summary.target_repos ?? []),
    },
  };
}

export function normalizeAgent(agent: unknown): Agent {
  const record = isRecord(agent) ? agent : {};
  const summary = isRecord(record.github_data_summary) ? record.github_data_summary : {};
  const constitutionFacts = normalizeFacts(record.constitution_facts);
  const fallbackFacts = factsFromConstitution(record.constitution);
  const facts = constitutionFacts.length > 0 ? constitutionFacts : fallbackFacts;
  const inferredSummary = summaryFromFacts(facts);
  const githubUsername = stringValue(record.github_username, stringValue(record.name, "unknown"));
  const name = stringValue(record.name, githubUsername);
  const role = stringValue(record.role, "Software Engineer");

  return {
    id: stringValue(record.id, githubUsername),
    github_username: githubUsername,
    name,
    role,
    constitution_facts: facts,
    constitution: isRecord(record.constitution) ? record.constitution as Agent["constitution"] : undefined,
    github_data_summary: {
      commit_count: numberValue(summary.commit_count) || inferredSummary.commit_count,
      pr_count: numberValue(summary.pr_count) || inferredSummary.pr_count,
      top_files: stringArray(summary.top_files).length ? stringArray(summary.top_files) : inferredSummary.top_files,
      languages: stringArray(summary.languages).length ? stringArray(summary.languages) : inferredSummary.languages,
      repos_considered: stringArray(summary.repos_considered).length ? stringArray(summary.repos_considered) : inferredSummary.repos_considered,
      target_repos: stringArray(summary.target_repos).length ? stringArray(summary.target_repos) : inferredSummary.target_repos,
    }
  };
}

export function normalizeAgents(value: unknown): Agent[] {
  const agents = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.agents)
      ? value.agents
      : [];
  const byIdentity = new Map<string, Agent>();
  agents.map(normalizeAgent).forEach((agent) => {
    const key = identityKey(agent) || agent.id;
    const existing = byIdentity.get(key);
    byIdentity.set(key, existing ? mergeAgents(existing, agent) : agent);
  });
  return Array.from(byIdentity.values());
}
