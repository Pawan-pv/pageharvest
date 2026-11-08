import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PanelErrorBoundary } from '@/components/shell/PanelErrorBoundary';
import './style.css';

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <PanelErrorBoundary>
        <App />
      </PanelErrorBoundary>
    </React.StrictMode>
  );
}
