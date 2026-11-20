interface Props {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

function getPageSizeOptions(pageSize: number) {
  return [10, 20, 50, pageSize]
    .filter((option) => Number.isFinite(option) && option > 0)
    .filter((option, index, list) => list.indexOf(option) === index)
    .sort((left, right) => left - right);
}

function getPaginationNumbers(currentPage: number, totalPages: number) {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, start + 4);
  const adjustedStart = Math.max(1, end - 4);
  return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index);
}

export function PagePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const normalizedPage = Math.max(page, 1);
  const normalizedTotalPages = Math.max(totalPages, 1);
  const pageNumbers = getPaginationNumbers(normalizedPage, normalizedTotalPages);
  const pageSizeOptions = getPageSizeOptions(pageSize);

  return (
    <div className="table-pagination">
      <div className="pagination-summary">
        共 {total} 条，第 {normalizedPage} / {normalizedTotalPages} 页
      </div>
      <div className="pagination-actions">
        <label className="toolbar-field pagination-page-size">
          <span>每页条数</span>
          <select
            className="form-select form-select-sm page-size-select"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-outline-secondary btn-sm"
          type="button"
          disabled={normalizedPage <= 1}
          onClick={() => onPageChange(Math.max(1, normalizedPage - 1))}
        >
          上一页
        </button>
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            className={`btn ${pageNumber === normalizedPage ? 'btn-success' : 'btn-outline-secondary'} btn-sm`}
            type="button"
            disabled={pageNumber === normalizedPage}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}
        <button
          className="btn btn-outline-secondary btn-sm"
          type="button"
          disabled={normalizedPage >= normalizedTotalPages}
          onClick={() => onPageChange(Math.min(normalizedTotalPages, normalizedPage + 1))}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
