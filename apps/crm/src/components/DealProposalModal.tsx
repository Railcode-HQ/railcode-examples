import { AlertTriangle, Building2, Sparkles, Tag, Users } from "lucide-react";

import { Modal } from "@/components/Modal";
import { ProposalSpinner } from "@/components/MeetingTriage";
import { SearchSelect } from "@/components/SearchSelect";
import { STAGES, StageId, formatMoney } from "@/lib/crm";
import { useTriageStore } from "@/store/triage-store";

/**
 * The confirmation gate for "create deal from meeting".
 *
 * The model proposes; a person commits. That split is deliberate — this one click
 * writes a company, one or more contacts, a deal and a call note, which is more than
 * anything else in the app does unattended, and a wrong company here quietly pollutes
 * the pipeline. Everything shown is editable before it's saved.
 */
export function DealProposalModal() {
  const {
    proposalFor,
    proposal,
    proposing,
    creating,
    proposalError,
    closeProposal,
    editProposal,
    confirmProposal,
  } = useTriageStore();

  if (!proposalFor) return null;

  return (
    <Modal
      title="Create deal from meeting"
      subtitle={proposalFor.title}
      icon={<Sparkles size={16} />}
      width={620}
      onClose={closeProposal}
      footer={
        <>
          <span className="faint" style={{ fontSize: 11.5 }}>
            {proposal
              ? "Creates a company, its people, the deal, and this meeting as its first note."
              : ""}
          </span>
          <div className="spacer" />
          <button className="btn ghost" onClick={closeProposal} disabled={creating}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => void confirmProposal()}
            disabled={!proposal || creating || !proposal.dealTitle.trim()}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      {proposalError ? <div className="banner">{proposalError}</div> : null}

      {proposing ? (
        <ProposalSpinner label="Reading the meeting…" />
      ) : proposal ? (
        <div className="proposal">
          {!proposal.isClientMeeting ? (
            <div className="warnbar">
              <AlertTriangle size={14} />
              <span>
                This looks like an internal meeting rather than a client call
                {proposal.reasoning ? ` — ${proposal.reasoning}` : ""}. Create it anyway
                if that's wrong.
              </span>
            </div>
          ) : null}

          <div className="field">
            <span className="l">
              <Tag size={13} /> Deal
            </span>
            <input
              className="input"
              value={proposal.dealTitle}
              placeholder="Deal title"
              onChange={(e) => editProposal({ dealTitle: e.target.value })}
            />
          </div>

          <div className="proposalgrid">
            <div className="field">
              <span className="l">Value</span>
              <input
                className="input"
                inputMode="numeric"
                value={proposal.value ?? ""}
                placeholder="Not discussed"
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9.]/g, "");
                  editProposal({ value: digits ? Number(digits) : undefined });
                }}
              />
              {proposal.value ? (
                <span className="faint" style={{ fontSize: 11 }}>
                  {formatMoney(proposal.value)}
                </span>
              ) : null}
            </div>
            <div className="field">
              <span className="l">Stage</span>
              <SearchSelect
                clearLabel={null}
                value={proposal.stage}
                options={STAGES.map((s) => ({ value: s.id, label: s.label, dot: s.tone }))}
                onChange={(v) => editProposal({ stage: v as StageId })}
              />
            </div>
          </div>

          <div className="field">
            <span className="l">
              <Building2 size={13} /> Company
            </span>
            <input
              className="input"
              value={proposal.companyName}
              placeholder="Company name"
              onChange={(e) =>
                // Typing a different name means this is no longer the matched record,
                // so drop the link rather than renaming someone else's company.
                editProposal({ companyName: e.target.value, companyId: undefined })
              }
            />
            <span className="faint" style={{ fontSize: 11 }}>
              {proposal.companyId
                ? "Links to the company you already have."
                : "Will be created."}
              {proposal.domain ? ` · ${proposal.domain}` : ""}
            </span>
          </div>

          <div className="field">
            <span className="l">
              <Users size={13} /> People
            </span>
            {proposal.contacts.length ? (
              <div className="rows proposalpeople">
                {proposal.contacts.map((c, i) => (
                  <div className="crow" key={`${c.email ?? c.name}-${i}`}>
                    <div className="body">
                      <div className="cname" style={{ fontSize: 12.5 }}>
                        {c.name}
                        {c.existingId ? <span className="badge">Existing</span> : null}
                      </div>
                      <div className="meta">
                        {[c.title, c.email].filter(Boolean).join(" · ") || "No details"}
                      </div>
                    </div>
                    <button
                      className="link"
                      onClick={() =>
                        editProposal({
                          contacts: proposal.contacts.filter((_, idx) => idx !== i),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <span className="faint" style={{ fontSize: 12 }}>
                Nobody external was identified on this call.
              </span>
            )}
          </div>

          {proposal.summary ? (
            <div className="field">
              <span className="l">Summary</span>
              <textarea
                className="textarea"
                style={{ minHeight: 72 }}
                value={proposal.summary}
                onChange={(e) => editProposal({ summary: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
