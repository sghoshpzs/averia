import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { auth } from './firebase';
import Layout from './components/Layout';
import InventoryPage from './pages/InventoryPage';
import InvoicePage from './pages/InvoicePage';
import SummaryPage from './pages/SummaryPage';
import SalesSummaryPage from './pages/SalesSummaryPage';
import CustomersPage from './pages/CustomersPage';
import ExpensesPage from './pages/ExpensesPage';

const adminEmails = String(import.meta.env.VITE_ALLOWED_ADMINS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const workerEmails = String(import.meta.env.VITE_ALLOWED_WORKERS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function getUserRole(email) {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();
  if (adminEmails.includes(normalized)) return 'admin';
  if (workerEmails.includes(normalized)) return 'worker';
  return null;
}

const routeAccess = {
  '/inventory': ['admin'],
  '/invoice': ['admin', 'worker'],
  '/summary': ['admin'],
  '/sales-summary': ['admin'],
  '/customers': ['admin'],
  '/expenses': ['admin']
};

// True when running as an installed home-screen PWA (Android's manifest
// "display": "standalone", or iOS's older equivalent) rather than a normal
// browser tab — see handleGoogleLogin's comment for why that changes which
// sign-in method is safe to use.
function isStandaloneDisplayMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function LoginScreen({ onGoogleLogin, loading, error }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">Averia Jewellers</div>
        {error && <p className="auth-error">{error}</p>}
        <button type="button" className="auth-button" onClick={onGoogleLogin} disabled={loading}>
          {loading ? 'Signing in…' : 'Continue with Google'}
        </button>
      </div>
    </div>
  );
}

function AccessDeniedScreen({ userEmail, onSignOut }) {
  return (
    <div className="auth-shell">
      <div className="auth-card access-card">
        <div className="auth-brand">Access denied</div>
        <h1>Unauthorized user</h1>
        <p className="muted">
          {userEmail ? `Signed in as ${userEmail}` : 'This account is not authorized for this application.'}
        </p>
        <p className="muted">Only approved admin and worker accounts can access the app.</p>
        <button type="button" className="auth-button secondary" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Picks up the result of a signInWithRedirect once the browser navigates
  // back from Google. Runs once on mount, before/alongside onAuthStateChanged.
  // This is also where redirect-specific errors surface (popup errors used to
  // reject the signInWithPopup promise directly; redirect errors only show up
  // here, after the round trip completes).
  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      setLoginError(err.message || 'Google login failed. Please try again.');
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  async function handleGoogleLogin() {
    setLoginLoading(true);
    setLoginError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (isStandaloneDisplayMode()) {
        // signInWithRedirect hangs forever on "Loading…" when launched from
        // an installed home-screen PWA on Android: the round trip to Google
        // and back can land in a browsing context whose storage isn't the
        // same one the standalone window persisted its pending sign-in state
        // to, so getRedirectResult() below never finds anything. A popup
        // stays in the same window/storage the whole time, so it doesn't
        // have this problem — use it only in standalone mode, where it's
        // also not subject to the mobile popup-blocker issues that made
        // redirect the right choice for normal browser tabs (see below).
        await signInWithPopup(auth, provider);
        setLoginLoading(false);
      } else {
        // Navigates the whole page to Google's sign-in flow, then back to
        // this app's URL. Nothing to await here for the "success" case — the
        // app reloads and onAuthStateChanged/getRedirectResult pick it up
        // above.
        await signInWithRedirect(auth, provider);
      }
    } catch (err) {
      setLoginError(err.message || 'Google login failed. Please try again.');
      setLoginLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
  }

  if (authLoading) {
    return <div className="auth-shell"><div className="auth-card"><h1>Loading…</h1></div></div>;
  }

  if (!user) {
    return <LoginScreen onGoogleLogin={handleGoogleLogin} loading={loginLoading} error={loginError} />;
  }

  const role = getUserRole(user.email);
  if (!role) {
    return <AccessDeniedScreen userEmail={user.email} onSignOut={handleSignOut} />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout role={role} user={user} />}>
          <Route index element={<Navigate to="/invoice" replace />} />
          <Route path="/inventory" element={routeAccess['/inventory'].includes(role) ? <InventoryPage /> : <AccessDeniedScreen userEmail={user.email} onSignOut={handleSignOut} />} />
          <Route path="/invoice" element={routeAccess['/invoice'].includes(role) ? <InvoicePage /> : <AccessDeniedScreen userEmail={user.email} onSignOut={handleSignOut} />} />
          <Route path="/summary" element={routeAccess['/summary'].includes(role) ? <SummaryPage /> : <AccessDeniedScreen userEmail={user.email} onSignOut={handleSignOut} />} />
          <Route path="/sales-summary" element={routeAccess['/sales-summary'].includes(role) ? <SalesSummaryPage /> : <AccessDeniedScreen userEmail={user.email} onSignOut={handleSignOut} />} />
          <Route path="/customers" element={routeAccess['/customers'].includes(role) ? <CustomersPage /> : <AccessDeniedScreen userEmail={user.email} onSignOut={handleSignOut} />} />
          <Route path="/expenses" element={routeAccess['/expenses'].includes(role) ? <ExpensesPage /> : <AccessDeniedScreen userEmail={user.email} onSignOut={handleSignOut} />} />
          <Route path="*" element={<Navigate to="/invoice" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}