import type { ReactNode } from 'react';
import type { SortDirection } from '../hooks/usePageTableState';

interface Props {
  label: ReactNode;
  field?: string;
  sortable?: boolean;
  sortField?: string;
  sortDirection?: SortDirection;
  onSort?: (field: string) => void;
}

export function SortableColumnHeader({
  label,
  field,
  sortable = false,
  sortField,
  sortDirection,
  onSort,
}: Props) {
  if (!sortable || !field) {
    return <th scope="col">{label}</th>;
  }

  const active = sortField === field;
  const direction = active ? sortDirection : undefined;
  const indicator = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕';

  return (
    <th scope="col">
      <button
        className={`sort-toggle${active ? ` active ${direction ?? ''}` : ''}`}
        type="button"
        onClick={() => onSort?.(field)}
      >
        <span>{label}</span>
        <span className="sort-indicator">{indicator}</span>
      </button>
    </th>
  );
}
