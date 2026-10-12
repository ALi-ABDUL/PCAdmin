import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, CircleDot, Download, Image as ImageIcon, Loader2, Mail, Maximize2, MessageSquare, Reply, Send, TicketCheck } from "lucide-react";
import { API } from "../lib/api";
import { fmtLongDateTime } from "../lib/format";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const STATUSES = ["new", "open", "in_progress", "resolved", "closed"];
const statusLabel = (status) => ({ new: "New", open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed" }[status] || status);
const statusClass = (status) => ({ new: "chip-primary", open: "chip-warning", in_progress: "chip-primary", resolved: "chip-success", closed: "chip-neutral" }[status] || "chip-neutral");

export function SupportTickets({ initialTicketId, onTicketOpened }) {
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/support/tickets`);
      setGroups(data.customers || []);
      setExpanded((current) => Object.keys(current).length ? current : Object.fromEntries((data.customers || []).slice(0, 1).map((group) => [group.id, true])));
    } catch (error) { toast.error("Could not load support tickets", { description: error?.response?.data?.detail }); }
    finally { setLoading(false); }
  }, []);

  const openTicket = useCallback(async (ticketId) => {
    try {
      const { data } = await axios.get(`${API}/support/tickets/${ticketId}`);
      setSelected(data);
      setReply("");
      onTicketOpened?.();
      await load();
    } catch (error) { toast.error("Ticket not found", { description: error?.response?.data?.detail || "It may have been deleted." }); }
  }, [load, onTicketOpened]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (initialTicketId) openTicket(initialTicketId); }, [initialTicketId, openTicket]);

  const setStatus = async (status) => {
    if (!selected || status === selected.status) return;
    setSavingStatus(true);
    try {
      const { data } = await axios.patch(`${API}/support/tickets/${selected.id}/status`, { status });
      setSelected(data); await load(); toast.success(`Ticket marked ${statusLabel(status)}`);
    } catch (error) { toast.error("Could not update ticket", { description: error?.response?.data?.detail }); }
    finally { setSavingStatus(false); }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await axios.post(`${API}/support/tickets/${selected.id}/replies`, { body: reply.trim(), attachments: [] });
      setReply(""); await openTicket(selected.id); toast.success("Reply emailed and added to the ticket");
    } catch (error) { toast.error("Reply could not be sent", { description: error?.response?.data?.detail }); }
    finally { setSending(false); }
  };

  return <div className="grid xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] gap-5" data-testid="support-ticket-manager">
    <section className="border hairline rounded-lg bg-white overflow-hidden min-w-0" data-testid="support-ticket-groups">
      <div className="px-5 py-4 border-b hairline flex items-center justify-between"><div className="font-display font-bold flex items-center gap-2"><TicketCheck size={16}/> Customer tickets</div><button onClick={load} className="btn btn-ghost !p-2" title="Refresh tickets" data-testid="support-tickets-refresh"><CircleDot size={15}/></button></div>
      {loading && !groups.length ? <div className="p-10 text-center text-sm text-slate-500" data-testid="support-tickets-loading">Loading tickets…</div> : !groups.length ? <div className="p-10 text-center text-sm text-slate-500" data-testid="support-tickets-empty">No support tickets yet.</div> : <div className="divide-y hairline">{groups.map((group) => <CustomerTicketGroup key={group.id} group={group} expanded={!!expanded[group.id]} onToggle={() => setExpanded((current) => ({ ...current, [group.id]: !current[group.id] }))} selectedId={selected?.id} onOpen={openTicket}/>)}</div>}
    </section>
    <TicketPanel ticket={selected} reply={reply} setReply={setReply} sending={sending} savingStatus={savingStatus} onReply={sendReply} onStatus={setStatus} onPreview={setPreviewImage}/>
    <AttachmentLightbox image={previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}/>
  </div>;
}

function CustomerTicketGroup({ group, expanded, onToggle, selectedId, onOpen }) {
  return <section data-testid={`support-customer-group-${group.id}`}>
    <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors" data-testid={`support-customer-toggle-${group.id}`}>
      {expanded ? <ChevronDown size={15} className="text-slate-400"/> : <ChevronRight size={15} className="text-slate-400"/>}<div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate">{group.name || "Customer"}</div><div className="text-[11px] text-slate-500 font-mono truncate">{group.email || "no email"}</div></div>{group.open_count > 0 && <span className="chip chip-warning !text-[10px]" data-testid={`support-open-count-${group.id}`}>{group.open_count} open</span>}
    </button>
    {expanded && <div className="px-3 pb-3 grid gap-2">{group.tickets.map((ticket) => <button key={ticket.id} onClick={() => onOpen(ticket.id)} className={`border hairline rounded-lg p-3 text-left transition-colors ${selectedId === ticket.id ? "border-indigo-300 bg-indigo-50" : ticket.unread ? "bg-amber-50 border-amber-200 hover:bg-amber-100" : "bg-white hover:bg-slate-50"}`} data-testid={`support-ticket-card-${ticket.id}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-sm font-medium truncate">{ticket.subject}</div><div className="text-[11px] text-slate-500 mt-1">{fmtLongDateTime(ticket.last_message_at || ticket.created_at)}</div></div><span className={`chip !text-[10px] ${statusClass(ticket.status)}`} data-testid={`support-ticket-status-${ticket.id}`}>{statusLabel(ticket.status)}</span></div>{ticket.unread && <div className="text-[10px] mt-2 font-mono uppercase tracking-widest text-amber-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"/> New unread</div>}</button>)}</div>}
  </section>;
}

function TicketPanel({ ticket, reply, setReply, sending, savingStatus, onReply, onStatus, onPreview }) {
  if (!ticket) return <aside className="border hairline rounded-lg bg-slate-50 min-h-[480px] grid place-items-center text-center p-8" data-testid="support-ticket-empty-panel"><div><MessageSquare size={24} className="mx-auto text-slate-300 mb-3"/><div className="font-display font-bold text-slate-700">Select a ticket</div><div className="text-sm text-slate-500 mt-1">Customer conversation details will appear here.</div></div></aside>;
  return <aside className="border hairline rounded-lg bg-white min-w-0 flex flex-col max-h-[calc(100vh-12rem)] xl:sticky xl:top-6" data-testid="support-ticket-panel">
    <div className="p-5 border-b hairline"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-display font-bold text-lg truncate" data-testid="support-ticket-subject">{ticket.subject}</div><div className="text-xs text-slate-500 flex items-center gap-1 mt-1 truncate"><Mail size={11}/>{ticket.customer_name} · {ticket.customer_email || "no email"}</div></div><select value={ticket.status} onChange={(event) => onStatus(event.target.value)} disabled={savingStatus} className="input shrink-0 px-2 py-1.5 text-xs" data-testid="support-ticket-status-select">{STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></div></div>
    <div className="p-4 flex-1 overflow-y-auto space-y-3" data-testid="support-ticket-thread">{ticket.messages.map((message) => <ThreadMessage key={message.id} message={message} onPreview={onPreview}/>)}</div>
    <div className="p-4 border-t hairline bg-slate-50"><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply…" rows={4} className="input w-full px-3 py-2 text-sm resize-y" maxLength={5000} data-testid="support-ticket-reply-input"/><div className="flex items-center justify-between mt-2"><span className="text-[10px] text-slate-400 font-mono">{reply.length} / 5000</span><button onClick={onReply} disabled={sending || !reply.trim()} className="btn btn-primary text-sm disabled:opacity-50" data-testid="support-ticket-send-reply">{sending ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>} Send reply</button></div></div>
  </aside>;
}

function ThreadMessage({ message, onPreview }) {
  const outbound = message.direction === "outbound";
  return <div className={`flex ${outbound ? "justify-end" : "justify-start"}`} data-testid={`support-thread-message-${message.direction}`}><div className={`max-w-[88%] px-4 py-3 rounded-lg ${outbound ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800"}`}><div className={`text-[10px] font-mono uppercase tracking-widest ${outbound ? "text-indigo-200" : "text-slate-500"}`}>{outbound ? "You" : message.author_name || "Customer"} · {fmtLongDateTime(message.created_at)}</div><div className="text-sm leading-relaxed whitespace-pre-wrap mt-1">{message.body}</div>{(message.attachments || []).length > 0 && <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3" data-testid={`support-ticket-attachments-${message.id}`}>{message.attachments.map((url, index) => <div key={`${url}-${index}`} className="relative group border border-white/25 rounded overflow-hidden bg-black/10"><button onClick={() => onPreview({ url, index: index + 1 })} className="block w-full" title="View full-size image" data-testid={`support-ticket-attachment-preview-${message.id}-${index}`}><img src={url} alt={`Ticket attachment ${index + 1}`} className="w-full aspect-square object-cover transition-transform duration-200 group-hover:scale-105"/><span className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/30 transition-colors"><Maximize2 size={17} className="text-white opacity-0 group-hover:opacity-100 transition-opacity"/></span></button><a href={url} download target="_blank" rel="noopener noreferrer" title="Download image" className="absolute right-1.5 bottom-1.5 w-7 h-7 grid place-items-center bg-white/95 text-slate-800 rounded shadow-sm hover:bg-white transition-colors" data-testid={`support-ticket-attachment-download-${message.id}-${index}`}><Download size={14}/><span className="sr-only">Download attachment {index + 1}</span></a></div>)}</div>}</div></div>;
}

function AttachmentLightbox({ image, onOpenChange }) {
  return <Dialog open={!!image} onOpenChange={onOpenChange}><DialogContent closeTestId="support-attachment-lightbox-close" className="max-w-5xl w-[calc(100vw-2rem)] p-4 sm:p-6" data-testid="support-attachment-lightbox"><DialogHeader className="pr-8"><DialogTitle>Attachment preview</DialogTitle><DialogDescription>Full-size ticket image</DialogDescription></DialogHeader>{image && <div className="grid gap-3"><div className="bg-slate-950 rounded-lg overflow-hidden grid place-items-center max-h-[70vh]"><img src={image.url} alt={`Full-size ticket attachment ${image.index}`} className="max-h-[70vh] max-w-full object-contain" data-testid="support-attachment-lightbox-image"/></div><div className="flex justify-end"><a href={image.url} download target="_blank" rel="noopener noreferrer" className="btn btn-primary text-sm" data-testid="support-attachment-lightbox-download"><Download size={14}/> Download image</a></div></div>}</DialogContent></Dialog>;
}