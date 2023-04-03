import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const rootElement = document.createElement('div');
rootElement.id = 'react-chrome-app';

const globalStyles = document.createElement('style');

rootElement.appendChild(globalStyles);
document.body.appendChild(rootElement);

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
