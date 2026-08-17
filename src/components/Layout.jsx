import { useState, useRef, useEffect } from 'react';
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const visibleNavItems = navItems.filter((item) => (role === 'admin' ? true : item.to === '/invoice'));
  const avatarLabel = user?.displayName || user?.email || 'User';
  const avatarInitial = String(avatarLabel).trim().charAt(0).toUpperCase() || 'U';

  useEffect(() => {
    function handleDocClick(e) {
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('touchstart', handleDocClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('touchstart', handleDocClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [userMenuOpen]);

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
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-avatar-button"
                aria-label="User menu"
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                {user?.photoURL ? (
                  <img src={user.photoURL} alt={avatarLabel} />
                ) : (
                  <span className="user-avatar-fallback">{avatarInitial}</span>
                )}
              </button>

              {userMenuOpen && (
                <button
                  type="button"
                  className="logout-button user-menu-button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    signOut(auth);
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
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
