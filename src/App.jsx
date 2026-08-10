import React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import InventoryPage from "./pages/InventoryPage";
import InvoicePage from "./pages/InvoicePage";
import "./styles/app.css";

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <Navbar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<InventoryPage />} />
            <Route path="/invoice" element={<InvoicePage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
