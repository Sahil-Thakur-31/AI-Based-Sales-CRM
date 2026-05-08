import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthBrandHeader from "../../components/AuthBrandHeader";
import BackButton from "../../components/BackButton";
import FormErrorSlot from "../../components/FormErrorSlot";
import { required, strongPassword } from "../../utils/formValidation";
import "./verify.css"

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState({
    password: "",
    confirmPassword: "",
  });

  const handleError = (msg) => {
    setErrorMsg(msg);
    setSuccessMsg("");
  };
  const handleSuccess = (msg) => {
    setSuccessMsg(msg);
    setErrorMsg("");
  };

  const navigate = useNavigate();
  const email = localStorage.getItem("otpEmail");

  const handleReset = async (e) => {
    e.preventDefault();

    const nextErrors = {
      password: strongPassword(password),
      confirmPassword: required(confirmPassword, "Confirm password"),
    };
    if (!nextErrors.confirmPassword && password !== confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match";
    }
    setFieldErrors(nextErrors);
    if (nextErrors.password || nextErrors.confirmPassword) {
      return handleError(nextErrors.password || nextErrors.confirmPassword);
    }

    if (!email)
      return handleError("Session expired. Try again.");

    if (loading) return;

    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:8080/auth/reset-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            newPassword: password,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setLoading(false);
        return handleError(result.msg);
      }

      handleSuccess("Password reset successful!");

      localStorage.removeItem("otpEmail");

      setTimeout(() => navigate("/login"), 1500);

    } catch {
      handleError("Server error");
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="container">
        <AuthBrandHeader />
        <h1>Reset Password</h1>
        {successMsg && <div className="form-message primary">{successMsg}</div>}

        <form onSubmit={handleReset}>
          <label>New Password</label>
          <input
            type="password"
            placeholder="Enter new password..."
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, password: "" }));
              setErrorMsg("");
            }}
            className={fieldErrors.password ? "form-field-invalid" : ""}
          />

          <label>Confirm Password</label>
          <input
            type="password"
            placeholder="Confirm password..."
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, confirmPassword: "" }));
              setErrorMsg("");
            }}
            className={fieldErrors.confirmPassword ? "form-field-invalid" : ""}
          />
          <FormErrorSlot message={errorMsg} className="form-error-slot-global form-error-slot-center" />

          <button type="submit" disabled={loading}>
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>

        <BackButton />
      </div>
    </div>
  );
}

export default ResetPassword;
