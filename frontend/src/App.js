import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import MainApp from "./MainApp";
import Login from "./pages/Login";
import Register from "./pages/Register";

function App() {
  const token = localStorage.getItem("token"); // Adjust if you store differently

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected Routes */}
        <Route
          path="/*"
          // element={
          //   token ? <MainApp /> : <Navigate to="/login" replace />
          // }
          element={
            <MainApp />
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
