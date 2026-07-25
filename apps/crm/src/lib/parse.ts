// Natural-language → structured CRM records, via the Railcode LLM global.

import { llm } from "@/lib/railcode";
import { STAGE_IDS, StageId } from "@/lib/crm";

export type ParsedCompany = {
  name: string;
  domain?: string;
  industry?: string;
};

export type ParsedContact = {
  name: string;
  email?: string;
  phone?: string;
  title?: string;
};

export type ParsedDeal = {
  title: string;
  value?: number;
  stage?: StageId;
};

export type ParsedCommand = {
  company?: ParsedCompany;
  contacts: ParsedContact[];
  deals: ParsedDeal[];
  note?: string;
};

// OpenAI strict structured-output requires every object to declare
// `additionalProperties: false` and a `required` array listing EVERY key in
// `properties`. Optional fields are expressed as nullable types, not omission.
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    company: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        domain: { type: ["string", "null"] },
        industry: { type: ["string", "null"] },
      },
      required: ["name", "domain", "industry"],
    },
    contacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
        },
        required: ["name", "email", "phone", "title"],
      },
    },
    deals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          value: { type: ["number", "null"] },
          // Nullable + enum breaks strict validators (Anthropic/Bedrock rejects
          // a union `type` combined with `enum`). Stage always has a value — the
          // system prompt defaults it to "new" — so keep it a scalar-typed,
          // non-nullable enum. coerce()'s stageOf() handles anything unexpected.
          stage: { type: "string", enum: [...STAGE_IDS] },
        },
        required: ["title", "value", "stage"],
      },
    },
    note: { type: ["string", "null"] },
  },
  required: ["company", "contacts", "deals", "note"],
} as const;

const SYSTEM = `You extract CRM records from a user's short natural-language request.
Return ONLY JSON matching the provided schema.

Rules:
- Extract a company, the people (contacts), and the deals/opportunities the user mentions. Only include entities actually mentioned.
- Normalize money to a plain number of US dollars: "$50k" -> 50000, "1.2M" -> 1200000, "twelve hundred" -> 1200. Use null if no value is mentioned.
- Choose deal stage from exactly: new, qualified, demo, closing, won, lost. If a deal is mentioned with no stage, use "new". "closed/signed/won" -> won; "lost/dead/passed" -> lost.
- Derive a company "domain" from an email address if present (e.g. jane@acme.com -> acme.com) and the company is otherwise unnamed.
- Put any free-form remark that isn't a field (e.g. "met at the conference", "follow up next week") into "note".
- Use null for any field you cannot determine. Do not invent emails, phones, or values.`;

function coerce(raw: unknown): ParsedCommand {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length ? t : undefined;
  };
  const num = (v: unknown): number | undefined => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9.]/g, ""));
      return Number.isNaN(n) || n === 0 ? undefined : n;
    }
    return undefined;
  };
  const stageOf = (v: unknown): StageId | undefined => {
    const s = str(v)?.toLowerCase();
    return s && (STAGE_IDS as string[]).includes(s) ? (s as StageId) : undefined;
  };

  const companyRaw = obj.company as Record<string, unknown> | null | undefined;
  const company =
    companyRaw && str(companyRaw.name)
      ? {
          name: str(companyRaw.name)!,
          domain: str(companyRaw.domain),
          industry: str(companyRaw.industry),
        }
      : undefined;

  const contacts: ParsedContact[] = Array.isArray(obj.contacts)
    ? (obj.contacts as Record<string, unknown>[])
        .filter((c) => str(c?.name))
        .map((c) => ({
          name: str(c.name)!,
          email: str(c.email),
          phone: str(c.phone),
          title: str(c.title),
        }))
    : [];

  const deals: ParsedDeal[] = Array.isArray(obj.deals)
    ? (obj.deals as Record<string, unknown>[])
        .filter((d) => str(d?.title))
        .map((d) => ({
          title: str(d.title)!,
          value: num(d.value),
          stage: stageOf(d.stage) ?? "new",
        }))
    : [];

  return { company, contacts, deals, note: str(obj.note) };
}

export async function parseCommand(text: string): Promise<ParsedCommand> {
  const result = await llm.generate(text, {
    system: SYSTEM,
    output: { type: "json", schema: schema as unknown as Record<string, unknown> },
    metadata: { feature: "command-bar", app: "crm" },
    temperature: 0,
    maxOutputTokens: 700,
  });

  let raw: unknown = result.output;
  if (raw == null || typeof raw === "string") {
    const text = typeof raw === "string" ? raw : result.text;
    try {
      raw = JSON.parse(extractJson(text));
    } catch {
      throw new Error("Could not understand that. Try rephrasing — e.g. \"Add Acme Corp, Jane Doe jane@acme.com, $40k deal\".");
    }
  }
  return coerce(raw);
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}
