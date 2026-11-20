import { useToastStore } from '../state/toastStore';
import '../styles/toast.css';

export function ToastContainer() {
  const items = useToastStore((s) => s.items);
  const removeToast = useToastStore((s) => s.removeToast);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="toast-container">
      {items.map((item) => (
        <div key={item.id} className={`toast-item alert alert-${item.type} mb-0`}>
          <span className="toast-message">{item.message}</span>
          <button className="toast-close" onClick={() => removeToast(item.id)}>
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
