import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Mail, Send, X } from "lucide-react";
import { API } from "../lib/api";

/**
 * Modal that lets an admin compose an email straight to a customer.
 * Posts to POST /api/customers/:id/message which routes through Resend.
 */
export function MessageCustomerDialog({ open, customer, replyTo = null, onClose, onSent }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Prefill "Re: …" and a quoted-original when replying to an inbound message.
    if (replyTo) {
      const rawSubj = (replyTo.subject || "").trim();
      const withRe = rawSubj && !/^re:/i.test(rawSubj) ? `Re: ${rawSubj}` : rawSubj || "Re: your message";
      setSubject(withRe);
      const quoted = (replyTo.body || "")
        .split(/\r?\n/)
        .map((l) => `> ${l}`)
        .join("\n");
      setBody(`\n\n---\nOn ${replyTo.created_at ? new Date(replyTo.created_at).toLocaleString() : ""} ${replyTo.customer_name || "you"} wrote:\n${quoted}`);
    } else {
      setSubject("");
      setBody("");
    }
    setSending(false);
  }, [open, replyTo]);

  if (!open || !customer) return null;

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Both subject and message are required");
      return;
    }
    setSending(true);
    try {
      const { data } = await axios.post(`${API}/customers/${customer.id}/message`, {
        subject: subject.trim(),
        body: body.trim(),
      });
      toast.success("Email sent", { description: `Delivered to ${data.to}` });
      onSent?.();
      onClose();
    } catch (e) {
      toast.error("Send failed", { description: e?.response?.data?.detail || "Please try again." });
    } finally { setSending(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
      data-testid="message-customer-dialog"
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b hairline">
          <div className="font-display font-bold flex items-center gap-2">
            <Mail size={15}/> Message customer
          </div>
          <button onClick={onClose} className="btn btn-ghost !p-1.5" data-testid="message-dialog-close" aria-label="Close">
            <X size={14}/>
          </button>
        </div>

        <div className="p-4 grid gap-3">
          <div className="text-xs text-slate-500 font-mono truncate">
            To: <span className="text-slate-800 font-bold">{customer.name}</span>{" "}
            &lt;{customer.email || "no email on file"}&gt;
          </div>
          <label className="block">
            <div className="text-xs font-medium text-slate-600 mb-1">Subject</div>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Following up on your order…"
              className="input w-full px-3 py-2 text-sm"
              autoFocus
              maxLength={140}
              data-testid="message-subject-input"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium text-slate-600 mb-1">Message</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi there,&#10;&#10;Just checking in — let me know if…"
              rows={7}
              className="input w-full px-3 py-2 text-sm leading-relaxed"
              maxLength={3000}
              data-testid="message-body-input"
            />
            <div className="text-[10px] text-slate-400 text-right mt-1 font-mono">
              {body.length} / 3000
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t hairline bg-slate-50">
          <button onClick={onClose} className="btn btn-ghost text-sm" data-testid="message-dialog-cancel">
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || !subject.trim() || !body.trim() || !customer.email}
            className="btn btn-primary text-sm"
            data-testid="message-dialog-send"
          >
            {sending ? <Loader2 className="animate-spin" size={13}/> : <Send size={13}/>} Send email
          </button>
        </div>
      </div>
    </div>
  );
}
