import React, {useState} from 'react'
import { Link, useNavigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify'; 
import { handleError, handleSuccess } from '../../utils';
import API from '../../api'

function Login(){
    const [logininfo,setLogininfo] = useState({
        email:'',
        password:''
    });
    const [loading, setLoading] = useState(false); // <-- new state
    

    const handleChange = (e) => {
        const {name, value} = e.target;
        // console.log(name, value);
        const copyloginInfo = {...logininfo};
        copyloginInfo[name] = value;
        setLogininfo(copyloginInfo);
    }

    const navigate = useNavigate();

    const handleLogin = async(e) =>{
        e.preventDefault()

        const { email, password } = logininfo;

        if (!email || !password) {
            return handleError("All fields are required");
        }
        
        // email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!emailRegex.test(email)) {
            return handleError("Invalid email format");
        }
        
        // strong password validation
        const strongPassword =
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
        
        if (!strongPassword.test(password)) {
            return handleError(
                "Password must be 8+ chars with uppercase, lowercase, number & special character"
            );
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
    return(
        <div className='container'>
            <h1>login</h1>
            <form onSubmit={handleLogin}>
                <div>
                    <label>Email</label>
                    <input type='email' name='email' onChange={handleChange} value={logininfo.email} placeholder='Enter Your Email...' />
                </div>
                <div>
                    <label>Password</label>
                    <input type='password' onChange={handleChange} name='password' value={logininfo.password} placeholder='Enter Your Password...'  />
                </div>
                <button type='Submit' disabled={loading}>login</button>
                <span>
                    <Link to='/forgot-password'> Forgot password</Link>
                </span>
            </form>
            
            <ToastContainer />
        </div>
    )
}

export default Login;