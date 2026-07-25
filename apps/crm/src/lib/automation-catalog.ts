// The automations this app offers.
//
// One entry per automation. Everything the Automations page renders — the row, its
// description, what it reads, how it's triggered — comes from here, so adding a
// second automation is an entry plus whatever agent it calls. Nothing about the page
// layout knows how many there are.

import { FileText, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AGENT_NAME, AUTOMATION_ID } from "@/lib/automations";

export type AutomationDef = {
  id: string;
  name: string;
  /** One line, shown on the collapsed row. */
  summary: string;
  icon: LucideIcon;
  /** How a run starts. Railcode has no event triggers, so be literal about it. */
  trigger: string;
  produces: string;
  /** Inputs, in the order the agent prioritises them. */
  reads: string[];
  /** The managed agent this automation invokes, or null for an in-page one. */
  agent: string | null;
  /** Whether it draws on the shared document setup (context, templates, files). */
  usesDocumentSetup: boolean;
  /** Whether a run picks between .docx and .pptx. */
  hasFormat: boolean;
};

export const AUTOMATION_CATALOG: AutomationDef[] = [
  {
    id: AUTOMATION_ID,
    name: "Generate a proposal for a deal",
    summary:
      "Writes a Word document or PowerPoint deck from the deal's meetings and files, in your own template.",
    icon: FileText,
    trigger: "The Generate button on a deal, or on a card in the pipeline board.",
    produces: "A .docx or .pptx attached to the deal, with a download link.",
    reads: [
      "The deal's meetings, newest first",
      "Files uploaded to the deal",
      "Your company context",
      "Workspace reference files",
      "Earlier documents on the same deal, for house structure",
    ],
    agent: AGENT_NAME,
    usesDocumentSetup: true,
    hasFormat: true,
  },
];

export function automationDef(id: string): AutomationDef | undefined {
  return AUTOMATION_CATALOG.find((a) => a.id === id);
}

/** Icon for the Automations nav entry and page header. */
export const AUTOMATIONS_ICON = Workflow;
