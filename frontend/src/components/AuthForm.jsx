import React, { useState } from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import "../styles/register.css";

export default function AuthForm({ title, onSubmit, formData, setFormData }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="container-fluid min-vh-100 p-0 d-flex">
      {/* Left: Image Section */}
      <div className="col-lg-6 d-none d-lg-block register-left"></div>

      {/* Right: Form Section */}
      <div className="col-12 col-lg-6 d-flex align-items-center justify-content-center bg-light">
        <div className="form-container bg-white p-4 p-md-5 rounded shadow-lg animate-fade-in">
          <img alt="Logo" className="app-logo" src="/logo-img.png" />
          <h2 className="fw-bold text-center mb-4 text-primary-custom">
            {title}
          </h2>
          <form onSubmit={onSubmit}>
            <div className="mb-3">
              <input
                type="email"
                placeholder="Email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="form-control form-control-lg custom-input"
                required
              />
            </div>

            <div className="mb-3 position-relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="form-control form-control-lg custom-input"
                required
              />
              <span
                className="toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "15px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  cursor: "pointer",
                  fontSize: "1.2rem",
                  color: "#666",
                }}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </span>
            </div>

            <button
              type="submit"
              className="btn btn-primary-custom w-100 py-2 text-white"
            >
              {title}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
