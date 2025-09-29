// src/components/admin/AdminAnalytics.jsx
import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export default function AdminAnalytics() {
  const [users, setUsers] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const token = localStorage.getItem("token");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, meetingsRes] = await Promise.all([
          fetch(
            "https://ai-meeting-assistant-backend-suu9.onrender.com/api/users",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          ),
          fetch(
            "https://ai-meeting-assistant-backend-suu9.onrender.com/api/meetings",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          ),
        ]);

        if (!usersRes.ok || !meetingsRes.ok) {
          throw new Error("Failed to fetch data");
        }

        const usersData = await usersRes.json();
        const meetingsData = await meetingsRes.json();

        setUsers(usersData);
        setMeetings(meetingsData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

  // --- KPI Calculations ---
  const totalUsers = users.length;
  const totalMeetings = meetings.length;

  const activeUsers = users.filter((u) => {
    const lastLogin = u.last_login ? new Date(u.last_login) : null;
    if (!lastLogin) return false;
    const diff = (Date.now() - lastLogin.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  }).length;

  const avgDuration =
    meetings.reduce((sum, m) => sum + (m.duration || 0), 0) /
      (meetings.length || 1) || 0;

  // --- Chart Data ---
  // Users by signup month
  const usersByMonth = users.reduce((acc, u) => {
    const date = new Date(u.created_at || u.joined || Date.now());
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const userGrowthData = Object.entries(usersByMonth).map(([month, count]) => ({
    month,
    count,
  }));

  // Meetings by month
  const meetingsByMonth = meetings.reduce((acc, m) => {
    const date = new Date(m.timestamp);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const meetingsTrendData = Object.entries(meetingsByMonth).map(
    ([month, count]) => ({ month, count })
  );

  if (loading) return <div className="p-4">Loading analytics...</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold mb-4">Admin Analytics Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white shadow rounded-lg">
          <h3 className="text-gray-600">Total Users</h3>
          <p className="text-2xl font-bold">{totalUsers}</p>
        </div>
        <div className="p-4 bg-white shadow rounded-lg">
          <h3 className="text-gray-600">Active Users (7d)</h3>
          <p className="text-2xl font-bold">{activeUsers}</p>
        </div>
        <div className="p-4 bg-white shadow rounded-lg">
          <h3 className="text-gray-600">Total Meetings</h3>
          <p className="text-2xl font-bold">{totalMeetings}</p>
        </div>
        <div className="p-4 bg-white shadow rounded-lg">
          <h3 className="text-gray-600">Avg Duration (mins)</h3>
          <p className="text-2xl font-bold">{avgDuration.toFixed(1)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-4 shadow rounded-lg">
          <h3 className="mb-2 font-semibold">User Growth</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={userGrowthData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="count" stroke="#2563eb" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-4 shadow rounded-lg">
          <h3 className="mb-2 font-semibold">Meetings Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={meetingsTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" fill="#16a34a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Users */}
      <div className="bg-white p-4 shadow rounded-lg">
        <h3 className="mb-2 font-semibold">Recent Users</h3>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b">
              <th className="py-2">Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.slice(-5).map((u) => (
              <tr key={u._id} className="border-b">
                <td className="py-2">{u.email}</td>
                <td>{u.roles?.join(", ") || "user"}</td>
                <td>
                  {u.created_at
                    ? new Date(u.created_at).toLocaleDateString()
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent Meetings */}
      <div className="bg-white p-4 shadow rounded-lg">
        <h3 className="mb-2 font-semibold">Recent Meetings</h3>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b">
              <th className="py-2">Title</th>
              <th>Host</th>
              <th>Participants</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {meetings.slice(-5).map((m) => (
              <tr key={m.id} className="border-b">
                <td className="py-2">{m.title}</td>
                <td>{m.host}</td>
                <td>{m.participants?.length || 0}</td>
                <td>{new Date(m.timestamp).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
