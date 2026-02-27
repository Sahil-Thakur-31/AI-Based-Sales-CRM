import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./verify.css"

function VerifyOTP() {
  const [otp, setOtp] = useState("");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false); // <-- new state
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleError = (msg) => {
    setErrorMsg(msg);
    setSuccessMsg("");
  };
  const handleSuccess = (msg) => {
    setSuccessMsg(msg);
    setErrorMsg("");
  };


  const email = localStorage.getItem("otpEmail");

  const verifyOTP = async (e) => {
    e.preventDefault();

    if (!otp)
      return handleError("Enter OTP");

    if (loading) return;

    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:8080/auth/verify-otp",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email, otp })
        }
      );

      const result = await response.json();

      if (!response.ok)
        return handleError(result.msg);

      handleSuccess("OTP verified!");

      setTimeout(() => navigate("/reset-password"), 1000);

    } catch {
      handleError("Server error");
    }
  };

  return (
    <div className="login-wrapper">
      <div className="container">
        <h1>Verify OTP</h1>
        {errorMsg && <div className="form-message danger">{errorMsg}</div>}
        {successMsg && <div className="form-message primary">{successMsg}</div>}

        <form onSubmit={verifyOTP}>
          <label>OTP</label>

          <input
            value={otp}
            placeholder="Enter OTP..."
            onChange={(e) => setOtp(e.target.value)}
          />

          <button type="submit" disabled={loading}>
            Verify OTP
          </button>
        </form>
      </div>
    </div>
  );
}

export default VerifyOTP;
