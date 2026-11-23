import React from 'react';
import ReactDOM from 'react-dom/client';
import { TableWorkbenchApp } from './TableWorkbenchApp';
import { PanelErrorBoundary } from '@/components/shell/PanelErrorBoundary';
import './style.css';

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <PanelErrorBoundary>
        <TableWorkbenchApp />
      </PanelErrorBoundary>
    </React.StrictMode>
  );
}
