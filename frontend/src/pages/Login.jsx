import React, { useState } from "react";
import AuthForm from "../components/AuthForm";
import Swal from "sweetalert2";

export default function Login() {
  const [formData, setFormData] = useState({ email: "", password: "" });

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      const res = await fetch("http://127.0.0.1:8001/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (data.success) {
        // Success alert
        Swal.fire({
          icon: "success",
          title: "Logged in!",
          text: data.message,
          timer: 1500,
          showConfirmButton: false,
        });

        localStorage.setItem("token", data.access_token);

        // Redirect after a short delay
        setTimeout(() => {
          window.location.href = "/";
        }, 1500);
      } else {
        // Error alert
        Swal.fire({
          icon: "error",
          title: "Login failed",
          text: data.message || "Something went wrong",
        });
      }
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Server error",
        text: "Unable to connect to the server",
      });
    }
  };

  return (
    <AuthForm
      title="Login"
      onSubmit={handleLogin}
      formData={formData}
      setFormData={setFormData}
    />
  );
}
