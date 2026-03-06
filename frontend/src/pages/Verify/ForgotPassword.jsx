import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import BackButton from "../../components/BackButton";
import FormErrorSlot from "../../components/FormErrorSlot";
import API from "../../api";
import { validEmail } from "../../utils/formValidation";
import "./verify.css"

function ForgotPassword() {
  const [email, setEmail] = useState("");
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


  const sendOTP = async (e) => {
    e.preventDefault();

    const emailError = validEmail(email);
    setFieldError(emailError);
    if (emailError) return handleError(emailError);

    if (loading) return;

    setLoading(true);

    try {
      const response = await API.post("/auth/send-otp", { email });

      handleSuccess(response.data.msg || "OTP sent!");

      localStorage.setItem("otpEmail", email);

      setTimeout(() => navigate("/verify-otp"), 1000);

    } catch (err) {
      console.error(err);

      handleError(
        err.response?.data?.msg || "User not found"
      );

    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="login-wrapper">
      <div className="container">
        <h1>Send OTP</h1>
        {successMsg && <div className="form-message primary">{successMsg}</div>}

        <form onSubmit={sendOTP}>
          <label>Email</label>

          <input
            type="email"
            value={email}
            placeholder="Enter email..."
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldError("");
              setErrorMsg("");
            }}
            className={fieldError ? "form-field-invalid" : ""}
          />
          <FormErrorSlot message={errorMsg} className="form-error-slot-global form-error-slot-center" />

          <button type="submit" disabled={loading}>
            Send OTP
          </button>
        </form>
        <BackButton />
      </div>
    </div>
  );
}

export default ForgotPassword;
