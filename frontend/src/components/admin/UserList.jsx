// src/components/UserList.jsx
import React, { useEffect, useState } from "react";
import Swal from "sweetalert2";

export default function UserList() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null); // user_id being updated
  const [openDropdown, setOpenDropdown] = useState(null); // which user's dropdown is open

  // ✅ Define available roles
  const availableRoles = ["admin", "attendee", "viewer"];

  useEffect(() => {
    fetchUsers();
  }, []);

  // Inside UserList.jsx
  const updateStatus = async (userId, isActive) => {
    try {
      setUpdating(userId);
      const token = localStorage.getItem("token");
      const res = await fetch(
        `https://ai-meeting-assistant-backend-suu9.onrender.com/api/users/${userId}/status`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ is_active: isActive }),
        }
      );

      const data = await res.json();
      if (res.ok) {
        fetchUsers(); // refresh
      } else {
        alert(data.message || "Failed to update status");
      }
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setUpdating(null);
    }
  };
  const deleteUser = async (userId) => {
    // Confirmation dialog
    const result = await Swal.fire({
      title: "Are you sure?",
      text: "This action cannot be undone!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Yes, delete it!",
    });

    if (!result.isConfirmed) return;

    try {
      setUpdating(userId);
      const token = localStorage.getItem("token");
      const res = await fetch(
        `https://ai-meeting-assistant-backend-suu9.onrender.com/api/users/${userId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await res.json();
      if (res.ok) {
        Swal.fire("Deleted!", "User has been deleted.", "success");
        fetchUsers(); // refresh
      } else {
        Swal.fire("Error", data.message || "Failed to delete user", "error");
      }
    } catch (err) {
      console.error("Error deleting user:", err);
      Swal.fire("Error", "Something went wrong!", "error");
    } finally {
      setUpdating(null);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const res = await fetch(
        "https://ai-meeting-assistant-backend-suu9.onrender.com/api/users",
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await res.json();
      if (res.ok) {
        setUsers(data);
      } else {
        console.error("Failed to fetch users:", data.message);
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    } finally {
      setLoading(false);
    }
  };

  const updateRoles = async (userId, roles) => {
    try {
      setUpdating(userId);
      const token = localStorage.getItem("token");
      const res = await fetch(
        `https://ai-meeting-assistant-backend-suu9.onrender.com/api/users/${userId}/roles`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ roles }),
        }
      );

      const data = await res.json();
      if (res.ok) {
        fetchUsers(); // refresh list
      } else {
        alert(data.message || "Failed to update roles");
      }
    } catch (err) {
      console.error("Error updating roles:", err);
    } finally {
      setUpdating(null);
      setOpenDropdown(null);
    }
  };

  if (loading) {
    return <p className="p-4">Loading users...</p>;
  }

  return (
    <div className="p-4">
      <h2 className="mb-3 fw-bold">👥 User List</h2>
      {users.length === 0 ? (
        <p>No users found.</p>
      ) : (
        <div className="">
          <table className="table table-bordered table-hover">
            <thead className="table-light">
              <tr>
                <th>S.no.</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Active</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, index) => {
                const userRoles = u.roles || [];
                return (
                  <tr key={u._id}>
                    <td>{index + 1}</td>
                    <td>{u.email}</td>
                    <td>
                      <div className="position-relative">
                        <button
                          className="btn btn-outline-secondary text-white btn-sm"
                          onClick={() =>
                            setOpenDropdown(openDropdown === u.id ? null : u.id)
                          }
                        >
                          {userRoles.length > 0
                            ? userRoles.join(", ")
                            : "No roles"}
                        </button>

                        {openDropdown === u.id && (
                          <div
                            className="position-absolute bg-white border rounded shadow p-2 mt-1"
                            style={{ zIndex: 1000 }}
                          >
                            {availableRoles.map((role) => (
                              <label
                                key={role}
                                className="d-flex align-items-center gap-2 p-1 mb-1"
                              >
                                <input
                                  type="checkbox"
                                  checked={userRoles.includes(role)}
                                  onChange={(e) => {
                                    let newRoles;
                                    if (e.target.checked) {
                                      newRoles = [...userRoles, role];
                                    } else {
                                      newRoles = userRoles.filter(
                                        (r) => r !== role
                                      );
                                    }
                                    updateRoles(u.id, newRoles);
                                  }}
                                />
                                {role}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>{u.is_active ? "✅" : "❌"}</td>
                    <td>{new Date(u.created_at).toLocaleString()}</td>
                    <td className="d-flex gap-2">
                      {updating === u.id ? (
                        "⏳ Updating..."
                      ) : (
                        <>
                          {/* Toggle Active/Inactive */}
                          <button
                            className={`btn btn-sm ${
                              u.is_active ? "btn-danger" : "btn-success"
                            }`}
                            onClick={() => updateStatus(u.id, !u.is_active)}
                          >
                            {u.is_active ? "Deactivate" : "Activate"}
                          </button>

                          {/* Delete User */}
                          <button
                            className="btn btn-danger btn-del btn-sm"
                            onClick={() => deleteUser(u.id)}
                          >
                            🗑️ Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
