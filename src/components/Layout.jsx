import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import shopConfig from '../config/shopConfig';

const navItems = [
  { to: '/inventory', label: 'Inventory' },
  { to: '/invoice', label: 'Invoice' },
  {
    label: 'Summary',
    children: [
      { to: '/summary', label: 'Inventory Summary' },
      { to: '/sales-summary', label: 'Sales Summary' }
    ]
  },
  { to: '/expenses', label: 'Ad-Hoc Expenses' },
  { to: '/customers', label: 'Customers' }
];

// Desktop-only dropdown for a nav item with children (e.g. "Summary").
function NavSubmenu({ item }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const isActive = item.children.some((c) => location.pathname.startsWith(c.to));

  useEffect(() => {
    function handleDocClick(e) {
      if (open && ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div className="nav-submenu-wrap" ref={ref}>
      <button
        type="button"
        className={`nav-submenu-trigger${isActive ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {item.label} <span style={{ fontSize: 12 }}>▾</span>
      </button>
      {open && (
        <div className="nav-submenu-panel">
          {item.children.map((c) => (
            <NavLink key={c.to} to={c.to} className={({ isActive: a }) => (a ? 'active' : '')} onClick={() => setOpen(false)}>
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

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
              item.children
                ? <NavSubmenu key={item.label} item={item} />
                : (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                    {item.label}
                  </NavLink>
                )
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
              item.children
                ? (
                  <div key={item.label} className="nav-submenu-group">
                    <span className="nav-submenu-heading">{item.label}</span>
                    {item.children.map((c) => (
                      <NavLink key={c.to} to={c.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                        {c.label}
                      </NavLink>
                    ))}
                  </div>
                )
                : (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                    {item.label}
                  </NavLink>
                )
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
