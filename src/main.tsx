import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './style.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

if (Capacitor.isNativePlatform()) {
  void CapApp.addListener('backButton', () => {
    // Handled in app modals or exit prompt
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
