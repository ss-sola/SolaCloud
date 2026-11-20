import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { useToastStore } from './shared/state/toastStore';
import { ErrorUtil } from './shared/utils/ErrorUtil';
import 'bootstrap/dist/css/bootstrap.min.css';
import './shared/styles/global.css';
import './modules/system/legacy/legacy-style.css';

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      onError: (error) => {
        useToastStore.getState().addToast('danger', ErrorUtil.getMessage(error, '操作失败'));
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>,
);
