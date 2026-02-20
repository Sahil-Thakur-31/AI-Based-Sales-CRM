import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { handleError, handleSuccess } from "../../utils";
import BackButton from "../../components/BackButton";
import API from "../../api";
import "./verify.css"

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false); // <-- new state

  
  const sendOTP = async (e) => {
    e.preventDefault();
  
    if (!email.trim()) {
      return handleError("Email required");
    }
  
    // simple email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
    if (!emailRegex.test(email)) {
      return handleError("Invalid email format");
    }
  
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
    </div>
  );
}

export default ForgotPassword;
