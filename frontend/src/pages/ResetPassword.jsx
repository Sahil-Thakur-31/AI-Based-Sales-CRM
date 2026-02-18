import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { handleError, handleSuccess } from "../utils";
import BackButton from "../components/BackButton";

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const email = localStorage.getItem("otpEmail");

  const handleReset = async (e) => {
    e.preventDefault();

    if (!password || !confirmPassword)
      return handleError("All fields required");

    const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

    if (!strongPassword.test(password)) {
      return handleError(
        "Password must be 8+ chars with uppercase, lowercase, number & special character"
      );
    }

    if (password !== confirmPassword)
      return handleError("Passwords do not match");

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
    <div className="container">
      <h1>Reset Password</h1>

      <form onSubmit={handleReset}>
        <label>New Password</label>
        <input
          type="password"
          placeholder="Enter new password..."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label>Confirm Password</label>
        <input
          type="password"
          placeholder="Confirm password..."
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />

        <button type="submit" disabled={loading}>
          {loading ? "Resetting..." : "Reset Password"}
        </button>
      </form>

      <BackButton />
      <ToastContainer limit={1} />
    </div>
  );
}

export default ResetPassword;
