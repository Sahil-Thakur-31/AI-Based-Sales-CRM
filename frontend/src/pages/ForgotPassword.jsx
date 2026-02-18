import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { handleError, handleSuccess } from "../utils";
import BackButton from "../components/BackButton";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false); // <-- new state

  const sendOTP = async (e) => {
    e.preventDefault();

    if (!email)
      return handleError("Email required");

    if (loading) return;

    setLoading(true);


    try {
      const response = await fetch(
        "http://localhost:8080/auth/send-otp",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setLoading(false);
        return handleError(result.msg);
      }

      handleSuccess("OTP sent!");

      // save email for next page
      localStorage.setItem("otpEmail", email);

      setTimeout(() => navigate("/verify-otp"), 1000);

    } catch {
      handleError("Server error");
      setLoading(false);
    }

  };

  return (
    <div className="container">
      <h1>Send OTP</h1>

      <form onSubmit={sendOTP}>
        <label>Email</label>

        <input
          type="email"
          value={email}
          placeholder="Enter email..."
          onChange={(e) => setEmail(e.target.value)}
        />

        <button type="submit" disabled={loading}>
          Send OTP
        </button>
      </form>
    <BackButton />
      <ToastContainer />
    </div>
  );
}

export default ForgotPassword;
