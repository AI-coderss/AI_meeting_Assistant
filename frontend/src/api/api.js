import axios from "axios";

const api = axios.create({
  baseURL: "https://ai-meeting-assistant-backend-suu9.onrender.com", // change to Render URL in prod
});

// 🔐 Attach access token to every request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token"); // ✅ consistent key
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 🔁 Handle expired access token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem("refresh_token");
        if (!refreshToken) {
          throw new Error("No refresh token");
        }

        // 🔄 Send refresh token explicitly
        const res = await axios.post(
          "https://ai-meeting-assistant-backend-suu9.onrender.com/api/auth/refresh",
          { refresh_token: refreshToken }
        );

        const newAccessToken = res.data.access_token;

        // ✅ Save new token
        localStorage.setItem("token", newAccessToken);

        // ✅ Retry original request
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);

      } catch (err) {
        // 🚪 Refresh failed → logout
        localStorage.clear();
        window.location.href = "/authpage";
        return Promise.reject(err);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
