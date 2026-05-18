import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom';
import API from '../../api'
import AuthBrandHeader from '../../components/AuthBrandHeader';
import FormErrorSlot from '../../components/FormErrorSlot';
import { isBlank, required, validEmail } from '../../utils/formValidation';
import "./verify.css"

const formatRemainingLockTime = (remainingMs) => {
    const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (!minutes) {
        return `${seconds} second${seconds === 1 ? "" : "s"}`;
    }

    if (!seconds) {
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }

    return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${seconds === 1 ? "" : "s"}`;
};

const LAST_LOGIN_EMAIL_KEY = "lastLoginEmail";
const buildLockStorageKey = (email = "") => `loginLock:${String(email || "").trim().toLowerCase()}`;

function Login() {
    const [logininfo, setLogininfo] = useState({
        email: localStorage.getItem(LAST_LOGIN_EMAIL_KEY) || '',
        password: ''
    });
    const [captchaChecked, setCaptchaChecked] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [lockUntil, setLockUntil] = useState(null);
    const [lockMessage, setLockMessage] = useState('');
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
    const feedbackMsg = lockMessage || errorMsg || successMsg;
    const isSuccessFeedback = !errorMsg && Boolean(successMsg);
    const isLocked = Boolean(lockUntil && new Date(lockUntil).getTime() > Date.now());

    useEffect(() => {
        const normalizedEmail = String(logininfo.email || "").trim().toLowerCase();
        if (!normalizedEmail) {
            setLockUntil(null);
            setLockMessage('');
            return;
        }

        localStorage.setItem(LAST_LOGIN_EMAIL_KEY, normalizedEmail);
    }, [logininfo.email]);

    useEffect(() => {
        if (!lockUntil) {
            setLockMessage('');
            const normalizedEmail = String(logininfo.email || "").trim().toLowerCase();
            if (normalizedEmail) {
                localStorage.removeItem(buildLockStorageKey(normalizedEmail));
            }
            return undefined;
        }

        const normalizedEmail = String(logininfo.email || "").trim().toLowerCase();
        if (normalizedEmail) {
            localStorage.setItem(buildLockStorageKey(normalizedEmail), lockUntil);
        }

        const updateLockMessage = () => {
            const remainingMs = new Date(lockUntil).getTime() - Date.now();

            if (remainingMs <= 0) {
                setLockUntil(null);
                setLockMessage('');
                return;
            }

            setLockMessage(
                `Your account is temporarily locked due to multiple unsuccessful login attempts. Please try again in ${formatRemainingLockTime(remainingMs)}.`
            );
        };

        updateLockMessage();
        const intervalId = window.setInterval(updateLockMessage, 1000);

        return () => window.clearInterval(intervalId);
    }, [lockUntil, logininfo.email]);

    useEffect(() => {
        const normalizedEmail = String(logininfo.email || "").trim().toLowerCase();
        if (!normalizedEmail || validEmail(normalizedEmail)) {
            setLockUntil(null);
            setLockMessage('');
            return undefined;
        }

        const storedLockUntil = localStorage.getItem(buildLockStorageKey(normalizedEmail));
        if (storedLockUntil && new Date(storedLockUntil).getTime() > Date.now()) {
            setLockUntil(storedLockUntil);
        }

        let isActive = true;
        const timerId = window.setTimeout(async () => {
            try {
                const response = await API.post('/auth/login-status', { email: normalizedEmail });
                if (!isActive) return;

                if (response.data?.isLocked && response.data?.lockedUntil) {
                    setLockUntil(response.data.lockedUntil);
                    setLockMessage(response.data.message || '');
                } else {
                    setLockUntil(null);
                    setLockMessage('');
                }
            } catch (err) {
                if (!isActive) return;

                if (storedLockUntil && new Date(storedLockUntil).getTime() > Date.now()) {
                    setLockUntil(storedLockUntil);
                }
            }
        }, 250);

        return () => {
            isActive = false;
            window.clearTimeout(timerId);
        };
    }, [logininfo.email]);

    const handleLogin = async (e) => {
        e.preventDefault();

        if (isLocked) {
            handleError(lockMessage || "Your account is temporarily locked. Please try again later.");
            return;
        }

        const { email, password } = logininfo;
        const nextErrors = {
            email: validEmail(email),
            password: required(password, "Password"),
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
                setLockUntil(null);
                setLockMessage('');
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
                err.response?.data?.message ||
                err.response?.data?.msg ||
                err.userMessage ||
                "";
            const lockedUntil = err.response?.data?.lockedUntil;

            if (lockedUntil) {
                setLockUntil(lockedUntil);
            } else if (!isBlank(logininfo.email)) {
                localStorage.removeItem(buildLockStorageKey(logininfo.email));
            }

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
                    <button type='Submit' disabled={loading || isLocked}>
                        {loading ? "Signing in..." : isLocked ? "Locked" : "Login"}
                    </button>
                    <span className="form-footer-link">
                        <Link to='/forgot-password'> Forgot password</Link>
                    </span>
                </form>
            </div>
        </div>
    )
}

export default Login;
