import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './spike/spike.css';
import { SpikePage } from './spike/SpikePage';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <SpikePage />
  </StrictMode>,
);
