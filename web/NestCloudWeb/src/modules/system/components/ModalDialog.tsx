import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  size?: 'sm' | 'lg' | 'xl';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function ModalDialog({ open, title, size, onClose, footer, children }: Props) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="modal fade show d-block" role="dialog" aria-modal="true">
        <div
          className={`modal-dialog modal-dialog-scrollable${size ? ` modal-${size}` : ''}`}
          style={{ margin: '0 auto' }}
        >
          <div className="modal-content" style={{ height: '95vh' }}>
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" aria-label="关闭" onClick={onClose} />
            </div>
            <div className="modal-body modal-body-noscroll">{children}</div>
            {footer ? <div className="modal-footer">{footer}</div> : null}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" onClick={onClose} />
    </>
  );
}
