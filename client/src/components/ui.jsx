import { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, UserCheck, UserPlus, UserRound, History, Ban } from 'lucide-react';
import { get, isValidMobile, fmtDate, fmtDateTime } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export function Field({ label, required, children, hint }) {
  return <label className="field"><span>{label}{required && <i>*</i>}</span>{children}{hint && <small style={{color:'var(--muted)',fontSize:10.5}}>{hint}</small>}</label>;
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-head"><b>{title}</b><button className="icon-btn" onClick={onClose}><X size={17}/></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- who created / last changed a record (CreatedBy / UpdatedBy / CancelledBy are stored in the database) ----------
const NOT_RECORDED = 'Not recorded (created before user tracking)';
export const hasAudit = (row) => !!row && ('CreatedBy' in row || 'CreatedByName' in row);
export function byTitle(row, verb = 'Created') {
  if (!row) return '';
  return [
    row.CreatedByName ? `${verb} by ${row.CreatedByName}${row.CreatedAt ? ` · ${fmtDateTime(row.CreatedAt)}` : ''}` : `${verb} by: ${NOT_RECORDED}`,
    row.UpdatedByName && `Last changed by ${row.UpdatedByName}${row.UpdatedAt ? ` · ${fmtDateTime(row.UpdatedAt)}` : ''}`,
    row.CancelledByName && `Cancelled by ${row.CancelledByName}${row.CancelledAt ? ` · ${fmtDateTime(row.CancelledAt)}` : ''}`,
  ].filter(Boolean).join('\n');
}
/** Strip shown in edit / view modals: Created by … · Last changed by … · Cancelled by … */
export function AuditInfo({ row, verb = 'Created' }) {
  if (!hasAudit(row)) return null;
  return (
    <div className="audit-info">
      <span><UserRound size={12} />{verb} by <b>{row.CreatedByName || 'not recorded'}</b>{row.CreatedAt && <em>{fmtDateTime(row.CreatedAt)}</em>}</span>
      {row.UpdatedByName && <span><History size={12} />Last changed by <b>{row.UpdatedByName}</b>{row.UpdatedAt && <em>{fmtDateTime(row.UpdatedAt)}</em>}</span>}
      {row.CancelledByName && <span className="cancelled"><Ban size={12} />Cancelled by <b>{row.CancelledByName}</b>{row.CancelledAt && <em>{fmtDateTime(row.CancelledAt)}</em>}</span>}
    </div>
  );
}
/** Table cell content: creator + date, everything else in the tooltip */
export function ByCell({ row }) {
  return <span className="by-cell" title={byTitle(row)}>{row.CreatedByName || <span className="muted">—</span>}{row.CreatedAt && <small>{fmtDateTime(row.CreatedAt)}</small>}{row.UpdatedByName && <small className="by-upd">edited by {row.UpdatedByName}</small>}</span>;
}

export function Toast({ msg, error }) {
  if (!msg) return null;
  return <div className={`toast ${error?'error':''}`}>{error ? <AlertCircle size={17}/> : <CheckCircle2 size={17}/>}{msg}</div>;
}

export function Empty({ icon: Icon, title, text, action }) {
  return <div className="empty"><span><Icon size={24}/></span><b>{title}</b><p>{text}</p>{action && <div style={{marginTop:14}}>{action}</div>}</div>;
}

export function SearchBox({ value, onChange, placeholder }) {
  return <div className="searchbox"><Search size={16} color="var(--muted)"/><input placeholder={placeholder||'Search...'} value={value} onChange={e=>onChange(e.target.value)}/></div>;
}

export function Pill({ tone='gray', children }) { return <span className={`pill ${tone}`}>{children}</span>; }

// Dynamic tone from status text (no hardcoded status list)
export function StatusPill({ status }) {
  const s = String(status||'').toLowerCase();
  let tone = 'gray';
  if (s.includes('paid') || s.includes('active') || s.includes('success') || s.includes('complete')) tone = 'green';
  else if (s.includes('pending') || s.includes('waiting')) tone = 'amber';
  else if (s.includes('cancel') || s.includes('expired') || s.includes('refund') || s.includes('inactive')) tone = 'red';
  else if (s.includes('process')) tone = 'blue';
  return <Pill tone={tone}>{status}</Pill>;
}

// ---------- Pagination ----------
// Page-size choices and the default come from AppSettings (pageSizeOptions / defaultPageSize); the user's pick is remembered.
const PAGE_SIZE_KEY = 'temple_page_size';
export function usePageSize() {
  const { config } = useAuth() || {};
  const options = (config?.pageSizeOptions?.length ? config.pageSizeOptions : [config?.defaultPageSize || 25]).map(Number);
  const fallback = Number(config?.defaultPageSize) || options[0];
  const [size, setSize] = useState(() => { const v = Number(localStorage.getItem(PAGE_SIZE_KEY)); return options.includes(v) ? v : fallback; });
  const set = (n) => { setSize(Number(n)); localStorage.setItem(PAGE_SIZE_KEY, String(n)); };
  return [size, set, options];
}

// Client-side paging for lists that are already loaded (masters, users, report rows). resetKey → back to page 1.
export function usePaged(rows, resetKey = '') {
  const [pageSize, setPageSize, options] = usePageSize();
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey, pageSize]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages); // a delete on the last page never leaves an empty page
  return { page: current, setPage, pageSize, setPageSize, options, total: rows.length, pageRows: rows.slice((current - 1) * pageSize, current * pageSize) };
}

export function Pager({ page, pageSize, total, setPage, setPageSize, options = [], noun = 'records' }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const go = (n) => setPage(Math.min(pages, Math.max(1, n)));
  return (
    <div className="pager">
      <span className="pager-info">{from}–{to} of {total.toLocaleString()} {noun}</span>
      {options.length > 1 && <label className="pager-size">Rows<select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{options.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      {pages > 1 && <div className="pager-nav">
        <button type="button" onClick={() => go(1)} disabled={page === 1} aria-label="First page"><ChevronsLeft size={14} /></button>
        <button type="button" onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={14} /></button>
        {nums.map((n, i) => <span key={n} className="pager-num">{i > 0 && n - nums[i - 1] > 1 && <i>…</i>}<button type="button" className={n === page ? 'on' : ''} onClick={() => go(n)}>{n}</button></span>)}
        <span className="pager-of">Page {page} / {pages}</span>
        <button type="button" onClick={() => go(page + 1)} disabled={page === pages} aria-label="Next page"><ChevronRight size={14} /></button>
        <button type="button" onClick={() => go(pages)} disabled={page === pages} aria-label="Last page"><ChevronsRight size={14} /></button>
      </div>}
    </div>
  );
}

// ---------- Devotee lookup by mobile number ----------
// Fires once the number matches the mobile pattern from settings; returns { status: idle|loading|found|new|error, data }
export function useDevoteeLookup(mobile, enabled = true) {
  const [state, setState] = useState({ status: 'idle', data: null });
  useEffect(() => {
    if (!enabled || !isValidMobile(mobile)) { setState({ status: 'idle', data: null }); return undefined; }
    let alive = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    const h = setTimeout(() => {
      get(`/devotees/lookup?mobile=${encodeURIComponent(mobile)}`)
        .then((d) => { if (alive) setState({ status: d.found ? 'found' : 'new', data: d }); })
        .catch(() => { if (alive) setState({ status: 'error', data: null }); });
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [mobile, enabled]);
  return state;
}

export function DevoteeHint({ lookup }) {
  const { status, data } = lookup;
  if (status === 'idle') return null;
  if (status === 'loading') return <span className="lookup-hint"><span className="spinner sm" /><span>Looking up devotee…</span></span>;
  if (status === 'error') return <span className="lookup-hint"><span>Lookup unavailable — enter the details</span></span>;
  if (status === 'new') return <span className="lookup-hint"><UserPlus size={12} /><span>New devotee — enter the details</span></span>;
  return (
    <span className="lookup-hint ok"><UserCheck size={12} /><span>Returning devotee · {data.visits} visit{data.visits === 1 ? '' : 's'}{data.lastVisit ? ` · last ${fmtDate(data.lastVisit)}` : ''}
      {data.member && <> <span className="pill amber" title={data.member.Status}>Member {data.member.MemberNumber}</span></>}</span></span>
  );
}
