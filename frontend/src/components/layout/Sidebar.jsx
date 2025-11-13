// src/components/layout/Sidebar.jsx
import { NavLink } from "react-router-dom";
import {
  CalendarDays,
  LayoutDashboard,
  UploadCloud,
  LogOut,
} from "lucide-react";

const baseItem =
  "flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors";

const activeClasses = "bg-slate-900 text-white shadow-sm";
const inactiveClasses =
  "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";

export default function Sidebar({ onNavigate, onLogout }) {
  const makeClass = ({ isActive }) =>
    `${baseItem} ${isActive ? activeClasses : inactiveClasses}`;

  const handleNavClick = () => {
    onNavigate?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* main nav */}
      <nav className="space-y-1 flex-1">
        <NavLink
          to="/dashboard"
          className={makeClass}
          onClick={handleNavClick}
        >
          <LayoutDashboard className="h-4 w-4" />
          <span>Dashboard</span>
        </NavLink>

        <NavLink
          to="/meetings"
          className={makeClass}
          onClick={handleNavClick}
        >
          <CalendarDays className="h-4 w-4" />
          <span>Meetings</span>
        </NavLink>

        <NavLink
          to="/uploads"
          className={makeClass}
          onClick={handleNavClick}
        >
          <UploadCloud className="h-4 w-4" />
          <span>Uploads</span>
        </NavLink>
      </nav>

      {/* bottom logout */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 mt-4">
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                     text-sm font-medium text-red-500
                     hover:bg-red-50 dark:hover:bg-slate-900 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}
