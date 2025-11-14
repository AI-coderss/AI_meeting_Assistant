import React from "react";
import { Navigate } from "react-router-dom";
import { getToken, isTokenExpired } from "./utils/auth";

export default function ProtectedRoute({ children }) {
  const token = getToken();
  if (!token || isTokenExpired(token)) {
    return <Navigate to="/authpage" replace />;
  }
  return children;
}
