import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { ping, logout as apiLogout } from "../api";

export default function Dashboard({ user, onLogout }) {
  const navigate = useNavigate();
  useEffect(() => {
    ping().then(console.log).catch(console.error);
  }, []);

  const handleLogout = async () => {
    try { await apiLogout(); } catch(e) { console.warn(e); }
    finally { onLogout(); }
  };
  
  const meetings = [
    { title: "Project Kickoff", date: "Apr 20" },
    { title: "Team Sync", date: "Apr 18" },
    { title: "Team Sync", date: "Apr 15" },
    { title: "Client Call", date: "Apr 12" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-r from-purple-100 via-white to-indigo-100">
      {/* Top Header */}
      <header className="flex justify-between items-center px-6 py-4 bg-white shadow">
        <h1 className="text-2xl font-bold text-purple-700">AI Summariser</h1>

        {/* Profile Section */}
        <div
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition"
          onClick={() => navigate("/profile")}
        >
          <img
            src={user?.picture || "https://via.placeholder.com/40"}
            alt="profile"
            className="h-10 w-10 rounded-full object-cover border-2 border-purple-400"
          />
          <span className="font-medium text-gray-700">
            {user?.email}
          </span>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1">
        {/* Left Sidebar */}
        <aside className="w-1/5 bg-white shadow-md p-4">
          <h2 className="text-xl font-bold mb-4 text-purple-700">Meetings</h2>
          <ul className="space-y-3">
            {meetings.map((m, i) => (
              <li
                key={i}
                className="p-3 rounded-lg cursor-pointer bg-purple-50 hover:bg-purple-100 hover:shadow-md transition"
              >
                <p className="font-medium">{m.title}</p>
                <p className="text-sm text-gray-500">{m.date}</p>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 space-y-6">
          {/* Top Summary Cards */}
          <div className="grid grid-cols-3 gap-6">
            {["Key Points", "Decisions", "Q&A"].map((title, i) => (
              <div
                key={i}
                className="p-6 bg-white rounded-xl shadow hover:shadow-xl hover:-translate-y-1 transition transform border-t-4 border-purple-400"
              >
                <h3 className="font-semibold text-purple-600 mb-2">{title}</h3>
                <p className="text-gray-600 text-sm">
                  {title === "Key Points" && "Point 1\nPoint 2"}
                  {title === "Decisions" && "Decision 1\nDecision 2"}
                  {title === "Q&A" && "Quick summary of Q&A..."}
                </p>
              </div>
            ))}
          </div>

          {/* Q&A Chatbot */}
          <div className="p-6 bg-white rounded-xl shadow hover:shadow-xl transition transform hover:-translate-y-1">
            <h3 className="font-semibold text-purple-600 mb-4">Q&A Chatbot</h3>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ask something..."
                className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
              />
              <button className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition">
                Send
              </button>
            </div>
            <div className="mt-4 text-sm text-gray-700">
              <p><b>You:</b> What are my tasks?</p>
              <p><b>Bot:</b> 1. Prepare project plan <br /> 2. Review budget proposal</p>
            </div>
          </div>

          {/* Calendar Suggestions */}
          <div className="p-6 bg-white rounded-xl shadow hover:shadow-xl transition transform hover:-translate-y-1">
            <h3 className="font-semibold text-purple-600 mb-3">Calendar Suggestions</h3>
            <p className="text-gray-700 mb-4">Follow-up meeting on Friday at 10AM</p>
            <div className="flex gap-3">
              <button className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition">
                Accept
              </button>
              <button className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition">
                Decline
              </button>
              <button className="px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition">
                Add Manually
              </button>
            </div>
          </div>
        </main>

        {/* Right Sidebar */}
        <aside className="w-1/5 bg-white shadow-md p-4">
          <h2 className="text-xl font-bold text-purple-700 mb-4">Extra Panel</h2>
          <ul className="space-y-2 text-gray-600 text-sm">
            <li>- Notifications</li>
            <li>- Meeting participants</li>
            <li>- Action items list</li>
            <li>- AI tips & insights</li>
          </ul>

          <button
            onClick={handleLogout}
            className="mt-6 w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
          >
            Logout
          </button>
        </aside>
      </div>
    </div>
  );
}