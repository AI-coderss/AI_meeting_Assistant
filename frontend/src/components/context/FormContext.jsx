import { createContext } from "react";

export const FormContext = createContext({
  formData: null,
  setFormData: () => {},
});
