import React from "react";
import { NavLink } from "react-router-dom";
import Logo from "./Logo";

export default function Navbar() {
  return (
    <header className="navbar">
      <Logo />
      <nav className="nav-links">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          Inventory
        </NavLink>
        <NavLink to="/invoice" className={({ isActive }) => (isActive ? "active" : "")}>
          Invoice
        </NavLink>
      </nav>
    </header>
  );
}
