import { useState } from "react";

export const useToast = () => {
  const [toast, setToast] = useState({
    show: false,
    message: "",
    type: "info", // info | success | error | warning
  });

  const showToast = (message, type = "info", duration = 3000) => {
    setToast({ show: true, message, type });

    setTimeout(() => {
      setToast({ show: false, message: "", type: "info" });
    }, duration);
  };

  return {
    toast,
    showToast,
  };
};
