// src/components/FloatingBackButton.jsx
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function FloatingBackButton() {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(-1)}
      title="Go back"
      className="
        fixed bottom-5 left-4 sm:bottom-6 sm:left-6 
        z-50 
        h-12 w-12 
        flex items-center justify-center 
        rounded-full 
        shadow-xl 
        bg-white/90 dark:bg-slate-900/90 
        border border-slate-200 dark:border-slate-700
        hover:bg-slate-100 dark:hover:bg-slate-800 
        text-slate-700 dark:text-slate-200
        transition
      "
    >
      <ArrowLeft size={22} />
    </button>
  );
}