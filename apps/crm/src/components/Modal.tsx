import { X } from "lucide-react";
import { ReactNode, useEffect } from "react";

/**
 * The shell every dialog in the app shares — same panel, shadow and close
 * affordance as the Granola importer, without each caller re-deriving it.
 *
 * Mousedown on the scrim closes; mousedown inside stops there, so a drag that
 * starts on text and ends outside doesn't dismiss the dialog mid-selection.
 */
export function Modal({
  title,
  subtitle,
  icon,
  width = 640,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  width?: number;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="cmdoverlay" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalhead">
          {icon ? <span className="modalicon">{icon}</span> : null}
          <div className="ttl">
            <h3>{title}</h3>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="modalbody">{children}</div>

        {footer ? <div className="modalfoot">{footer}</div> : null}
      </div>
    </div>
  );
}
