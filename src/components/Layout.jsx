import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import shopConfig from '../config/shopConfig';

const navItems = [
  { to: '/inventory', label: 'Inventory' },
  { to: '/invoice', label: 'Invoice' },
  { to: '/summary', label: 'Summary' },
  { to: '/customers', label: 'Customers' }
];

export default function Layout({ role, user }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleNavItems = navItems.filter((item) => (role === 'admin' ? true : item.to === '/invoice'));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <div className="brand">
            <img
              className="logo"
              src={shopConfig.logoPath}
              alt={shopConfig.shopName}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <span className="shop-name">{shopConfig.shopName}</span>
          </div>

          <nav className="app-nav app-nav-desktop">
            {visibleNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            {user?.email && <span className="user-email">{user.email}</span>}
            <button type="button" className="logout-button" onClick={() => signOut(auth)}>
              Sign out
            </button>
            <button
              type="button"
              className="menu-toggle"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="app-nav app-nav-mobile" onClick={() => setMenuOpen(false)}>
            {visibleNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
