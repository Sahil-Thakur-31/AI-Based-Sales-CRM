import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom';
import API from '../../api'
import AuthBrandHeader from '../../components/AuthBrandHeader';
import FormErrorSlot from '../../components/FormErrorSlot';
import { minLength, validEmail } from '../../utils/formValidation';
import "./verify.css"

function Login() {
    const [logininfo, setLogininfo] = useState({
        email: '',
        password: ''
    });
    const [captchaChecked, setCaptchaChecked] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [fieldErrors, setFieldErrors] = useState({
        email: "",
        password: "",
        captcha: "",
    });

    const handleError = (msg) => {
        setErrorMsg(msg);
        setSuccessMsg('');
    };

    const handleSuccess = (msg) => {
        setSuccessMsg(msg);
        setErrorMsg('');
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        const copyloginInfo = { ...logininfo };
        copyloginInfo[name] = value;
        setLogininfo(copyloginInfo);
        setFieldErrors((prev) => ({ ...prev, [name]: "" }));
        setErrorMsg("");
        setSuccessMsg("");
    };

    const handleCaptchaCheck = (e) => {
        setCaptchaChecked(e.target.checked);
        setFieldErrors((prev) => ({ ...prev, captcha: "" }));
        setErrorMsg("");
        setSuccessMsg("");
    };

    const navigate = useNavigate();
    const feedbackMsg = errorMsg || successMsg;
    const isSuccessFeedback = !errorMsg && Boolean(successMsg);

    const handleLogin = async (e) => {
        e.preventDefault();

        const { email, password } = logininfo;
        const nextErrors = {
            email: validEmail(email),
            password: minLength(password, 6, "Password"),
            captcha: !captchaChecked ? "Please confirm you are not a robot" : "",
        };

        setFieldErrors(nextErrors);

        if (nextErrors.email || nextErrors.password || nextErrors.captcha) {
            return handleError(nextErrors.email || nextErrors.password || nextErrors.captcha);
        }

        if (loading) return;

        setLoading(true);

        try {
            const response = await API.post('/auth/login', logininfo);
            const result = response.data;

            if (response.status === 200) {
                handleSuccess(result.msg);

                localStorage.setItem('token', result.jwtToken);
                localStorage.setItem('Name', result.name);
                localStorage.setItem('RoleName', result.rolename);

                if (result.rolename === 'Manager') {
                    setTimeout(() => navigate('/managerhome'), 1000);
                } else if (result.rolename === 'Admin') {
                    setTimeout(() => navigate('/adminhome'), 1000);
                } else {
                    setTimeout(() => navigate('/userhome'), 1000);
                }
            }
        } catch (err) {
            console.error(err);
            const backendMessage =
                err.response?.data?.error?.details?.[0]?.message ||
                err.response?.data?.msg ||
                "";

            handleError(
                /captchaid|captchaanswer/i.test(backendMessage)
                    ? "Backend server is still using the old captcha check. Restart the backend and try again."
                    : backendMessage ||
                "Login failed"
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-wrapper">
            <div className='container'>
                <AuthBrandHeader />
                <h1>Login</h1>
                <form onSubmit={handleLogin}>
                    <div>
                        <label>Email</label>
                        <input
                            type='email'
                            name='email'
                            onChange={handleChange}
                            value={logininfo.email}
                            placeholder='Enter Your Email...'
                            className={fieldErrors.email ? "form-field-invalid" : ""}
                        />
                    </div>
                    <div>
                        <label>Password</label>
                        <input
                            type='password'
                            onChange={handleChange}
                            name='password'
                            value={logininfo.password}
                            placeholder='Enter Your Password...'
                            className={fieldErrors.password ? "form-field-invalid" : ""}
                        />
                    </div>
                    <div className={`captcha-panel ${fieldErrors.captcha ? "captcha-panel-invalid" : ""}`}>
                        <label className="captcha-box">
                            <input
                                type='checkbox'
                                checked={captchaChecked}
                                onChange={handleCaptchaCheck}
                            />
                            <span className="captcha-checkmark" aria-hidden="true">
                                {captchaChecked ? "\u2713" : ""}
                            </span>
                            <span className="captcha-text">I&apos;m not a robot</span>
                            <span className="captcha-brand" aria-hidden="true">
                                <span className="captcha-brand-icon">
                                    <span className="captcha-brand-icon-main"></span>
                                    <span className="captcha-brand-icon-accent"></span>
                                </span>
                                <span className="captcha-brand-label">reCAPTCHA</span>
                                <span className="captcha-brand-meta">Privacy - Terms</span>
                            </span>
                        </label>
                    </div>
                    <FormErrorSlot
                        message={fieldErrors.captcha}
                        className="captcha-feedback-slot"
                    />
                    <FormErrorSlot
                        message={feedbackMsg}
                        className={`form-error-slot-global form-error-slot-center login-feedback-slot ${isSuccessFeedback ? "login-feedback-slot-success" : ""}`}
                    />
                    <button type='Submit' disabled={loading}>login</button>
                    <span className="form-footer-link">
                        <Link to='/forgot-password'> Forgot password</Link>
                    </span>
                </form>
            </div>
        </div>
    )
}

export default Login;
