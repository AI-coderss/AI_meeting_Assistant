import React from "react";

const Toast = ({ toast }) => {
  if (!toast.show) return null;

  return (
    <div className={`toast toast-${toast.type}`}>
      {toast.message}
    </div>
  );
};

export default Toast;
