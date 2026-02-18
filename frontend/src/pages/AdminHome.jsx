import {useState,useEffect} from 'react'
import {useNavigate}  from 'react-router-dom'

function AdminHome(){
    const [loggedinUser,setLoggedinUser] = useState('');
    const navigate = useNavigate();
    useEffect(()=>{
        setLoggedinUser(localStorage.getItem('Name'));
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
            <p>{loggedinUser}</p>
            <button type='submit' onClick={handleLogout}>Logout</button>
        </div>
    )
}

export default AdminHome;