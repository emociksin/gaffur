import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from './App';
import { ToastProvider } from './ui';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
