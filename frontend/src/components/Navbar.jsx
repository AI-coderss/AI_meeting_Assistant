import React, { useEffect, useRef, useState } from "react";
import "../styles/Navbar.css";

const LINKS = [
  { key: "live", label: "Live Meeting", href: "/live" },
  { key: "history", label: "Meetings History", href: "/history" },
];

export default function Navbar({
  brand = "AI Meeting Assistant",
  current = "live", // "live" | "history"
  onNavigate, // optional: (href) => void
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  const closeMenu = () => setOpen(false);
  const toggleMenu = () => setOpen((v) => !v);

  // Close on ESC
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking outside (mobile menu)
  useEffect(() => {
    const onClick = (e) => {
      if (!open) return;
      const menu = menuRef.current;
      const btn = buttonRef.current;
      if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
        closeMenu();
      }
    };
    window.addEventListener("pointerdown", onClick);
    return () => window.removeEventListener("pointerdown", onClick);
  }, [open]);

  const handleLink = (e, href) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(href);
      closeMenu();
    } else {
      // default anchor behavior; still close the menu for SPA routers that preventDefault elsewhere
      closeMenu();
    }
  };

  return (
    <header className={`napbar ${open ? "is-open" : ""}`}>
      <nav className="napbar__inner" aria-label="Primary">
        <div className="logoo">
          <a
            className="napbar__brand"
            href="/"
            onClick={(e) => onNavigate && (e.preventDefault(), onNavigate("/"))}
          >
            <span className="napbar__logo" aria-hidden="true">
              🤖
            </span>
            <span className="napbar__brandText">{brand}</span>
          </a>
        </div>
        {/* Desktop links */}
        <ul className="napbar__links">
          {LINKS.map((l, i) => (
            <li key={l.key} className="napbar__item">
              <a
                className={`napbar__link ${
                  current === l.key ? "is-active" : ""
                }`}
                href={l.href}
                onClick={(e) => handleLink(e, l.href)}
              >
                {l.label}
                <span className="napbar__underline" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>

        {/* Hamburger */}
        <button
          ref={buttonRef}
          className="napbar__hamburger"
          aria-label="Toggle menu"
          aria-expanded={open}
          aria-controls="napbar-mobile-menu"
          onClick={toggleMenu}
        >
          <span className="napbar__hamLine" />
          <span className="napbar__hamLine" />
          <span className="napbar__hamLine" />
        </button>
      </nav>

      {/* Mobile drawer */}
      <div
        id="napbar-mobile-menu"
        ref={menuRef}
        className="napbar__drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="napbar-mobile-title"
      >
        <div className="napbar__drawerHeader">
          <span id="napbar-mobile-title" className="napbar__drawerTitle">
            {brand}
          </span>
          <button
            className="napbar__drawerClose"
            onClick={closeMenu}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <ul className="napbar__drawerList">
          {LINKS.map((l, i) => (
            <li
              key={l.key}
              className="napbar__drawerItem"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <a
                className={`napbar__drawerLink ${
                  current === l.key ? "is-active" : ""
                }`}
                href={l.href}
                onClick={(e) => handleLink(e, l.href)}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Safe-area padding for iOS */}
        <div className="napbar__safePad" />
      </div>

      {/* Backdrop */}
      <div
        className="napbar__backdrop"
        onClick={closeMenu}
        aria-hidden="true"
      />
    </header>
  );
}
