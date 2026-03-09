import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom';
import API from '../../api'
import FormErrorSlot from '../../components/FormErrorSlot';
import { validEmail, strongPassword } from '../../utils/formValidation';
import "./verify.css"

function Login() {
    const [logininfo, setLogininfo] = useState({
        email: '',
        password: ''
    });
    const [loading, setLoading] = useState(false); // <-- new state
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [fieldErrors, setFieldErrors] = useState({
        email: "",
        password: "",
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
        // console.log(name, value);
        const copyloginInfo = { ...logininfo };
        copyloginInfo[name] = value;
        setLogininfo(copyloginInfo);
        setFieldErrors((prev) => ({ ...prev, [name]: "" }));
        setErrorMsg("");
        setSuccessMsg("");
    }

    const navigate = useNavigate();
    const feedbackMsg = errorMsg || successMsg;
    const isSuccessFeedback = !errorMsg && Boolean(successMsg);

    const handleLogin = async (e) => {
        e.preventDefault()

        const { email, password } = logininfo;
        const nextErrors = {
            email: validEmail(email),
            password: strongPassword(password),
        };

        setFieldErrors(nextErrors);

        if (nextErrors.email || nextErrors.password) {
            return handleError(nextErrors.email || nextErrors.password);
        }

        if (loading) return;

        setLoading(true);

        try {
            const response = await API.post('/auth/login', logininfo);

            const result = response.data;

            // backend success = HTTP 200
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
            handleError(
                err.response?.data?.msg || "Login failed"
            );
        } finally {
            setLoading(false);
        }

    }
    return (
        <div className="login-wrapper">
            <div className='container'>
                <h1>login</h1>
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
