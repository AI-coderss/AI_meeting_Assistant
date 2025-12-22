import React, { useState } from "react";
import AuthForm from "../components/AuthForm";
import Swal from "sweetalert2";
import api from "../api/api";

export default function Login() {
  const [formData, setFormData] = useState({ email: "", password: "" });

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      const res = await api.post("/api/auth/login", formData);
      const data = res.data;

      if (data.success) {
        Swal.fire({
          icon: "success",
          title: "Logged in!",
          text: data.message,
          timer: 1500,
          showConfirmButton: false,
        });

        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("email", formData.email);
        localStorage.setItem("roles", JSON.stringify(data.roles));

        setTimeout(() => {
          window.location.href = "/";
        }, 1500);
      } else {
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
