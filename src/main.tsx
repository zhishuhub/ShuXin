/**
 * React Application Entry Point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ShuxinApp } from './shuxin/ShuxinApp';
import './i18n';
import './styles/globals.css';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';

// 枢心接入开关打开时只渲染枢心的界面，ClawX 原界面代码保留不删
const Root = window.clawx?.shuxinManaged ? ShuxinApp : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Root />
    </HashRouter>
  </React.StrictMode>,
);
