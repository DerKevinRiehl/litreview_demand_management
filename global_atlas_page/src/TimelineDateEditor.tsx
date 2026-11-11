import { useRef, useState } from 'react';
import { displayDay, TIMELINE_MONTHS, TIMELINE_YEARS } from './timeline';
import type { DateEndpoint } from './timeline';

export function TimelineDateEditor({ endpoint, day, disabled, onBeginEdit, onChange }: {
  endpoint: DateEndpoint;
  day: number;
  disabled: boolean;
  onBeginEdit: () => void;
  onChange: (year: number, month: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLSelectElement>(null);
  const date = new Date(day * 86400000);
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const label = endpoint === 'from' ? 'From' : 'To';
  function beginEditing() {
    if (disabled) return;
    setEditing(true);
    onBeginEdit();
  }
  return (
    <div className={`date-editor ${editing ? 'is-editing' : ''}`} ref={editorRef}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') beginEditing(); }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && editorRef.current?.contains(active)) active.blur();
        setEditing(false);
      }}
      onFocusCapture={beginEditing}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          setEditing(false);
        }
      }}>
      <button type="button" className="date-readout" disabled={disabled}
        tabIndex={editing ? -1 : 0} aria-label={`Edit ${label} date: ${displayDay(day)}`}
        aria-expanded={editing} aria-controls={`timeline-${endpoint}-selectors`}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse') return;
          event.preventDefault();
          beginEditing();
          monthRef.current?.focus();
        }}
        onClick={() => { beginEditing(); monthRef.current?.focus(); }}>
        {displayDay(day)}
      </button>
      <div className="date-selectors" id={`timeline-${endpoint}-selectors`} aria-hidden={!editing}>
        <select aria-label={`${label} month`} ref={monthRef} value={month} disabled={disabled}
          tabIndex={editing ? 0 : -1} onChange={(event) => onChange(year, Number(event.target.value))}>
          {TIMELINE_MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select>
        <select aria-label={`${label} year`} value={year} disabled={disabled}
          tabIndex={editing ? 0 : -1} onChange={(event) => onChange(Number(event.target.value), month)}>
          {TIMELINE_YEARS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
    </div>
  );
}
