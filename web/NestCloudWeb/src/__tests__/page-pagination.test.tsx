import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PagePagination } from '../modules/system/components/PagePagination';

describe('PagePagination', () => {
  it('uses the legacy table pagination container layout', () => {
    const { container } = render(
      <PagePagination
        page={2}
        pageSize={20}
        total={57}
        totalPages={3}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(container.firstChild).toHaveClass('table-pagination');
    expect(container.querySelector('.pagination-wrap')).toBeNull();
    expect(screen.getByText('每页条数')).toBeInTheDocument();
    expect(screen.getByText('共 57 条，第 2 / 3 页')).toBeInTheDocument();
  });
});
