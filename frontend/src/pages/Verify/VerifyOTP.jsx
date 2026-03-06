import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import FormErrorSlot from "../../components/FormErrorSlot";
import { OTP_REGEX, required } from "../../utils/formValidation";
import "./verify.css"

function VerifyOTP() {
  const [otp, setOtp] = useState("");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false); // <-- new state
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [fieldError, setFieldError] = useState("");

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

    const requiredError = required(otp, "OTP");
    if (requiredError) {
      setFieldError(requiredError);
      return handleError(requiredError);
    }
    if (!OTP_REGEX.test(String(otp).trim())) {
      const otpError = "OTP must be 4 to 8 digits";
      setFieldError(otpError);
      return handleError(otpError);
    }

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
        {successMsg && <div className="form-message primary">{successMsg}</div>}

        <form onSubmit={verifyOTP}>
          <label>OTP</label>

          <input
            value={otp}
            placeholder="Enter OTP..."
            onChange={(e) => {
              setOtp(e.target.value);
              setFieldError("");
              setErrorMsg("");
            }}
            className={fieldError ? "form-field-invalid" : ""}
          />
          <FormErrorSlot message={errorMsg} className="form-error-slot-global form-error-slot-center" />

          <button type="submit" disabled={loading}>
            Verify OTP
          </button>
        </form>
      </div>
    </div>
  );
}

export default VerifyOTP;
