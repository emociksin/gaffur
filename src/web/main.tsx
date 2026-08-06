import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from './App';
import { ToastProvider } from './ui';
import './styles.css';

// Urun/kategori sayfalari sunucuda tam HTML olarak uretilir. Bu sayfalarda
// React'in statik SEO icerigini silmesine izin verme; ana SPA normal calisir.
if (document.documentElement.dataset.gaffurSsr !== '1') {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>
  );
}
