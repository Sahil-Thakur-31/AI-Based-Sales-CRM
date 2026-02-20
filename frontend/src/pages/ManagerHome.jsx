import {useState,useEffect} from 'react'
import {useNavigate}  from 'react-router-dom'

function ManagerHome(){
    const [loggedinUser,setLoggedinUser] = useState('');
    const [loggedinUserRole,setLoggedinUserRole] = useState('');
    const navigate = useNavigate();
    useEffect(()=>{
        setLoggedinUser(localStorage.getItem('Name'));
        setLoggedinUserRole(localStorage.getItem('RoleName'));
    },[]);

    const handleLogout = () =>{
        localStorage.removeItem('token');
        localStorage.removeItem('Name');
        setTimeout(()=>{
            navigate('/login');
        },100);
    }

    return(
        <div>
            <p>{loggedinUser} - {loggedinUserRole}</p>
            <button type='submit' onClick={handleLogout}>Logout</button>
        </div>
    )
}

export default ManagerHome;