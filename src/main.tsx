import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './styles.css';
import './pixel-theme.css';
import './office-fit.css';
if (window.ahq) document.documentElement.dataset.desktop = 'true';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
