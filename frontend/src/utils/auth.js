import { jwtDecode } from "jwt-decode";

export function getToken() {
  return localStorage.getItem("token");
}

export function isTokenExpired(token) {
  if (!token) return true;
  try {
    const { exp } = jwtDecode(token); // exp is in seconds
    return Date.now() >= exp * 1000;
  } catch (e) {
    return true; // if decode fails, treat as expired
  }
}

export function logout() {
  localStorage.removeItem("token");
  window.location.href = "/authpage";
}
