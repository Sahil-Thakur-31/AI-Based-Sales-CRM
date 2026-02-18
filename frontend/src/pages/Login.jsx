import React, {useState} from 'react'
import { Link, useNavigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify'; 
import { handleError, handleSuccess } from '../utils';

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
        const {email, password} = logininfo;
        if(!email || !password){
            return handleError("All fields are required");
        }
        if (loading) return;

        setLoading(true);

        try{
            const url = "http://localhost:8080/auth/login";

            const response = await fetch(url,{
                method: 'POST',
                headers:{
                    'content-type': 'application/json'
                },
                body:JSON.stringify(logininfo)
            });

            const result = await response.json();
            // console.log(result)
            if(response.ok || result.success){
                handleSuccess("login Sucessfull");
                localStorage.setItem('token',result.jwtToken);
                localStorage.setItem('Name',result.name);
                localStorage.setItem('RoleName',result.rolename);
                if(result.rolename=='Manager'){
                    setTimeout(()=>{ navigate('/managerhome')},1000);
                }else if(result.rolename=='Admin'){
                    setTimeout(()=>{ navigate('/adminhome')},1000);
                }
            }else if(result.error){
                const details = result.error?.details?.[0]?.message || result.message || "login failed";
                handleError(details);
            }else if(!result.success){
                handleError(result.msg);
            }
        }catch(err){
            handleError(err);
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