import React, { Suspense, lazy } from 'react';

import 'bootstrap/dist/css/bootstrap.min.css';
import './App.scss';

import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import Navigation from './components/Navigation/Navigation';

const Bookmarks = lazy(() => import('./pages/Bookmarks/Bookmarks'));
const Popup = lazy(() => import('./pages/Popup/Popup'));
const Options = lazy(() => import('./pages/Options/Options'));
const TradeHistory = lazy(() => import('./pages/TradeHistory/TradeHistory'));

function App() {
  if (window.location.search === '?page=popup') {
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <Popup />
      </Suspense>
    );
  }
  return (
    <Router>
      <Navigation />
      <div className="content">
        <Suspense fallback={<div>Loading...</div>}>
          <Routes>
            <Route path="options/" element={<Options />} />
            <Route path="bookmarks/" element={<Bookmarks />} />
            <Route path="trade-history/" element={<TradeHistory />} />
            <Route path="/index.html/" element={<Navigate to="options/general/" replace />} />
            <Route path="*" element={<Navigate to="options/general/" replace />} />
          </Routes>
        </Suspense>
      </div>
      {window.location.search === '?page=bookmarks' ? (
        <Navigate to="bookmarks/" />
      ) : null}
      {window.location.search === '?page=trade-history' ? (
        <Navigate to="trade-history/history" />
      ) : null}
    </Router>
  );
}

export default App;
