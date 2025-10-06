import { useNavigate } from "react-router-dom";

export default function Profile({ user, onLogout }) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-purple-100 via-white to-indigo-100">
      <div className="bg-white shadow-lg rounded-2xl p-8 w-full max-w-md text-center">
        {/* Profile Picture */}
        <img
          src={user?.picture || "https://via.placeholder.com/100"}
          alt="profile"
          className="h-28 w-28 rounded-full mx-auto border-4 border-purple-400 shadow-md"
        />

        {/* User Info */}
        <h2 className="mt-4 text-2xl font-bold text-gray-800">
          {user?.name
            ? `${user.name} ${user.lastName || ""}`
            : user?.email || "User"}
        </h2>
        <p className="text-gray-500 mt-1">{user?.email}</p>

        {/* Buttons */}
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => alert("Edit profile feature coming soon 🚀")}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition"
          >
            Edit Profile
          </button>

          {/* Back to Dashboard Button */}
          <button
            onClick={() => navigate("/dashboard")}
            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
          >
            Back to Dashboard
          </button>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}