import React, { useState } from "react";
import AuthForm from "../components/AuthForm";
import Swal from "sweetalert2";

export default function Registeryyy() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(
        "https://ai-meeting-assistant-backend-suu9.onrender.com/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        }
      );

      let data;
      try {
        data = await res.json(); // try to parse JSON
      } catch {
        throw new Error("Invalid JSON response from server");
      }

      if (!res.ok) {
        // Server responded with error status
        Swal.fire({
          icon: "error",
          title: "Error",
          text: data?.message || `Error ${res.status}`,
        });
        return;
      }

      // Success
      Swal.fire({
        icon: "success",
        title: "Success",
        text: data.message,
      }).then(() => {
        window.location.href = "/login";
      });
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: error.message || "Something went wrong. Please try again.",
      });
    }
  };

  return (
    <AuthForm
      title="Register"
      onSubmit={handleRegister}
      formData={formData}
      setFormData={setFormData}
    />
  );
}
